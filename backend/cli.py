#!/usr/bin/env python3
"""
fleet — CLI tool for Cyber Cap hardware fleet management.

Connects directly to the fleet database (SQLite or Supabase PostgreSQL)
via the DATABASE_URL environment variable or a .env file.

Usage:
    python cli.py detect    [--port /dev/ttyUSB0]
    python cli.py generate
    python cli.py register  [--port /dev/ttyUSB0 | --serial-id ID]
    python cli.py provision [--port /dev/ttyUSB0]
    python cli.py list      [--status active] [--calibration pending] [--limit 20]
    python cli.py search   <query>
    python cli.py get      <device_id>
    python cli.py update   <device_id> [--status ...] [--calibration ...] [--firmware ...] [--notes ...]
    python cli.py delete   <device_id>
    python cli.py lookup   <name> [<name> ...]
    python cli.py name     <device_id> [<device_id> ...]
    python cli.py qr       <device_id> [-o output.png]
    python cli.py pull-code [--port /dev/ttyUSB0] [--branch dev]
    python cli.py deploy    [--port /dev/ttyUSB0]
    python cli.py sim-config [--port /dev/ttyUSB0]
    python cli.py copy-cert [--file emqxsl-ca.crt] [--port /dev/ttyUSB0]
"""

from __future__ import annotations

import argparse
import os
import sys

_here = os.path.dirname(os.path.abspath(__file__))
if _here not in sys.path:
    sys.path.insert(0, _here)

from app.database import Base, engine, SessionLocal
from app.models import Device  # noqa: F401 — needed so Base knows about the table
from app.services import device_service, qr_service
from app.services.board_connector import (
    detect_device as hw_detect_device,
    read_device_identity,
    write_device_identity,
    copy_file_to_board,
    pull_code as hw_pull_code,
    run_deploy_scripts as hw_run_deploy_scripts,
    configure_sim_card as hw_configure_sim_card,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_db():
    """Return a DB session. Caller must close it."""
    Base.metadata.create_all(bind=engine)
    return SessionLocal()


def _print_device(dev: Device, verbose: bool = False):
    """Pretty-print a single device."""
    reg = dev.registered_at.strftime("%Y-%m-%d %H:%M") if dev.registered_at else "-"
    seen = dev.last_seen.strftime("%Y-%m-%d %H:%M") if dev.last_seen else "-"
    cal_date = dev.calibration_date.strftime("%Y-%m-%d") if dev.calibration_date else "-"

    print(f"  Name:        {dev.readable_name}")
    print(f"  Device ID:   {dev.device_id}")
    print(f"  Serial ID:   {dev.serial_id or '-'}")
    print(f"  Status:      {dev.status}")
    print(f"  Calibration: {dev.calibration_status}")
    if verbose:
        print(f"  Cal. Date:   {cal_date}")
        print(f"  Firmware:    {dev.firmware_version or '-'}")
        print(f"  Registered:  {reg}")
        print(f"  Last Seen:   {seen}")
        print(f"  Notes:       {dev.notes or '-'}")


def _print_table(devices: list[Device]):
    """Print a compact table of devices."""
    if not devices:
        print("  (no devices)")
        return

    header = f"{'Name':<12} {'Device ID':<38} {'Serial ID':<22} {'Status':<14} {'Calibration':<20} {'Registered':<12}"
    print(header)
    print("-" * len(header))
    for d in devices:
        reg = d.registered_at.strftime("%Y-%m-%d") if d.registered_at else "-"
        print(
            f"{d.readable_name:<12} "
            f"{d.device_id:<38} "
            f"{(d.serial_id or '-'):<22} "
            f"{d.status:<14} "
            f"{d.calibration_status:<20} "
            f"{reg:<12}"
        )


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def cmd_detect(args):
    """Detect a connected board and print its serial ID (CPU serial)."""
    print(f"Detecting device on {args.port} @ {args.baud} baud ...")
    try:
        info = hw_detect_device(
            port=args.port, baud=args.baud, timeout=args.timeout,
            user=args.user, password=args.password,
        )
    except RuntimeError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"\nDevice found:")
    print(f"  Serial ID:  {info['serial_id']}")


def cmd_generate(args):
    """Generate a new (device_id, readable_name) pair."""
    db = _get_db()
    try:
        device_id, readable_name = device_service.generate_device_id_pair(db)
    finally:
        db.close()

    print(f"Generated device identity:")
    print(f"  Device ID:      {device_id}")
    print(f"  Readable Name:  {readable_name}")


