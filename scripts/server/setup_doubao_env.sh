#!/bin/bash
# Configure Doubao / Volcano Ark secrets for scene-ai-agent on self-hosted Supabase.
# Usage: bash setup_doubao_env.sh <ARK_API_KEY> [ARK_MODEL]
set -euo pipefail

DOCKER_DIR="${HOME}/supabase/docker"
cd "${DOCKER_DIR}"

ARK_API_KEY="${1:?Usage: setup_doubao_env.sh ARK_API_KEY [ARK_MODEL]}"
ARK_MODEL="${2:-doubao-seed-1-6-vision-250815}"

upsert_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${val}|" .env
  else
    echo "${key}=${val}" >> .env
  fi
}

upsert_env AI_PROVIDER doubao
upsert_env ARK_API_KEY "${ARK_API_KEY}"
upsert_env ARK_MODEL "${ARK_MODEL}"
upsert_env ARK_BASE_URL "https://ark.cn-beijing.volces.com/api/v3"

if ! grep -q 'ARK_API_KEY: \${ARK_API_KEY}' docker-compose.yml; then
  sed -i '/VERIFY_JWT: "\${FUNCTIONS_VERIFY_JWT}"/a\      AI_PROVIDER: ${AI_PROVIDER:-doubao}\n      ARK_API_KEY: ${ARK_API_KEY}\n      ARK_MODEL: ${ARK_MODEL}\n      ARK_BASE_URL: ${ARK_BASE_URL:-https://ark.cn-beijing.volces.com/api/v3}' docker-compose.yml
fi

grep -E '^(AI_PROVIDER|ARK_API_KEY|ARK_MODEL|ARK_BASE_URL)=' .env | sed 's/ARK_API_KEY=.*/ARK_API_KEY=***/'

sudo docker-compose up -d functions
sleep 4
sudo docker-compose restart functions kong

curl -s -o /dev/null -w "scene-ai-agent OPTIONS HTTP %{http_code}\n" \
  -X OPTIONS "http://127.0.0.1:8000/functions/v1/scene-ai-agent"

echo "Done. Model=${ARK_MODEL}"
