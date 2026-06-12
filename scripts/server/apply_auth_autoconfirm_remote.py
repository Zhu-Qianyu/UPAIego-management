#!/usr/bin/env python3
"""Apply ENABLE_EMAIL_AUTOCONFIRM=true on self-hosted Supabase via SSH."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import paramiko

HOST = os.environ.get("DEPLOY_SSH_HOST", "146.56.200.250")
USER = os.environ.get("DEPLOY_SSH_USER", "ubuntu")
PASSWORD = os.environ.get("DEPLOY_SSH_PASSWORD", "")
FIX_SH = Path(__file__).resolve().parent / "fix_auth_email_autoconfirm.sh"


def main() -> int:
    if not PASSWORD:
        print("Set DEPLOY_SSH_PASSWORD then rerun.", file=sys.stderr)
        return 1
    if not FIX_SH.is_file():
        print(f"Missing {FIX_SH}", file=sys.stderr)
        return 1

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"==> Connect {USER}@{HOST}")
    ssh.connect(HOST, username=USER, password=PASSWORD, timeout=30, allow_agent=False, look_for_keys=False)

    remote = "/home/ubuntu/fix_auth_email_autoconfirm.sh"
    sftp = ssh.open_sftp()
    sftp.put(str(FIX_SH), remote)
    sftp.chmod(remote, 0o755)
    sftp.close()

    cmd = f"bash {remote}"
    print(f"$ {cmd}")
    _, stdout, stderr = ssh.exec_command(cmd, get_pty=True)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip())
    if err.strip():
        print(err.rstrip(), file=sys.stderr)
    ssh.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