def cmd_register(args):
    """Register a device (auto-detect or manual)."""
    serial_id = None

    if args.serial_id:
        serial_id = args.serial_id
        print(f"Registering device with serial_id={serial_id} (manual entry) ...")
    elif args.port:
        print(f"Detecting device on {args.port} ...")
        try:
            info = hw_detect_device(
                port=args.port, baud=args.baud, timeout=args.timeout,
                user=args.user, password=args.password,
            )
        except RuntimeError as e:
            print(f"ERROR: {e}", file=sys.stderr)
            sys.exit(1)
        serial_id = info["serial_id"]
        print(f"Detected serial ID: {serial_id}")
    else:
        print("ERROR: Provide --serial-id or --port for auto-detection.", file=sys.stderr)
        sys.exit(1)

    db = _get_db()
    try:
        device_id, readable_name = device_service.generate_device_id_pair(db)
        dev = device_service.register_device(db, device_id, readable_name, serial_id)
    except ValueError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        db.close()

    print(f"\nRegistered successfully!")
    _print_device(dev)

    png = qr_service.generate_qr_png(dev.device_id, dev.readable_name)
    qr_file = f"{dev.readable_name}-qr.png"
    with open(qr_file, "wb") as f:
        f.write(png)
    print(f"\n  QR code saved to: {qr_file}")


def cmd_provision(args):
    """One-shot device provisioning: detect, generate IDs, write to board, QR, register."""
    port = args.port
    baud = args.baud
    timeout = args.timeout
    user = args.user
    password = args.password

    # Step 1: Connect and get serial ID
    print(f"[1/5] Detecting device on {port} @ {baud} baud ...")
    try:
        info = hw_detect_device(
            port=port, baud=baud, timeout=timeout,
            user=user, password=password,
        )
    except RuntimeError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
    serial_id = info["serial_id"]
    print(f"      Serial ID: {serial_id}")

    # Step 2: Check for existing identity on board
    print("[2/5] Checking for existing identity on board ...")
    try:
        existing = read_device_identity(
            port=port, baud=baud, timeout=timeout,
            user=user, password=password,
        )
    except RuntimeError:
        existing = None

    if existing and existing.get("device_id") and existing.get("readable_name"):
        device_id = existing["device_id"]
        readable_name = existing["readable_name"]
        print(f"      Found existing identity on board:")
        print(f"      Device ID:      {device_id}")
        print(f"      Readable Name:  {readable_name}")
    else:
        print("      No existing identity found. Generating new one ...")
        db = _get_db()
        try:
            device_id, readable_name = device_service.generate_device_id_pair(db)
        finally:
            db.close()
        print(f"      Device ID:      {device_id}")
        print(f"      Readable Name:  {readable_name}")

        # Step 3: Write identity to hardware
        print(f"[3/5] Writing identity to board at /etc/cyber-cap/device_id.json ...")
        try:
            write_device_identity(
                port=port, baud=baud, timeout=timeout,
                user=user, password=password,
                device_id=device_id, readable_name=readable_name,
                serial_id=serial_id,
            )
        except RuntimeError as e:
            print(f"ERROR: Failed to write to board: {e}", file=sys.stderr)
            sys.exit(1)
        print("      Written and verified.")

    # Step 4: Generate QR code
    print("[4/5] Generating QR code ...")
    png = qr_service.generate_qr_png(device_id, readable_name)
    qr_file = f"{readable_name}-qr.png"
    with open(qr_file, "wb") as f:
        f.write(png)
    print(f"      Saved to: {qr_file}")

    # Step 5: Register in database
    print("[5/5] Registering in database ...")
    db = _get_db()
    try:
        dev = device_service.register_device(db, device_id, readable_name, serial_id)
    except ValueError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        db.close()

    print(f"\nProvisioning complete!")
    _print_device(dev, verbose=True)


def cmd_list(args):
    """List all devices with optional filters."""
    db = _get_db()
    try:
        total, devices = device_service.list_devices(
            db,
            offset=args.offset,
            limit=args.limit,
            status=args.status or None,
            calibration_status=args.calibration or None,
        )
    finally:
        db.close()

    print(f"Devices ({total} total):\n")
    _print_table(devices)


def cmd_search(args):
    """Search devices by keyword."""
    db = _get_db()
    try:
        total, devices = device_service.search_devices(db, args.query, limit=args.limit)
    finally:
        db.close()

    print(f"Search results for '{args.query}' ({total} found):\n")
    _print_table(devices)


