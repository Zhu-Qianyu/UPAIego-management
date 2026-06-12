#!/usr/bin/env python3
"""Apply group chat + direct chat SQL migrations on CVM. Password via DEPLOY_SSH_PASSWORD."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import paramiko

HOST = os.environ.get("DEPLOY_SSH_HOST", "146.56.200.250")
USER = os.environ.get("DEPLOY_SSH_USER", "ubuntu")
PASSWORD = os.environ.get("DEPLOY_SSH_PASSWORD", "")
REPO = Path(__file__).resolve().parents[2]

SQL_FILES = [
    "docs/GROUP_CHAT_MIGRATION.sql",
    "docs/GROUP_CHAT_RLS_FIX.sql",
    "docs/DIRECT_CHAT_MIGRATION.sql",
]

PSQL_CMD = (
    "cd ~/supabase/docker && "
    "sudo docker-compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1"
)


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


def main() -> int:
    if not PASSWORD:
        print("Set DEPLOY_SSH_PASSWORD", file=sys.stderr)
        return 1

    for rel in SQL_FILES:
        if not (REPO / rel).exists():
            print(f"Missing {REPO / rel}", file=sys.stderr)
            return 1

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"==> Connect {USER}@{HOST}")
    ssh.connect(HOST, username=USER, password=PASSWORD, timeout=30, allow_agent=False, look_for_keys=False)

    sftp = ssh.open_sftp()
    for rel in SQL_FILES:
        name = Path(rel).name
        remote = f"/home/ubuntu/{name}"
        print(f"==> Upload {rel} -> {remote}")
        sftp.put(str(REPO / rel), remote)
    sftp.close()

    for rel in SQL_FILES:
        name = Path(rel).name
        print(f"==> Apply {name}")
        code, out, err = run(ssh, f"{PSQL_CMD} < ~/{name}")
        if code != 0:
            print(f"FAILED {name} (exit {code})", file=sys.stderr)
            ssh.close()
            return code

    print("==> Verify tables")
    verify = """
SELECT CASE WHEN to_regclass('public.group_chat_messages') IS NOT NULL THEN 'OK group_chat_messages' ELSE 'MISSING group_chat_messages' END
UNION ALL
SELECT CASE WHEN to_regclass('public.direct_conversations') IS NOT NULL THEN 'OK direct_conversations' ELSE 'MISSING direct_conversations' END
UNION ALL
SELECT CASE WHEN to_regclass('public.direct_messages') IS NOT NULL THEN 'OK direct_messages' ELSE 'MISSING direct_messages' END
UNION ALL
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'insert_group_bot_message'
) THEN 'OK insert_group_bot_message' ELSE 'MISSING insert_group_bot_message' END;
"""
    run(
        ssh,
        f"cd ~/supabase/docker && sudo docker-compose exec -T db psql -U postgres -d postgres -c \"{verify.replace(chr(10), ' ')}\"",
    )

    ssh.close()
    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
