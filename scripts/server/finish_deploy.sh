#!/bin/bash
set -e
cd ~/supabase/docker

echo "=== DB connectivity ==="
sudo docker-compose exec -T db psql -U postgres -c 'SELECT count(*) FROM auth.users;'

echo "=== Stop heavy services ==="
sudo docker-compose stop studio 2>/dev/null || true
sudo docker-compose stop supabase-pooler 2>/dev/null || true
sudo docker stop realtime-dev.supabase-realtime 2>/dev/null || true

echo "=== Recreate API with new JWT keys ==="
sudo docker-compose up -d --force-recreate auth rest storage kong functions
sleep 10

ANON=$(grep '^ANON_KEY=' .env | cut -d= -f2-)
echo "=== REST test ==="
curl -s "http://127.0.0.1:8000/rest/v1/profiles?select=id&limit=1" \
  -H "apikey: ${ANON}" \
  -H "Authorization: Bearer ${ANON}"
echo

echo "=== Edge function ping ==="
curl -s -o /dev/null -w "scene-ai-agent OPTIONS HTTP %{http_code}\n" \
  -X OPTIONS "http://127.0.0.1:8000/functions/v1/scene-ai-agent"

echo "=== Keys for frontend ==="
grep -E '^(ANON_KEY|JWT_SECRET|API_EXTERNAL_URL|SITE_URL)=' .env

sudo docker-compose ps
free -h | head -2
