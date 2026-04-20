#!/usr/bin/env python3
"""
rk_board_config.py — Configure a Rockchip dev board from a desktop over USB-to-serial.

Default serial settings: /dev/ttyUSB0, 1500000 baud, 8N1, no flow control.

Usage examples:
    # Get CPU ID (default port, passwordless root login)
    ./rk_board_config.py cpu-id

    # Get CPU ID from a specific serial port
    ./rk_board_config.py cpu-id --port /dev/ttyUSB1

    # Login with password (prompted interactively, safe for shell history)
    ./rk_board_config.py cpu-id --user cat --ask-password

    # Login with explicit password (visible in shell history — use with care)
    ./rk_board_config.py cpu-id --user cat --password temppwd

    # Get full CPU info
    ./rk_board_config.py cpuinfo

    # Get machine ID
    ./rk_board_config.py machine-id

    # Get hostname
    ./rk_board_config.py hostname

    # Run an arbitrary command on the board
    ./rk_board_config.py run "uname -a"
 
    # Open an interactive shell session (for manual login, debugging, etc.)
    ./rk_board_config.py shell

Requirements:
    pip install pyserial
"""

import argparse
import os
import re
import select
import signal
import sys
import time

try:
    import serial
except ImportError:
    print("ERROR: pyserial is required. Install with: pip install pyserial", file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
DEFAULT_PORT = "/dev/cu.usbserial-A5069RR4" # "/dev/ttyUSB0"
DEFAULT_BAUD = 1500000
DEFAULT_TIMEOUT = 5.0          # seconds for command response
DEFAULT_USER = "cat"
DEFAULT_PASSWORD = ""           # empty = try passwordless, then prompt interactively

PROMPT_PATTERNS = [
    re.compile(r"\w+@[\w.-]+[^:]*[$#]\s*$"),   # user@hostname...$ or user@hostname...#
    re.compile(r"[$#]\s*$"),                     # bare $ or # prompt
    re.compile(r"~\s*[#$]\s*$"),                 # ~ #  or ~ $ (busybox-style)
]
LOGIN_RE = re.compile(r"login:\s*$", re.IGNORECASE | re.MULTILINE)
PASSWORD_RE = re.compile(r"password:\s*$", re.IGNORECASE | re.MULTILINE)

# A unique marker we inject so we can detect where our command output starts/ends
MARKER = "__RK_CFG_MARKER__"


class SerialConsole:
    """Manage a serial console session to an RK board."""

    def __init__(self, port: str, baudrate: int, timeout: float = DEFAULT_TIMEOUT,
                 user: str = "", password: str = "", debug: bool = False):
        self.port = port
        self.baudrate = baudrate
        self.timeout = timeout
        self.user = user
        self.password = password
        self._debug = debug
        self.ser: serial.Serial | None = None
        self._logged_in = False

    # -- context manager -----------------------------------------------------
    def __enter__(self):
        self.open()
        return self

    def __exit__(self, *exc):
        self.close()

    # -- lifecycle -----------------------------------------------------------
    def open(self):
        self.ser = serial.Serial(
            port=self.port,
            baudrate=self.baudrate,
            bytesize=serial.EIGHTBITS,
            parity=serial.PARITY_NONE,
            stopbits=serial.STOPBITS_ONE,
            xonxoff=False,
            rtscts=False,
            dsrdtr=False,
            timeout=0.1,           # read timeout (short, we poll)
            write_timeout=2.0,
        )
        # Flush any stale data
        self.ser.reset_input_buffer()
        self.ser.reset_output_buffer()

    def close(self):
        if self.ser and self.ser.is_open:
            self.ser.close()
            self.ser = None

    # -- low-level I/O -------------------------------------------------------
    def _write(self, data: str):
        assert self.ser is not None
        self.ser.write(data.encode("utf-8", errors="replace"))
        self.ser.flush()

    def _read_until_quiet(self, timeout: float | None = None, quiet: float = 0.3) -> str:
        """Read until no new data arrives for *quiet* seconds, or *timeout* expires."""
        assert self.ser is not None
        timeout = timeout if timeout is not None else self.timeout
        buf = bytearray()
        deadline = time.monotonic() + timeout
        last_data = time.monotonic()

        while True:
            now = time.monotonic()
            if now >= deadline:
                break
            chunk = self.ser.read(4096)
            if chunk:
                buf.extend(chunk)
                last_data = now
            else:
                if buf and (now - last_data) >= quiet:
                    break
                time.sleep(0.02)

        return buf.decode("utf-8", errors="replace")

    # -- prompt detection ----------------------------------------------------
    def _has_prompt(self, text: str) -> bool:
        """Check if *text* ends with something that looks like a shell prompt."""
        for line in reversed(text.splitlines()):
            stripped = line.strip()
            if not stripped:
                continue
            for pat in PROMPT_PATTERNS:
                if pat.search(stripped):
                    return True
            return False
        return False

    # -- login / wake --------------------------------------------------------
    def _try_login(self, resp: str) -> bool:
        """Attempt automatic login if we see a login or password prompt.

        Returns True if we end up at a shell prompt after login.
        """
        # --- handle "login:" prompt ---
        if LOGIN_RE.search(resp):
            user = self.user or DEFAULT_USER
            print(f"[login] Detected login prompt, sending user '{user}'")
            self._write(user + "\n")
            time.sleep(0.5)
            resp = self._read_until_quiet(timeout=3.0, quiet=0.5)
            if self._debug:
                print(f"[debug] After sending user, got: {resp!r}", file=sys.stderr)
            if self._has_prompt(resp):
                self._logged_in = True
                return True
            # Fall through to password handling if needed

        # --- handle "Password:" prompt ---
        if PASSWORD_RE.search(resp):
            password = self.password
            if password is None:
                # Prompt the user interactively on the desktop
                import getpass
                password = getpass.getpass(f"[login] Password for board ({self.port}): ")
            print("[login] Sending password")
            self._write(password + "\n")
            time.sleep(0.5)
            resp = self._read_until_quiet(timeout=3.0, quiet=0.5)
            if self._debug:
                print(f"[debug] After sending password, got: {resp!r}", file=sys.stderr)
            if self._has_prompt(resp):
                self._logged_in = True
                return True
            # Check for "Login incorrect" / re-appearing login prompt
            if LOGIN_RE.search(resp):
                print("[login] Login incorrect — wrong username/password?", file=sys.stderr)
                return False

        return False

    def wake(self, retries: int = 5) -> str:
        """Send newlines until we get a shell prompt, handling login if needed.

        Returns the raw text received (including any login banners).
        Raises RuntimeError if no prompt is detected.
        """
        all_text = ""
        for attempt in range(retries):
            self._write("\n")
            time.sleep(0.3)
            resp = self._read_until_quiet(timeout=2.0, quiet=0.5)
            all_text += resp

            if self._debug:
                print(f"[debug] wake attempt {attempt + 1}/{retries}: {resp!r}", file=sys.stderr)

            if self._has_prompt(resp):
                if self._debug:
                    print(f"[debug] Detected shell prompt", file=sys.stderr)
                return resp

            # Attempt automatic login
            if LOGIN_RE.search(resp) or PASSWORD_RE.search(resp):
                if self._try_login(resp):
                    return resp
                # Login failed — try again (board may re-show login prompt)
                continue

        raise RuntimeError(
            f"Could not detect a shell prompt after {retries} attempts on {self.port}.\n"
            f"Is the board powered on and booted?\n"
            f"Last received text:\n{all_text[-500:] if all_text else '(nothing)'}\n"
            f"Tips:\n"
            f"  - Use 'shell' sub-command for interactive access\n"
            f"  - Use --user / --password if the board requires login"
        )

    # -- command execution ---------------------------------------------------
    def run_command(self, cmd: str, timeout: float | None = None) -> str:
        """Execute *cmd* on the remote board and return its stdout.

        Uses echo markers to delimit output so we can reliably extract it.
        The board echoes back the full command line (which contains both markers),
        so we must carefully find the *output* markers (on their own lines), not
        the ones embedded in the echoed command.
        """
        timeout = timeout if timeout is not None else self.timeout
        start_marker = f"START_{MARKER}"
        end_marker = f"END_{MARKER}"

        # Build a wrapped command:
        #   echo START_MARKER; <cmd>; echo END_MARKER
        wrapped = f"echo {start_marker}; {cmd}; echo {end_marker}\n"
        self._write(wrapped)
        raw = self._read_until_quiet(timeout=timeout, quiet=0.8)

        if self._debug:
            print(f"[debug] run_command raw ({len(raw)} bytes):\n{raw!r}", file=sys.stderr)

        # --- Parse line-by-line to find the OUTPUT markers ---
        # The echoed command line contains both markers in one line, e.g.:
        #   echo START_MARKER; cat /proc/cpuinfo; echo END_MARKER
        # The actual output has each marker on its OWN line:
        #   START_MARKER
        #   ...output...
        #   END_MARKER
        # Strategy: find lines where the marker is the ONLY significant content.
        lines = raw.splitlines()
        start_line = None
        end_line = None
        for i, line in enumerate(lines):
            stripped = line.strip()
            if start_line is None and stripped == start_marker:
                start_line = i
            elif start_line is not None and stripped == end_marker:
                end_line = i
                break

        if start_line is not None and end_line is not None:
            output = "\n".join(lines[start_line + 1 : end_line])
            return output.strip()

        # Fallback: markers not found on own lines. Try to skip the echoed
        # command line and grab everything between the second occurrences.
        second_start = raw.find(start_marker)
        if second_start != -1:
            second_start = raw.find(start_marker, second_start + len(start_marker))
        second_end = raw.find(end_marker)
        if second_end != -1:
            second_end = raw.find(end_marker, second_end + len(end_marker))
        if second_start != -1 and second_end != -1 and second_end > second_start:
            nl = raw.find("\n", second_start)
            after = nl + 1 if nl != -1 and nl < second_end else second_start + len(start_marker)
            return raw[after:second_end].strip()

        # Last fallback: skip the echoed command line(s), take everything until prompt
        result_lines = []
        past_echo = False
        for line in lines:
            stripped = line.strip()
            if not past_echo:
                # Skip until we see a line that looks like the echoed command
                if start_marker in stripped and end_marker in stripped:
                    past_echo = True
                elif "echo" in stripped and start_marker in stripped:
                    past_echo = True
                continue
            # Stop at shell prompt or end marker
            if self._has_prompt(stripped) or end_marker in stripped:
                break
            result_lines.append(line)
        if result_lines:
            return "\n".join(result_lines).strip()

        # Absolute last resort
        if self._debug:
            print(f"[debug] Could not extract output. Full raw:\n{raw}", file=sys.stderr)
        return raw.strip()

    # -- high-level queries --------------------------------------------------
    def get_cpu_id(self) -> str:
        """Read the CPU serial (ID) from /proc/cpuinfo."""
        output = self.run_command("cat /proc/cpuinfo")
        for line in output.splitlines():
            if ":" not in line:
                continue
            key, _, value = line.partition(":")
            if key.strip().lower() == "serial":
                return value.strip()
        raise RuntimeError(
            f"Could not find 'Serial' field in /proc/cpuinfo.\n"
            f"Full cpuinfo output:\n{output}"
        )

    def get_machine_id(self) -> str:
        """Read /etc/machine-id."""
        return self.run_command("cat /etc/machine-id")

    def get_hostname(self) -> str:
        """Read the hostname."""
        return self.run_command("hostname")

    def get_cpuinfo(self) -> str:
        """Return full /proc/cpuinfo."""
        return self.run_command("cat /proc/cpuinfo")


# ---------------------------------------------------------------------------
# Interactive shell (minicom-like)
# ---------------------------------------------------------------------------
def interactive_shell(console: SerialConsole):
    """Drop into an interactive serial console. Press Ctrl+] to exit."""
    import termios
    import tty

    print(f"Connected to {console.port} @ {console.baudrate} baud")
    print("Press Ctrl+] to exit.\n")

    assert console.ser is not None
    fd = console.ser.fileno()
    stdin_fd = sys.stdin.fileno()

    # Save and set terminal to raw mode
    old_settings = termios.tcgetattr(stdin_fd)
    try:
        tty.setraw(stdin_fd)
        # Send an initial newline to wake the console
        console._write("\n")

        while True:
            # Wait for data from either stdin or serial
            rlist, _, _ = select.select([stdin_fd, fd], [], [], 0.1)

            if stdin_fd in rlist:
                ch = os.read(stdin_fd, 1)
                if ch == b"\x1d":  # Ctrl+]
                    print("\r\nDisconnected.\r")
                    break
                console.ser.write(ch)

            if fd in rlist:
                data = console.ser.read(console.ser.in_waiting or 1)
                if data:
                    os.write(sys.stdout.fileno(), data)

    finally:
        termios.tcsetattr(stdin_fd, termios.TCSADRAIN, old_settings)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    # Common flags shared by all sub-commands (avoids "unrecognized arguments"
    # when the user puts --port after the sub-command).
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument(
        "--port", "-p",
        default=DEFAULT_PORT,
        help=f"Serial port device (default: {DEFAULT_PORT})",
    )
    common.add_argument(
        "--baud", "-b",
        type=int,
        default=DEFAULT_BAUD,
        help=f"Baud rate (default: {DEFAULT_BAUD})",
    )
    common.add_argument(
        "--timeout", "-t",
        type=float,
        default=DEFAULT_TIMEOUT,
        help=f"Command response timeout in seconds (default: {DEFAULT_TIMEOUT})",
    )
    common.add_argument(
        "--user", "-u",
        default=DEFAULT_USER,
        help=f"Login username for board authentication (default: {DEFAULT_USER})",
    )
    common.add_argument(
        "--password", "-P",
        default="",
        help="Login password (default: empty = passwordless). Use -P? to prompt interactively.",
    )
    common.add_argument(
        "--ask-password",
        action="store_true",
        default=False,
        help="Prompt for password interactively on the desktop (never shown in command history)",
    )
    common.add_argument(
        "--debug", "-v",
        action="store_true",
        default=False,
        help="Print verbose debug info (raw serial I/O) to stderr",
    )

    parser = argparse.ArgumentParser(
        description="Configure an RK dev board from a desktop over USB-to-serial.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
        parents=[common],
    )

    sub = parser.add_subparsers(dest="command", help="Sub-command to execute")

    # cpu-id
    sub.add_parser("cpu-id", parents=[common], help="Get CPU serial / ID from /proc/cpuinfo")

    # cpuinfo
    sub.add_parser("cpuinfo", parents=[common], help="Print full /proc/cpuinfo")

    # machine-id
    sub.add_parser("machine-id", parents=[common], help="Get /etc/machine-id")

    # hostname
    sub.add_parser("hostname", parents=[common], help="Get the board hostname")

    # run
    run_p = sub.add_parser("run", parents=[common], help="Run an arbitrary command on the board")
    run_p.add_argument("cmd", help="Command string to execute")

    # shell
    sub.add_parser("shell", parents=[common], help="Open an interactive serial console (Ctrl+] to exit)")

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    # Handle --ask-password: prompt interactively, never in shell history
    password = args.password
    if args.ask_password:
        import getpass
        password = getpass.getpass("Board password: ")
    # Use None internally to signal "prompt later if needed"
    if password == "" and not args.ask_password:
        password = ""  # try passwordless first

    # Verify the serial port exists
    if not os.path.exists(args.port):
        print(f"ERROR: Serial port {args.port} does not exist.", file=sys.stderr)
        print("Available serial ports:", file=sys.stderr)
        try:
            from serial.tools.list_ports import comports
            ports = list(comports())
            if ports:
                for p in ports:
                    print(f"  {p.device}  {p.description}", file=sys.stderr)
            else:
                print("  (none found)", file=sys.stderr)
        except Exception:
            print("  (could not enumerate — check /dev/ttyUSB* manually)", file=sys.stderr)
        sys.exit(1)

    print(f"Opening {args.port} @ {args.baud} baud (8N1, no flow control)")

    with SerialConsole(args.port, args.baud, args.timeout,
                       user=args.user, password=password,
                       debug=args.debug) as console:
        if args.command == "shell":
            interactive_shell(console)
            return

        # For non-interactive commands, first ensure we have a shell prompt
        try:
            console.wake()
        except RuntimeError as e:
            print(f"ERROR: {e}", file=sys.stderr)
            sys.exit(1)

        try:
            if args.command == "cpu-id":
                cpu_id = console.get_cpu_id()
                print(f"CPU ID: {cpu_id}")

            elif args.command == "cpuinfo":
                print(console.get_cpuinfo())

            elif args.command == "machine-id":
                print(f"Machine ID: {console.get_machine_id()}")

            elif args.command == "hostname":
                print(f"Hostname: {console.get_hostname()}")

            elif args.command == "run":
                output = console.run_command(args.cmd, timeout=args.timeout)
                print(output)

        except RuntimeError as e:
            print(f"ERROR: {e}", file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    main()
