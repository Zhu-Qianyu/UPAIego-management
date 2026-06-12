#!/usr/bin/env bash
# 手机号注册使用 synthetic email（p{phone}@upaiego.auth），无需也不应发送确认邮件。
# 在自建 Supabase 的 ~/supabase/docker/.env 中开启 ENABLE_EMAIL_AUTOCONFIRM=true。
set -euo pipefail

DOCKER_DIR="${DOCKER_DIR:-${HOME}/supabase/docker}"
cd "${DOCKER_DIR}"

if [[ ! -f .env ]]; then
  echo "Missing ${DOCKER_DIR}/.env"
  exit 1
fi

set_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    echo "${key}=${value}" >> .env
  fi
}

set_env ENABLE_EMAIL_SIGNUP true
set_env ENABLE_EMAIL_AUTOCONFIRM true

COMPOSE="docker-compose"
if ! command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker compose"
fi

echo "==> Auth mailer: auto-confirm enabled (no signup confirmation email)"
grep -E '^ENABLE_EMAIL_(SIGNUP|AUTOCONFIRM)=' .env

echo "==> Recreate auth + restart kong (reload .env into container)"
# docker-compose 1.29 + recreate 可能触发 ContainerConfig 错误，先清理所有 auth 容器
while IFS= read -r name; do
  [[ -n "${name}" ]] && sudo docker rm -f "${name}" || true
done < <(sudo docker ps -a --format '{{.Names}}' | grep -E 'auth' || true)
sudo ${COMPOSE} rm -sf auth 2>/dev/null || true
sudo ${COMPOSE} up -d --no-deps auth
sudo ${COMPOSE} restart kong
sleep 5

if sudo ${COMPOSE} exec -T auth env 2>/dev/null | grep -qi 'MAILER_AUTOCONFIRM=true'; then
  echo "OK: GOTRUE_MAILER_AUTOCONFIRM is true inside auth container"
else
  echo "WARN: MAILER_AUTOCONFIRM not true — checking docker-compose auth env mapping"
  grep -A2 'MAILER_AUTOCONFIRM' docker-compose.yml || true
fi

echo "==> Backfill unconfirmed existing users"
sudo ${COMPOSE} exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
UPDATE auth.users
SET email_confirmed_at = COALESCE(email_confirmed_at, now())
WHERE email_confirmed_at IS NULL;
SQL

UNCONFIRMED=$(
  sudo ${COMPOSE} exec -T db psql -U postgres -d postgres -tAc \
    "SELECT count(*) FROM auth.users WHERE email_confirmed_at IS NULL" | tr -d '[:space:]'
)
echo "Unconfirmed users remaining: ${UNCONFIRMED:-?}"

echo "Done. Users can register with phone without confirmation email."
