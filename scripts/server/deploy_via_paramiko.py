#!/usr/bin/env python3
"""Deploy scene-ai-agent to CVM via SSH/SFTP. Password via DEPLOY_SSH_PASSWORD env."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import paramiko

HOST = os.environ.get("DEPLOY_SSH_HOST", "146.56.200.250")
USER = os.environ.get("DEPLOY_SSH_USER", "ubuntu")
PASSWORD = os.environ.get("DEPLOY_SSH_PASSWORD", "")
REPO = Path(__file__).resolve().parents[2]


def run(ssh: paramiko.SSHClient, cmd: str) -> tuple[int, str, str]:
    print(f"$ {cmd}")
    _, stdout, stderr = ssh.exec_command(cmd, get_pty=True)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip())
    if err.strip():
        print(err.rstrip(), file=sys.stderr)
    return code, out, err


def sftp_mkdirs(sftp: paramiko.SFTPClient, remote_dir: str) -> None:
    parts = remote_dir.strip("/").split("/")
    cur = ""
    for part in parts:
        cur = f"{cur}/{part}" if cur else f"/{part}" if remote_dir.startswith("/") else part
        if remote_dir.startswith("/") and not cur.startswith("/"):
            cur = "/" + cur
        try:
            sftp.stat(cur if remote_dir.startswith("/") else f"./{cur}" if not cur.startswith("/") else cur)
        except OSError:
            try:
                sftp.mkdir(cur)
            except OSError:
                pass


def upload_dir(sftp: paramiko.SFTPClient, local: Path, remote: str) -> None:
    sftp_mkdirs(sftp, remote)
    for item in local.iterdir():
        r = f"{remote.rstrip('/')}/{item.name}"
        if item.is_dir():
            upload_dir(sftp, item, r)
        else:
            print(f"  upload {item.name} -> {r}")
            sftp.put(str(item), r)


def main() -> int:
    if not PASSWORD:
        print("Set DEPLOY_SSH_PASSWORD", file=sys.stderr)
        return 1

    fn_src = REPO / "supabase/functions/scene-ai-agent"
    deploy_sh = REPO / "scripts/server/deploy_scene_ai_agent.sh"
    for p in (fn_src, deploy_sh):
        if not p.exists():
            print(f"Missing {p}", file=sys.stderr)
            return 1

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"==> Connect {USER}@{HOST}")
    ssh.connect(HOST, username=USER, password=PASSWORD, timeout=30, allow_agent=False, look_for_keys=False)

    run(ssh, "mkdir -p ~/upaiego-management/supabase/functions/scene-ai-agent")

    sftp = ssh.open_sftp()
    print("==> Upload scene-ai-agent")
    upload_dir(sftp, fn_src, "/home/ubuntu/upaiego-management/supabase/functions/scene-ai-agent")
    print("==> Upload deploy script")
    sftp.put(str(deploy_sh), "/home/ubuntu/deploy_scene_ai_agent.sh")
    sftp.close()

    print("==> Deploy edge function")
    code, _, _ = run(
        ssh,
        "chmod +x ~/deploy_scene_ai_agent.sh && bash ~/deploy_scene_ai_agent.sh ~/upaiego-management",
    )

    ssh.close()
    print("Done." if code == 0 else f"Deploy exited {code}")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
