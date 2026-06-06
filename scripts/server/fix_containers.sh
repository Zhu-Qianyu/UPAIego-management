#!/bin/bash
set -e
cd ~/supabase/docker

OLD_PW='9uWV1dyHpohtLxkU2QYXyy9DtXw9v'
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${OLD_PW}|" .env

echo "=== Clean stale containers (keep volumes) ==="
sudo docker ps -aq --filter name=supabase | xargs -r sudo docker rm -f
sudo docker ps -aq --filter name=realtime | xargs -r sudo docker rm -f

echo "=== Fresh compose up ==="
sudo docker-compose up -d db
for i in $(seq 1 60); do
  if sudo docker-compose exec -T db pg_isready -U postgres >/dev/null 2>&1; then echo "db ready"; break; fi
  sleep 2
done

sudo docker-compose up -d kong auth rest storage imgproxy meta functions
sudo docker-compose stop studio supabase-pooler realtime 2>/dev/null || true

sleep 10

echo "=== Verify data ==="
sudo docker-compose exec -T db psql -U postgres -c 'SELECT count(*) FROM auth.users;'

ANON=$(grep '^ANON_KEY=' .env | cut -d= -f2-)
echo "REST:"
curl -s "http://127.0.0.1:8000/rest/v1/profiles?select=id&limit=1" \
  -H "apikey: ${ANON}" -H "Authorization: Bearer ${ANON}"
echo

grep -E '^(ANON_KEY|JWT_SECRET|POSTGRES_PASSWORD)=' .env
sudo docker-compose ps
free -h | head -2