def cmd_get(args):
    """Get detailed info on a single device."""
    db = _get_db()
    try:
        dev = device_service.get_device(db, args.device_id)
    finally:
        db.close()

    if dev is None:
        print(f"ERROR: Device '{args.device_id}' not found.", file=sys.stderr)
        sys.exit(1)

    print(f"Device detail:\n")
    _print_device(dev, verbose=True)


def cmd_update(args):
    """Update fields on a device."""
    kwargs = {}
    if args.status:
        kwargs["status"] = args.status
    if args.calibration:
        kwargs["calibration_status"] = args.calibration
    if args.firmware:
        kwargs["firmware_version"] = args.firmware
    if args.notes:
        kwargs["notes"] = args.notes

    if not kwargs:
        print("ERROR: No fields to update. Use --status, --calibration, --firmware, or --notes.",
              file=sys.stderr)
        sys.exit(1)

    db = _get_db()
    try:
        dev = device_service.update_device(db, args.device_id, **kwargs)
    finally:
        db.close()

    if dev is None:
        print(f"ERROR: Device '{args.device_id}' not found.", file=sys.stderr)
        sys.exit(1)

    print(f"Updated successfully:\n")
    _print_device(dev, verbose=True)


def cmd_delete(args):
    """Soft-delete (retire) a device."""
    db = _get_db()
    try:
        dev = device_service.delete_device(db, args.device_id)
    finally:
        db.close()

    if dev is None:
        print(f"ERROR: Device '{args.device_id}' not found.", file=sys.stderr)
        sys.exit(1)

    print(f"Device '{dev.readable_name}' ({dev.device_id}) has been retired.")


def cmd_qr(args):
    """Generate and save a QR code for a device."""
    db = _get_db()
    try:
        dev = device_service.get_device(db, args.device_id)
    finally:
        db.close()

    if dev is None:
        print(f"ERROR: Device '{args.device_id}' not found.", file=sys.stderr)
        sys.exit(1)

    png = qr_service.generate_qr_png(dev.device_id, dev.readable_name)
    out = args.output or f"{dev.readable_name}-qr.png"
    with open(out, "wb") as f:
        f.write(png)
    print(f"QR code for {dev.readable_name} saved to: {out}")


def cmd_pull_code(args):
    """Pull latest code and checkout a branch on the connected board."""
    print(f"Pulling code on board ({args.port}) and checking out '{args.branch}' ...")
    try:
        result = hw_pull_code(
            port=args.port, baud=args.baud, timeout=args.timeout,
            user=args.user, password=args.password,
            branch=args.branch,
        )
    except RuntimeError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"\ngit stash output:\n{result['stash_output']}")
    print(f"\ngit pull output:\n{result['pull_output']}")
    print(f"\ngit checkout {args.branch} output:\n{result['checkout_output']}")
    print("\nDone.")


def cmd_deploy(args):
    """Run build and install scripts on the connected board, then configure SIM card."""
    print(f"Running deploy scripts on board ({args.port}) ...")
    try:
        result = hw_run_deploy_scripts(
            port=args.port, baud=args.baud, timeout=args.timeout,
            user=args.user, password=args.password,
            configure_sim=True,
        )
    except RuntimeError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    for script, output in result["results"].items():
        print(f"\n--- {script} ---\n{output}")

    if "sim_results" in result:
        print("\n--- SIM card (4G RNDIS) configuration ---")
        for step, output in result["sim_results"].items():
            print(f"  [{step}] {output}")

    print("\nDeploy complete.")


def cmd_sim_config(args):
    """Configure SIM card for 4G RNDIS mode and set up auto-start service."""
    print(f"Configuring SIM card (4G RNDIS) on board ({args.port}) ...")
    try:
        result = hw_configure_sim_card(
            port=args.port, baud=args.baud, timeout=args.timeout,
            user=args.user, password=args.password,
        )
    except RuntimeError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    for step, output in result.items():
        print(f"  [{step}] {output}")
    print("\nSIM card configuration complete.")


