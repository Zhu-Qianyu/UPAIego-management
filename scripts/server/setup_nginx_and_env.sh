#!/bin/bash
set -euo pipefail

DOCKER_DIR="${HOME}/supabase/docker"
cd "${DOCKER_DIR}"

DOMAIN="${1:-}"
if [[ -n "${DOMAIN}" ]]; then
  API_URL="https://api.${DOMAIN}"
  SITE_URL="https://www.${DOMAIN}"
else
  API_URL="http://146.56.200.250:8000"
  SITE_URL="http://146.56.200.250:8000"
fi

echo "=== Update Supabase .env URLs ==="
for key in API_EXTERNAL_URL SUPABASE_PUBLIC_URL SITE_URL; do
  if grep -q "^${key}=" .env; then
    if [[ "${key}" == "API_EXTERNAL_URL" ]]; then
      sed -i "s|^${key}=.*|${key}=${API_URL}|" .env
    elif [[ "${key}" == "SUPABASE_PUBLIC_URL" ]]; then
      sed -i "s|^${key}=.*|${key}=${API_URL}|" .env
    else
      sed -i "s|^${key}=.*|${key}=${SITE_URL}|" .env
    fi
  else
    if [[ "${key}" == "SITE_URL" ]]; then
      echo "${key}=${SITE_URL}" >> .env
    else
      echo "${key}=${API_URL}" >> .env
    fi
  fi
done

grep -E '^(API_EXTERNAL_URL|SUPABASE_PUBLIC_URL|SITE_URL|ANON_KEY)=' .env

echo "=== Auth: phone signup without confirmation email ==="
for key in ENABLE_EMAIL_SIGNUP ENABLE_EMAIL_AUTOCONFIRM; do
  val=true
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${val}|" .env
  else
    echo "${key}=${val}" >> .env
  fi
done
grep -E '^ENABLE_EMAIL_(SIGNUP|AUTOCONFIRM)=' .env

echo "=== Install nginx if missing ==="
if ! command -v nginx >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nginx
fi

echo "=== nginx site: proxy :80 -> Kong :8000 ==="
sudo tee /etc/nginx/sites-available/supabase-api >/dev/null <<'NGINX'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/supabase-api /etc/nginx/sites-enabled/supabase-api
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx

echo "=== Ensure compose override (disable heavy services) ==="
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
  supavisor:
    profiles: ["disabled"]
EOF

echo "=== Restart Supabase API stack ==="
sudo docker-compose stop studio supavisor 2>/dev/null || true
sudo docker stop realtime-dev.supabase-realtime 2>/dev/null || true
sudo docker-compose up -d db imgproxy auth rest storage meta kong functions
sleep 8
sudo docker-compose restart auth kong

echo "=== Health checks ==="
ANON=$(grep '^ANON_KEY=' .env | cut -d= -f2-)
curl -s -o /dev/null -w "Kong:8000 HTTP %{http_code}\n" http://127.0.0.1:8000/rest/v1/
curl -s -o /dev/null -w "Nginx:80 HTTP %{http_code}\n" http://127.0.0.1:80/rest/v1/
curl -s "http://127.0.0.1:8000/rest/v1/profiles?select=id&limit=1" \
  -H "apikey: ${ANON}" -H "Authorization: Bearer ${ANON}" | head -c 120
echo

sudo docker ps --format 'table {{.Names}}\t{{.Status}}' | grep supabase
free -h | head -2
echo "=== Done. EdgeOne: point api.your-domain origin to http://146.56.200.250:80 ==="
