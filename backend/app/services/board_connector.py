"""Wrapper around rk_board_config.py for detecting connected Rockchip boards."""

from __future__ import annotations

import base64
import json
import sys
import os

_backend_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _backend_root not in sys.path:
    sys.path.insert(0, _backend_root)

from rk_board_config import SerialConsole, DEFAULT_PORT  # noqa: E402

DEVICE_ID_PATH = "/etc/cyber-cap/device_id.json"


def detect_device(
    port: str = DEFAULT_PORT,
    baud: int = 1500000,
    timeout: float = 5.0,
    user: str = "cat",
    password: str = "",
) -> dict:
    """Connect to a board via serial and return its identity info.

    Returns:
        dict with key: serial_id (CPU serial number)
    Raises:
        RuntimeError on connection or detection failure.
    """
    with SerialConsole(port, baud, timeout, user=user, password=password) as console:
        console.wake()
        serial_id = console.get_cpu_id()

    return {
        "serial_id": serial_id,
    }


def read_device_identity(
    port: str,
    baud: int,
    timeout: float,
    user: str,
    password: str,
) -> dict | None:
    """Read /etc/cyber-cap/device_id.json from the board.

    Returns the parsed dict if the file exists and is valid JSON, or None otherwise.
    """
    with SerialConsole(port, baud, timeout, user=user, password=password) as console:
        console.wake()
        check = console.run_command(f"cat {DEVICE_ID_PATH} 2>/dev/null")

    if not check or "No such file" in check:
        return None
    try:
        return json.loads(check)
    except json.JSONDecodeError:
        return None


def write_device_identity(
    port: str,
    baud: int,
    timeout: float,
    user: str,
    password: str,
    device_id: str,
    readable_name: str,
    serial_id: str,
) -> None:
    """Write the device identity JSON to the board at /etc/cyber-cap/device_id.json.

    Creates the directory if it doesn't exist, then writes the JSON file.
    Raises RuntimeError on failure.
    """
    payload = json.dumps(
        {"device_id": device_id, "readable_name": readable_name, "serial_id": serial_id},
        indent=2,
    )

    with SerialConsole(port, baud, timeout, user=user, password=password) as console:
        console.wake()

        console.run_command("sudo mkdir -p /etc/cyber-cap")

        escaped = payload.replace("'", "'\\''")
        result = console.run_command(f"echo '{escaped}' | sudo tee {DEVICE_ID_PATH} > /dev/null")

        # Verify the write succeeded
        verify = console.run_command(f"cat {DEVICE_ID_PATH}")
        try:
            written = json.loads(verify)
            if written.get("device_id") != device_id:
                raise RuntimeError(
                    f"Verification failed: expected device_id '{device_id}', "
                    f"got '{written.get('device_id')}'"
                )
        except json.JSONDecodeError:
            raise RuntimeError(
                f"Verification failed: could not parse {DEVICE_ID_PATH} on board. "
                f"Raw content: {verify!r}"
            )


def copy_file_to_board(
    port: str,
    baud: int,
    timeout: float,
    user: str,
    password: str,
    local_path: str,
    remote_path: str,
) -> None:
    """Copy a local file to the board via serial using base64 transfer.

    Creates the remote directory with sudo if needed, then writes the file.
    Raises RuntimeError on failure, FileNotFoundError if local file missing.
    """
    if not os.path.isfile(local_path):
        raise FileNotFoundError(f"Local file not found: {local_path}")

    with open(local_path, "rb") as f:
        raw = f.read()
    encoded = base64.b64encode(raw).decode("ascii")

    remote_dir = os.path.dirname(remote_path)

    with SerialConsole(port, baud, timeout, user=user, password=password) as console:
        console.wake()

        if remote_dir:
            console.run_command(f"sudo mkdir -p {remote_dir}")

        console.run_command(
            f"echo '{encoded}' | base64 -d | sudo tee {remote_path} > /dev/null"
        )

        verify = console.run_command(f"sudo md5sum {remote_path}")

    import hashlib
    local_md5 = hashlib.md5(raw).hexdigest()
    if local_md5 not in verify:
        raise RuntimeError(
            f"Verification failed: local md5={local_md5}, board output: {verify!r}"
        )


WORKSPACE_DIR = "/home/cat/workspace/cyber-cap"
SCRIPTS_DIR = f"{WORKSPACE_DIR}/scripts"


