#!/usr/bin/env bash
# Deploy scene-ai-agent Edge Function to self-hosted Supabase (CVM).
# Run on server from repo root, or invoked by deploy_scene_ai_agent.ps1 via ssh.
set -euo pipefail

REPO_ROOT="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"
FUNCTIONS_VOL="${HOME}/supabase/docker/volumes/functions"
TARGET="${FUNCTIONS_VOL}/scene-ai-agent"
SRC="${REPO_ROOT}/supabase/functions/scene-ai-agent"
DOCKER_DIR="${HOME}/supabase/docker"

if [[ ! -d "${SRC}" ]]; then
  echo "Missing ${SRC}"
  exit 1
fi

mkdir -p "${TARGET}"
rsync -a --delete \
  --exclude='.git' \
  "${SRC}/" "${TARGET}/"

echo "==> scene-ai-agent synced to ${TARGET}"
ls -la "${TARGET}"

if [[ -d "${DOCKER_DIR}" ]]; then
  cd "${DOCKER_DIR}"
  sudo docker-compose up -d --no-deps functions
  sleep 3
  sudo docker-compose restart kong 2>/dev/null || true
  curl -s -o /dev/null -w "scene-ai-agent OPTIONS HTTP %{http_code}\n" \
    -X OPTIONS "http://127.0.0.1:8000/functions/v1/scene-ai-agent"
  echo "Done."
else
  echo "Supabase docker dir not found at ${DOCKER_DIR}; files copied only."
fi
