#!/bin/bash
set -euo pipefail
ANON=$(docker exec supabase-edge-functions printenv SUPABASE_ANON_KEY)
JWT_SECRET=$(docker exec supabase-edge-functions printenv JWT_SECRET)
USER_ID=$(docker exec supabase-db psql -U postgres -d postgres -tAc "select user_id from group_members where group_id='36b09527-3293-4e4e-b964-2800a9574d8d' and membership_status='active' limit 1")
USER_ID=$(echo "$USER_ID" | tr -d '[:space:]')
echo "user_id=$USER_ID"

TOKEN=$(docker exec supabase-edge-functions deno eval "
import { create, getNumericDate } from 'https://deno.land/x/djwt@v3.0.2/mod.ts';
const key = await crypto.subtle.importKey(
  'raw',
  new TextEncoder().encode('${JWT_SECRET}'),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign']
);
const jwt = await create({ alg: 'HS256', typ: 'JWT', exp: getNumericDate(60 * 10) }, {
  sub: '${USER_ID}',
  role: 'authenticated',
  aud: 'authenticated',
  iss: 'supabase',
}, key);
console.log(jwt);
")

echo "token_len=${#TOKEN}"
RESP=$(curl -s -w '\n__HTTP__%{http_code}' -X POST http://127.0.0.1:8000/functions/v1/scene-ai-agent \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "apikey: ${ANON}" \
  -H "Content-Type: application/json" \
  -d '{"groupId":"36b09527-3293-4e4e-b964-2800a9574d8d","messages":[{"role":"user","content":"你好"}],"images":[],"existingMacros":[]}')

echo "$RESP"
