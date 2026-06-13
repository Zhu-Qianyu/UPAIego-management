#!/usr/bin/env python3
"""RLS spot checks for delivery test (run on CVM with env JWT_SECRET, ANON_KEY)."""
import json
import os
import sys
import time
import hmac
import hashlib
import base64
import urllib.error
import urllib.request

API = os.environ.get("API", "http://127.0.0.1:8000")
ANON = os.environ["ANON_KEY"]
SECRET = os.environ["JWT_SECRET"]
NONADMIN = os.environ["NONADMIN_UID"]
EXECUTOR_ONLY = os.environ.get("EXECUTOR_UID", "").strip()


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def make_jwt(sub: str) -> str:
    header = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = b64url(
        json.dumps(
            {
                "sub": sub,
                "role": "authenticated",
                "aud": "authenticated",
                "iss": "supabase",
                "exp": int(time.time()) + 600,
            }
        ).encode()
    )
    sig = b64url(
        hmac.new(SECRET.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()
    )
    return f"{header}.{payload}.{sig}"


def req(method: str, path: str, token: str, body: dict | None = None) -> tuple[int, str]:
    url = f"{API}{path}"
    data = None if body is None else json.dumps(body).encode()
    headers = {
        "apikey": ANON,
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    if method == "POST" and body is not None:
        headers["Prefer"] = "return=minimal"
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=15) as resp:
            return resp.status, resp.read(500).decode(errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read(500).decode(errors="replace")


def main() -> int:
    token = make_jwt(NONADMIN)
    fails = 0

    def check(name: str, ok: bool, detail: str) -> None:
        nonlocal fails
        status = "PASS" if ok else "FAIL"
        if not ok:
            fails += 1
        print(f"{status} {name}: {detail}")

    code, body = req("GET", "/rest/v1/party_demand_client_rates?select=*&limit=5", token)
    check("SEC-02 非admin读价格表", code == 200 and body.strip() == "[]", f"HTTP {code} {body[:120]}")

    code, body = req(
        "POST",
        "/rest/v1/party_demands",
        token,
        {
            "group_id": "00000000-0000-0000-0000-000000000001",
            "title": "rls-test",
            "client_company": "rls-test",
            "created_by": NONADMIN,
        },
    )
    check("SEC-03 非admin写party_demands", code >= 400, f"HTTP {code} {body[:120]}")

    macro_id = os.environ.get("MACRO_ID", "").strip()
    sec10_uid = EXECUTOR_ONLY or NONADMIN
    if macro_id and sec10_uid:
        token10 = make_jwt(sec10_uid)
        code, body = req(
            "POST",
            "/rest/v1/rpc/delete_scene_macro_site",
            token10,
            {"p_macro_id": macro_id},
        )
        check("SEC-10 无权限用户删大场景", code >= 400 or "无权" in body, f"HTTP {code} {body[:120]} (uid={sec10_uid[:8]}…)")

    code, body = req("GET", "/rest/v1/party_demands?select=id,title&limit=3", token)
    has_rate_key = "client_hourly_rate" in body
    check("SEC-01 party_demands无价格列", not has_rate_key, f"HTTP {code} keys in body")

    return fails


if __name__ == "__main__":
    sys.exit(main())
