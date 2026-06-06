#!/usr/bin/env python3
import json, os, subprocess, urllib.request

def sh(cmd):
    return subprocess.check_output(cmd, shell=True, text=True).strip()

anon = sh("docker exec supabase-edge-functions printenv SUPABASE_ANON_KEY")
jwt_secret = sh("docker exec supabase-edge-functions printenv JWT_SECRET")
user_id = sh("docker exec supabase-db psql -U postgres -d postgres -tAc \"select user_id from group_members where group_id='36b09527-3293-4e4e-b964-2800a9574d8d' and membership_status='active' limit 1\"").strip()
group_id = "36b09527-3293-4e4e-b964-2800a9574d8d"

try:
    import jwt
except ImportError:
    subprocess.check_call(["pip3", "install", "-q", "PyJWT"])
    import jwt

token = jwt.encode(
    {"sub": user_id, "role": "authenticated", "aud": "authenticated", "iss": "supabase", "exp": 9999999999},
    jwt_secret,
    algorithm="HS256",
)

body = json.dumps({
    "groupId": group_id,
    "messages": [{"role": "user", "content": "你好"}],
    "images": [],
    "existingMacros": [],
}).encode()

req = urllib.request.Request(
    "http://127.0.0.1:8000/functions/v1/scene-ai-agent",
    data=body,
    headers={
        "Authorization": f"Bearer {token}",
        "apikey": anon,
        "Content-Type": "application/json",
    },
    method="POST",
)

try:
    with urllib.request.urlopen(req, timeout=120) as resp:
        print("HTTP", resp.status)
        print(resp.read().decode()[:800])
except urllib.error.HTTPError as e:
    print("HTTP", e.code)
    print(e.read().decode()[:800])
