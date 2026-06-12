#!/bin/bash
set -e
cd ~/supabase/docker

sed -i 's|^API_EXTERNAL_URL=.*|API_EXTERNAL_URL=http://146.56.200.250:8000|' .env
sed -i 's|^SUPABASE_PUBLIC_URL=.*|SUPABASE_PUBLIC_URL=http://146.56.200.250:8000|' .env
sed -i 's|^SITE_URL=.*|SITE_URL=http://146.56.200.250:8000|' .env
for key in ENABLE_EMAIL_SIGNUP ENABLE_EMAIL_AUTOCONFIRM; do
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=true|" .env
  else
    echo "${key}=true" >> .env
  fi
done

sudo docker-compose stop studio 2>/dev/null || true
sudo docker-compose restart auth kong functions

sleep 6
ANON=$(grep '^ANON_KEY=' .env | cut -d= -f2-)
echo "nginx:80 $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:80/rest/v1/)"
echo "kong:8000 $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/rest/v1/)"
curl -s "http://127.0.0.1:8000/rest/v1/profiles?select=id&limit=1" -H "apikey: ${ANON}" -H "Authorization: Bearer ${ANON}"
echo
grep -E '^(API_EXTERNAL_URL|ANON_KEY)=' .env