def cmd_lookup(args):
    """Look up device_id(s) by readable_name(s)."""
    import json

    names = args.names
    detail = args.detail
    db = _get_db()
    try:
        devices = device_service.get_devices_by_readable_names(db, names)
    finally:
        db.close()

    found = {d.readable_name: d for d in devices}
    missing = [n for n in names if n not in found]

    if detail:
        results = []
        for name in names:
            if name in found:
                d = found[name]
                results.append({
                    "device_id": d.device_id,
                    "readable_name": d.readable_name,
                    "serial_id": d.serial_id,
                })
            else:
                results.append({
                    "device_id": None,
                    "readable_name": name,
                    "serial_id": None,
                    "error": "not found",
                })
        print(json.dumps(results if len(results) > 1 else results[0], indent=4))
    else:
        for name in names:
            if name in found:
                print(f"{name}\t{found[name].device_id}")
            else:
                print(f"{name}\t(not found)", file=sys.stderr)

    if missing:
        sys.exit(1)


def cmd_name(args):
    """Look up readable_name(s) by device_id(s)."""
    ids = args.device_ids
    db = _get_db()
    try:
        devices = device_service.get_devices_by_ids(db, ids)
    finally:
        db.close()

    found = {d.device_id: d.readable_name for d in devices}
    missing = [did for did in ids if did not in found]

    for did in ids:
        if did in found:
            print(f"{did}\t{found[did]}")
        else:
            print(f"{did}\t(not found)", file=sys.stderr)

    if missing:
        sys.exit(1)


BOARD_CERT_PATH = "/etc/cyber-cap/certs/emqxsl-ca.crt"


def cmd_copy_cert(args):
    """Copy emqxsl-ca.crt from local directory to the board."""
    local_path = args.file
    print(f"Copying {local_path} -> board:{BOARD_CERT_PATH} ...")
    try:
        copy_file_to_board(
            port=args.port, baud=args.baud, timeout=args.timeout,
            user=args.user, password=args.password,
            local_path=local_path,
            remote_path=BOARD_CERT_PATH,
        )
    except FileNotFoundError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
    except RuntimeError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    print("Done. Certificate copied and verified.")


