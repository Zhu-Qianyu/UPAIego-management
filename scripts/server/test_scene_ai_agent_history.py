#!/usr/bin/env python3
import json, subprocess, urllib.request

def sh(cmd):
    return subprocess.check_output(cmd, shell=True, text=True).strip()

anon = sh("docker exec supabase-edge-functions printenv SUPABASE_ANON_KEY")
jwt_secret = sh("docker exec supabase-edge-functions printenv JWT_SECRET")
user_id = sh("docker exec supabase-db psql -U postgres -d postgres -tAc \"select user_id from group_members where group_id='36b09527-3293-4e4e-b964-2800a9574d8d' and membership_status='active' limit 1\"").strip()
group_id = "36b09527-3293-4e4e-b964-2800a9574d8d"

import jwt
token = jwt.encode(
    {"sub": user_id, "role": "authenticated", "aud": "authenticated", "iss": "supabase", "exp": 9999999999},
    jwt_secret,
    algorithm="HS256",
)

rows = sh(f"docker exec supabase-db psql -U postgres -d postgres -tAc \"select role || '|||' || content from agent_chat_messages where group_id='{group_id}' order by created_at asc limit 30\"")
messages = []
for line in rows.splitlines():
    if '|||' not in line:
        continue
    role, content = line.split('|||', 1)
    role = role.strip()
    if role in ('user', 'assistant'):
        messages.append({"role": role, "content": content})

payload = {
    "groupId": group_id,
    "messages": messages + [{"role": "user", "content": "你好"}],
    "images": [],
    "existingMacros": [],
    "pageContext": {
        "route": "/admin",
        "pageTitle": "管理台",
        "role": "admin",
        "navItems": [{"path": "/admin", "label": "管理台"}],
    },
}

body = json.dumps(payload).encode()
print("messages", len(payload["messages"]), "bytes", len(body))

req = urllib.request.Request(
    "http://127.0.0.1:8000/functions/v1/scene-ai-agent",
    data=body,
    headers={"Authorization": f"Bearer {token}", "apikey": anon, "Content-Type": "application/json"},
    method="POST",
)

try:
    with urllib.request.urlopen(req, timeout=120) as resp:
        print("HTTP", resp.status)
        print(resp.read().decode()[:500])
except urllib.error.HTTPError as e:
    print("HTTP", e.code)
    print(e.read().decode()[:800])
