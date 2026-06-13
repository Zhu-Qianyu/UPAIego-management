#!/bin/bash
# 交付测试自动化抽检（在 CVM 上执行）
set -euo pipefail

cd ~/supabase/docker
ANON=$(grep '^ANON_KEY=' .env | cut -d= -f2-)
JWT_SECRET=$(grep '^JWT_SECRET=' .env | cut -d= -f2-)
API="http://127.0.0.1:8000"

echo "========== OPS: 服务健康 =========="
curl -s -o /dev/null -w "REST profiles HTTP %{http_code}\n" \
  -H "apikey: ${ANON}" -H "Authorization: Bearer ${ANON}" \
  "${API}/rest/v1/profiles?select=id&limit=1"
curl -s -o /dev/null -w "Edge scene-ai-agent OPTIONS HTTP %{http_code}\n" \
  -X OPTIONS "${API}/functions/v1/scene-ai-agent"

echo ""
echo "========== DATA: 迁移对象 =========="
sudo docker-compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=0 <<'SQL'
SELECT CASE WHEN to_regclass('public.party_demand_macro_caps') IS NOT NULL THEN 'PASS party_demand_macro_caps' ELSE 'FAIL party_demand_macro_caps' END;
SELECT CASE WHEN to_regclass('public.party_demand_client_rates') IS NOT NULL THEN 'PASS party_demand_client_rates' ELSE 'FAIL party_demand_client_rates' END;
SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='party_demands' AND column_name='client_hourly_rate'
) THEN 'PASS party_demands 无 client_hourly_rate 列' ELSE 'FAIL party_demands 仍有 client_hourly_rate' END;
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='delete_scene_macro_site'
) THEN 'PASS delete_scene_macro_site RPC' ELSE 'FAIL delete_scene_macro_site RPC' END;
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='has_profile_role'
) THEN 'PASS has_profile_role' ELSE 'FAIL has_profile_role' END;
SELECT 'INFO profiles.roles 列: ' || CASE WHEN EXISTS (
  SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='roles'
) THEN '存在' ELSE '缺失' END;
SQL

echo ""
echo "========== SEC: RLS 策略抽检（是否仍用 current_profile_role） =========="
sudo docker-compose exec -T db psql -U postgres -d postgres -tAc "
SELECT c.relname || '.' || p.polname || ' -> ' ||
  CASE WHEN pg_get_expr(p.polqual, p.polrelid) ILIKE '%current_profile_role%' THEN 'WARN legacy current_profile_role'
       WHEN pg_get_expr(p.polqual, p.polrelid) ILIKE '%has_profile_role%' THEN 'OK has_profile_role'
       ELSE 'OTHER' END
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('scene_macro_sites','party_demands','party_demand_client_rates','collection_shifts')
ORDER BY 1;
"

echo ""
echo "========== 生成测试 JWT =========="
gen_jwt() {
  local uid="$1"
  docker exec supabase-edge-functions deno eval "
import { create, getNumericDate } from 'https://deno.land/x/djwt@v3.0.2/mod.ts';
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('${JWT_SECRET}'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const jwt = await create({ alg: 'HS256', typ: 'JWT', exp: getNumericDate(600) }, { sub: '${uid}', role: 'authenticated', aud: 'authenticated', iss: 'supabase' }, key);
console.log(jwt);
" 2>/dev/null | tr -d '\r\n'
}

ADMIN_ID=$(sudo docker-compose exec -T db psql -U postgres -d postgres -tAc "SELECT id FROM profiles WHERE 'admin' = ANY(roles) OR role='admin' LIMIT 1" | tr -d '[:space:]')
NONADMIN_ID=$(sudo docker-compose exec -T db psql -U postgres -d postgres -tAc "SELECT id FROM profiles WHERE NOT ('admin' = ANY(COALESCE(roles, ARRAY[]::text[]))) AND COALESCE(role,'') <> 'admin' LIMIT 1" | tr -d '[:space:]')

echo "admin_user_id=${ADMIN_ID:-NONE}"
echo "nonadmin_user_id=${NONADMIN_ID:-NONE}"

if [ -n "${NONADMIN_ID}" ]; then
  NA_TOKEN=$(gen_jwt "$NONADMIN_ID")
  echo ""
  echo "========== SEC-02: 非 admin 读 party_demand_client_rates =========="
  CODE=$(curl -s -o /tmp/pdcr.json -w '%{http_code}' \
    -H "apikey: ${ANON}" -H "Authorization: Bearer ${NA_TOKEN}" \
    "${API}/rest/v1/party_demand_client_rates?select=*&limit=5")
  echo "HTTP ${CODE} body=$(head -c 200 /tmp/pdcr.json)"
  if [ "$CODE" = "200" ] && [ "$(cat /tmp/pdcr.json)" != "[]" ]; then
    echo "FAIL 非 admin 可读价格表"
  else
    echo "PASS 非 admin 不可读价格或为空"
  fi

  echo ""
  echo "========== SEC-03: 非 admin 写 party_demands =========="
  CODE=$(curl -s -o /tmp/pd_ins.json -w '%{http_code}' -X POST \
    -H "apikey: ${ANON}" -H "Authorization: Bearer ${NA_TOKEN}" \
    -H "Content-Type: application/json" -H "Prefer: return=minimal" \
    "${API}/rest/v1/party_demands" \
    -d '{"group_id":"00000000-0000-0000-0000-000000000001","title":"hack","client_company":"hack","created_by":"'"${NONADMIN_ID}"'"}')
  echo "HTTP ${CODE} $(head -c 200 /tmp/pd_ins.json)"
fi

if [ -n "${ADMIN_ID}" ] && [ -n "${NONADMIN_ID}" ]; then
  MACRO_ID=$(sudo docker-compose exec -T db psql -U postgres -d postgres -tAc "SELECT id FROM scene_macro_sites LIMIT 1" | tr -d '[:space:]')
  if [ -n "${MACRO_ID}" ]; then
    NA_TOKEN=$(gen_jwt "$NONADMIN_ID")
    echo ""
    echo "========== SEC-10: 非 admin 调用 delete_scene_macro_site =========="
    CODE=$(curl -s -o /tmp/del_macro.json -w '%{http_code}' -X POST \
      -H "apikey: ${ANON}" -H "Authorization: Bearer ${NA_TOKEN}" \
      -H "Content-Type: application/json" \
      "${API}/rest/v1/rpc/delete_scene_macro_site" \
      -d '{"p_macro_id":"'"${MACRO_ID}"'"}')
    echo "HTTP ${CODE} $(head -c 300 /tmp/del_macro.json)"
  fi
fi

echo ""
echo "========== DONE =========="
