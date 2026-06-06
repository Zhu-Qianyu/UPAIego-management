#!/usr/bin/env bash
set -euo pipefail

DOCKER_DIR="${HOME}/supabase/docker"
cd "${DOCKER_DIR}"

sed -i '/^name: supabase/d' docker-compose.yml

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
sudo ${COMPOSE} pull db kong auth rest storage imgproxy meta functions studio
sudo ${COMPOSE} up -d db
echo "Waiting for Postgres..."
for i in $(seq 1 60); do
  if sudo ${COMPOSE} exec -T db pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
sudo ${COMPOSE} up -d kong auth rest storage imgproxy meta functions studio
sudo ${COMPOSE} stop studio 2>/dev/null || true

sed -i '/transaction_timeout/d' "${HOME}/schema.sql" || true

echo "=== Import schema ==="
sudo ${COMPOSE} exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "${HOME}/schema.sql"

echo "=== Import data ==="
sudo ${COMPOSE} exec -T db psql -U postgres -d postgres < "${HOME}/data.sql"

sudo ${COMPOSE} restart auth rest storage kong

echo "=== Verify ==="
sudo ${COMPOSE} exec -T db psql -U postgres -c "SELECT count(*) AS users FROM auth.users;"
sudo ${COMPOSE} exec -T db psql -U postgres -c "SELECT count(*) AS profiles FROM public.profiles;"
grep -E '^(ANON_KEY|POSTGRES_PASSWORD)=' .env
sudo ${COMPOSE} ps
free -h | head -2