# ---------------------------------------------------------------------------
# Argument parser
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="fleet",
        description="Cyber Cap fleet management CLI. Connects to the fleet database directly.",
    )
    sub = parser.add_subparsers(dest="command", help="Command to run")

    # -- detect --
    p = sub.add_parser("detect", help="Detect a connected board via serial")
    p.add_argument("--port", "-p", default="/dev/ttyUSB0", help="Serial port")
    p.add_argument("--baud", "-b", type=int, default=1500000, help="Baud rate")
    p.add_argument("--timeout", "-t", type=float, default=5.0, help="Timeout (s)")
    p.add_argument("--user", "-u", default="cat", help="Board login user")
    p.add_argument("--password", "-P", default="", help="Board login password")

    # -- generate --
    sub.add_parser("generate", help="Generate a new device_id / readable_name pair")

    # -- register --
    p = sub.add_parser("register", help="Register a new device")
    p.add_argument("--port", default="/dev/ttyUSB0", help="Serial port (for auto-detect)")
    p.add_argument("--baud", type=int, default=1500000, help="Baud rate")
    p.add_argument("--timeout", type=float, default=5.0, help="Timeout (s)")
    p.add_argument("--user", default="cat", help="Board login user")
    p.add_argument("--password", default="", help="Board login password")
    p.add_argument("--serial-id", default=None, help="CPU serial ID (manual entry, skips auto-detect)")

    # -- provision --
    p = sub.add_parser("provision", help="One-shot: detect + generate IDs + write to board + QR + register")
    p.add_argument("--port", "-p", default="/dev/ttyUSB0", help="Serial port")
    p.add_argument("--baud", "-b", type=int, default=1500000, help="Baud rate")
    p.add_argument("--timeout", "-t", type=float, default=5.0, help="Timeout (s)")
    p.add_argument("--user", "-u", default="cat", help="Board login user")
    p.add_argument("--password", "-P", default="", help="Board login password")

    # -- list --
    p = sub.add_parser("list", help="List all devices")
    p.add_argument("--status", "-s", default="", help="Filter by status")
    p.add_argument("--calibration", "-c", default="", help="Filter by calibration status")
    p.add_argument("--offset", type=int, default=0, help="Offset for pagination")
    p.add_argument("--limit", "-l", type=int, default=50, help="Max results")

    # -- search --
    p = sub.add_parser("search", help="Search devices")
    p.add_argument("query", help="Search query string")
    p.add_argument("--limit", "-l", type=int, default=50, help="Max results")

    # -- get --
    p = sub.add_parser("get", help="Get detail of a single device")
    p.add_argument("device_id", help="Device ID to look up")

    # -- update --
    p = sub.add_parser("update", help="Update device fields")
    p.add_argument("device_id", help="Device ID to update")
    p.add_argument("--status", "-s", default=None, help="New status (active/inactive/maintenance/retired)")
    p.add_argument("--calibration", "-c", default=None, help="Calibration status (pending/calibrated/needs_recalibration)")
    p.add_argument("--firmware", "-f", default=None, help="Firmware version")
    p.add_argument("--notes", "-n", default=None, help="Notes")

    # -- delete --
    p = sub.add_parser("delete", help="Retire (soft-delete) a device")
    p.add_argument("device_id", help="Device ID to retire")

    # -- qr --
    p = sub.add_parser("qr", help="Generate QR code for a device")
    p.add_argument("device_id", help="Device ID")
    p.add_argument("-o", "--output", default=None, help="Output file path (default: <name>-qr.png)")

    # -- lookup --
    p = sub.add_parser("lookup", help="Look up device_id by readable_name (supports batch)")
    p.add_argument("names", nargs="+", help="One or more readable names to look up")
    p.add_argument("--detail", "-d", action="store_true", help="Output full JSON with device_id, readable_name, serial_id")

    # -- name --
    p = sub.add_parser("name", help="Look up readable_name by device_id (supports batch)")
    p.add_argument("device_ids", nargs="+", help="One or more device IDs to look up")

    # -- pull-code --
    p = sub.add_parser("pull-code", help="Pull latest code and checkout a branch on the board")
    p.add_argument("--port", "-p", default="/dev/cu.usbserial-A5069RR4", help="Serial port")
    p.add_argument("--baud", "-b", type=int, default=1500000, help="Baud rate")
    p.add_argument("--timeout", "-t", type=float, default=30.0, help="Timeout (s)")
    p.add_argument("--user", "-u", default="cat", help="Board login user")
    p.add_argument("--password", "-P", default="", help="Board login password")
    p.add_argument("--branch", default="dev", help="Branch to checkout (default: dev)")

    # -- deploy --
    p = sub.add_parser("deploy", help="Run build.sh and install.sh on the board")
    p.add_argument("--port", "-p", default="/dev/cu.usbserial-A5069RR4", help="Serial port")
    p.add_argument("--baud", "-b", type=int, default=1500000, help="Baud rate")
    p.add_argument("--timeout", "-t", type=float, default=120.0, help="Timeout (s)")
    p.add_argument("--user", "-u", default="cat", help="Board login user")
    p.add_argument("--password", "-P", default="", help="Board login password")

    # -- sim-config --
    p = sub.add_parser("sim-config", help="Configure SIM card for 4G RNDIS and auto-start service")
    p.add_argument("--port", "-p", default="/dev/cu.usbserial-A5069RR4", help="Serial port")
    p.add_argument("--baud", "-b", type=int, default=1500000, help="Baud rate")
    p.add_argument("--timeout", "-t", type=float, default=120.0, help="Timeout (s)")
    p.add_argument("--user", "-u", default="cat", help="Board login user")
    p.add_argument("--password", "-P", default="", help="Board login password")

    # -- copy-cert --
    p = sub.add_parser("copy-cert", help="Copy emqxsl-ca.crt to the board")
    p.add_argument("--file", "-f", default="emqxsl-ca.crt", help="Local cert file path (default: emqxsl-ca.crt)")
    p.add_argument("--port", "-p", default="/dev/cu.usbserial-A5069RR4", help="Serial port")
    p.add_argument("--baud", "-b", type=int, default=1500000, help="Baud rate")
    p.add_argument("--timeout", "-t", type=float, default=30.0, help="Timeout (s)")
    p.add_argument("--user", "-u", default="cat", help="Board login user")
    p.add_argument("--password", "-P", default="", help="Board login password")

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    commands = {
        "detect": cmd_detect,
        "generate": cmd_generate,
        "register": cmd_register,
        "provision": cmd_provision,
        "list": cmd_list,
        "search": cmd_search,
        "get": cmd_get,
        "update": cmd_update,
        "delete": cmd_delete,
        "qr": cmd_qr,
        "lookup": cmd_lookup,
        "name": cmd_name,
        "pull-code": cmd_pull_code,
        "deploy": cmd_deploy,
        "sim-config": cmd_sim_config,
        "copy-cert": cmd_copy_cert,
    }

    commands[args.command](args)


if __name__ == "__main__":
    main()
