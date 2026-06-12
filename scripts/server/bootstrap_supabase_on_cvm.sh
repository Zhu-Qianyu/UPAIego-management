#!/usr/bin/env bash
set -euo pipefail

DOCKER_DIR="${HOME}/supabase/docker"
cd "${DOCKER_DIR}"

if [[ ! -f .env.example ]]; then
  echo "Missing ${DOCKER_DIR}/.env.example — upload supabase/docker from Windows first."
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  PW=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
  JWT=$(openssl rand -base64 48 | tr -d '/+=' | head -c 48)
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${PW}|" .env
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT}|" .env
  if [[ -x ./utils/generate-keys.sh ]]; then
    ./utils/generate-keys.sh
  fi
fi

# 手机号注册（synthetic email）无需确认邮件
for key in ENABLE_EMAIL_SIGNUP ENABLE_EMAIL_AUTOCONFIRM; do
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=true|" .env
  else
    echo "${key}=true" >> .env
  fi
done

cat > docker-compose.override.yml <<'EOF'
services:
  analytics:
    profiles: ["disabled"]
  vector:
    profiles: ["disabled"]
  logflare:
    profiles: ["disabled"]
  realtime:
    profiles: ["disabled"]
EOF

COMPOSE="docker-compose"
if ! command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker compose"
fi

sudo ${COMPOSE} pull db kong auth rest storage imgproxy meta functions studio
sudo ${COMPOSE} up -d db
echo "Waiting for Postgres..."
for i in $(seq 1 45); do
  if sudo ${COMPOSE} exec -T db pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
sudo ${COMPOSE} up -d kong auth rest storage imgproxy meta functions studio
sudo ${COMPOSE} stop studio 2>/dev/null || true

echo ""
echo "=== Keys (save ANON_KEY for frontend) ==="
grep -E '^(ANON_KEY|SERVICE_ROLE_KEY|POSTGRES_PASSWORD)=' .env
echo ""
sudo ${COMPOSE} ps
free -h
