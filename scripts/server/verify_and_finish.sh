#!/bin/bash
set -e
cd ~/supabase/docker

echo "=== Container status ==="
sudo docker-compose ps

echo "=== Table counts ==="
sudo docker-compose exec -T db psql -U postgres -c "SELECT count(*) AS auth_users FROM auth.users;"
sudo docker-compose exec -T db psql -U postgres -c "SELECT count(*) AS profiles FROM public.profiles;"
sudo docker-compose exec -T db psql -U postgres -c "SELECT schemaname, count(*) FROM pg_tables WHERE schemaname IN ('public','auth') GROUP BY 1;"

echo "=== Public tables (sample) ==="
sudo docker-compose exec -T db psql -U postgres -c "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1 LIMIT 20;"

echo "=== Keys ==="
grep -E '^(ANON_KEY|JWT_SECRET|API_EXTERNAL_URL|SITE_URL)=' .env || true

echo "=== Stop heavy services (2G RAM) ==="
sudo docker-compose stop studio realtime supabase-pooler 2>/dev/null || true
sudo docker-compose stop supabase-realtime 2>/dev/null || true

echo "=== REST health ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:8000/rest/v1/ -H "apikey: $(grep '^ANON_KEY=' .env | cut -d= -f2)"

echo "=== Auth health ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:8000/auth/v1/health

echo "=== Done ==="
