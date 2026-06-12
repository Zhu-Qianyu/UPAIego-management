import os
import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(
    "146.56.200.250",
    username="ubuntu",
    password=os.environ["DEPLOY_SSH_PASSWORD"],
    timeout=30,
    allow_agent=False,
    look_for_keys=False,
)
cmds = [
    'sudo docker ps --format "{{.Names}} {{.Status}}" | grep function',
    'curl -s -o /dev/null -w "OPTIONS %{http_code}\n" -X OPTIONS http://127.0.0.1:8000/functions/v1/scene-ai-agent',
    "sudo docker logs supabase-edge-functions --tail 10 2>&1",
]
for c in cmds:
    print(">", c)
    _, o, e = ssh.exec_command(c)
    print(o.read().decode())
    err = e.read().decode()
    if err.strip():
        print(err)
ssh.close()
