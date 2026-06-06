#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Run as ubuntu user (script uses sudo), not root."
  exit 1
fi

echo "==> System packages"
sudo apt-get update
sudo apt-get install -y ca-certificates curl git ufw jq

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Install Docker"
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER"
  echo "Docker installed. If 'docker' fails, run: newgrp docker"
fi

sudo systemctl enable docker
sudo systemctl start docker

echo "==> Firewall (SSH + HTTPS for EdgeOne origin)"
sudo ufw allow OpenSSH
sudo ufw allow 443/tcp
sudo ufw allow 80/tcp
echo "y" | sudo ufw enable || true

SUPABASE_DIR="${HOME}/supabase/docker"
if [[ ! -d "${SUPABASE_DIR}" ]]; then
  echo "==> Clone Supabase"
  git clone --depth 1 https://github.com/supabase/supabase "${HOME}/supabase"
fi

cd "${SUPABASE_DIR}"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "==> Generate secrets into .env"
  if [[ -x ./utils/generate-keys.sh ]]; then
    ./utils/generate-keys.sh
  else
    POSTGRES_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"
    JWT_SECRET="$(openssl rand -base64 48 | tr -d '/+=' | head -c 48)"
    sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${POSTGRES_PASSWORD}|" .env
    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" .env
    echo "Generated POSTGRES_PASSWORD and JWT_SECRET (see ~/supabase/docker/.env)"
    echo "Run ./utils/generate-keys.sh manually if ANON_KEY is empty."
  fi
fi

mkdir -p "${SUPABASE_DIR}/volumes/functions"
if [[ ! -f "${SUPABASE_DIR}/docker-compose.override.yml" ]]; then
  cat > "${SUPABASE_DIR}/docker-compose.override.yml" <<'EOF'
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
fi

echo "==> Pull images (may take several minutes)"
docker compose pull db kong auth rest storage imgproxy meta functions studio

echo "==> Start core services"
docker compose up -d db
echo "Waiting for Postgres..."
for i in $(seq 1 60); do
  if docker compose exec -T db pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

docker compose up -d kong auth rest storage imgproxy meta functions studio

echo ""
echo "Done. Core Supabase is up."
echo "  Studio (temporary): http://$(curl -s ifconfig.me 2>/dev/null || echo YOUR_IP):8000"
echo "  Keys: grep -E '^(ANON_KEY|SERVICE_ROLE_KEY|JWT_SECRET|POSTGRES_PASSWORD)=' ${SUPABASE_DIR}/.env"
echo ""
echo "Next: upload cloud dump and run 02_restore_cloud_dump.sh"
echo "  Or copy docs/*.sql and run 03_apply_migrations.sh for empty DB."
