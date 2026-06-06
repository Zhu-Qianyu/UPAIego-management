#!/usr/bin/env bash
set -euo pipefail
cd ~/supabase/docker
sed -i 's|PGRST_JWT_SECRET: ${JWT_JWKS:-${JWT_SECRET}}|PGRST_JWT_SECRET: ${JWT_SECRET}|' docker-compose.yml
sudo docker stop supabase-rest 2>/dev/null || true
sudo docker rm supabase-rest 2>/dev/null || true
sudo docker-compose up -d rest
sleep 8
sudo docker-compose ps rest
sudo docker logs supabase-rest 2>&1 | tail -3