def pull_code(
    port: str = DEFAULT_PORT,
    baud: int = 1500000,
    timeout: float = 30.0,
    user: str = "cat",
    password: str = "",
    branch: str = "dev",
) -> dict:
    """Pull latest code and checkout the specified branch on the board.

    Runs under /home/cat/workspace/cyber-cap:
        git pull; git checkout <branch>

    Returns dict with stdout from each command.
    Raises RuntimeError on failure.
    """
    with SerialConsole(port, baud, timeout, user=user, password=password) as console:
        console.wake()

        stash_output = console.run_command(f"cd {WORKSPACE_DIR} && git stash")
        pull_output = console.run_command(f"cd {WORKSPACE_DIR} && git pull")
        checkout_output = console.run_command(f"cd {WORKSPACE_DIR} && git checkout {branch}")

    return {
        "branch": branch,
        "stash_output": stash_output,
        "pull_output": pull_output,
        "checkout_output": checkout_output,
    }


AUTO_4G_SCRIPT = "/opt/auto_4G.sh"
AUTO_4G_SERVICE = "/etc/systemd/system/auto_4G.service"

# Use literal \n (not real newlines) so the entire printf command stays on one
# line when sent over the serial console.  printf interprets \n in the format
# string, so the resulting files will contain proper newlines.
AUTO_4G_SCRIPT_FMT = r"#!/bin/bash\nsudo quectel-CM -s cmnet\n"

AUTO_4G_SERVICE_FMT = (
    r"[Unit]\nDescription = auto_4G daemon\n\n"
    r"[Service]\nExecStart = /opt/auto_4G.sh\nRestart = always\nType = simple\n\n"
    r"[Install]\nWantedBy = multi-user.target\n"
)


def _run_sim_card_setup(console) -> dict:
    """Run SIM card 4G RNDIS configuration on an already-open console session."""
    results = {}

    console.run_command("cat /dev/ttyUSB2 &")
    results["at_usbnet"] = console.run_command(
        'echo -e "AT+QCFG=\\"usbnet\\",3\\r\\n" > /dev/ttyUSB2'
    )
    results["at_cfun"] = console.run_command(
        'echo -e "AT+CFUN=1,1\\r\\n" > /dev/ttyUSB2'
    )

    console.run_command(
        f"printf '{AUTO_4G_SCRIPT_FMT}' | sudo tee {AUTO_4G_SCRIPT} > /dev/null"
    )
    results["auto_4g_script"] = console.run_command(
        f"sudo chmod +x {AUTO_4G_SCRIPT}"
    )

    console.run_command(
        f"printf '{AUTO_4G_SERVICE_FMT}' | sudo tee {AUTO_4G_SERVICE} > /dev/null"
    )
    results["systemd_reload"] = console.run_command("sudo systemctl daemon-reload")

    results["enable"] = console.run_command("sudo systemctl enable auto_4G")
    results["start"] = console.run_command("sudo systemctl start auto_4G")

    return results


def run_deploy_scripts(
    port: str = DEFAULT_PORT,
    baud: int = 1500000,
    timeout: float = 120.0,
    user: str = "cat",
    password: str = "",
    configure_sim: bool = False,
) -> dict:
    """Run build.sh and install.sh sequentially on the board.

    Runs from /home/cat/workspace/cyber-cap with sudo.
    When configure_sim is True, SIM card 4G RNDIS setup is performed
    in the same serial session (before the connection is torn down).

    Returns dict with stdout from each script.
    Raises RuntimeError on failure.
    """
    scripts = ["bash ./scripts/requirement.sh", "./scripts/build.sh", "./scripts/install.sh"]
    results = {}
    sim_results = {}

    with SerialConsole(port, baud, timeout, user=user, password=password) as console:
        console.wake()
        resize_output = console.run_command("sudo resize2fs /dev/mmcblk0p3")
        results["resize2fs"] = resize_output
        for script in scripts:
            output = console.run_command(f"cd {WORKSPACE_DIR} && sudo {script}")
            results[script] = output

        if configure_sim:
            sim_results = _run_sim_card_setup(console)

    out = {"scripts_dir": WORKSPACE_DIR, "results": results}
    if configure_sim:
        out["sim_results"] = sim_results
    return out


def configure_sim_card(
    port: str = DEFAULT_PORT,
    baud: int = 1500000,
    timeout: float = 120.0,
    user: str = "cat",
    password: str = "",
) -> dict:
    """Configure SIM card for 4G RNDIS mode and set up auto-start service (standalone).

    Opens its own serial session. Prefer passing configure_sim=True to
    run_deploy_scripts when running as part of a deploy to avoid
    reconnection issues if the board reboots.
    """
    with SerialConsole(port, baud, timeout, user=user, password=password) as console:
        console.wake()
        return _run_sim_card_setup(console)
