#!/usr/bin/env python3
"""Check auth autoconfirm settings on CVM."""
import os
import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pwd = os.environ.get("DEPLOY_SSH_PASSWORD", "")
if not pwd:
    raise SystemExit("Set DEPLOY_SSH_PASSWORD")
ssh.connect("146.56.200.250", username="ubuntu", password=pwd, timeout=30, allow_agent=False, look_for_keys=False)
cmds = [
    "grep -E '^ENABLE_EMAIL_(SIGNUP|AUTOCONFIRM)=' ~/supabase/docker/.env || true",
    "sudo docker-compose -f ~/supabase/docker/docker-compose.yml exec -T auth env 2>/dev/null | grep -iE 'MAILER_AUTOCONFIRM|EXTERNAL_EMAIL|ENABLE_SIGNUP' || true",
    "cd ~/supabase/docker && sudo docker-compose exec -T db psql -U postgres -d postgres -tAc \"select count(*) from auth.users where email_confirmed_at is null\"",
]
for c in cmds:
    print(">", c)
    _, o, _ = ssh.exec_command(c)
    print(o.read().decode().strip() or "(empty)")
ssh.close()
