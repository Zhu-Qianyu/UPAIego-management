#!/bin/bash
set -euo pipefail
cd ~/supabase/docker
export ANON_KEY=$(grep '^ANON_KEY=' .env | cut -d= -f2-)
export JWT_SECRET=$(grep '^JWT_SECRET=' .env | cut -d= -f2-)
export API=http://127.0.0.1:8000
export NONADMIN_UID=$(sudo docker-compose exec -T db psql -U postgres -d postgres -tAc \
  "SELECT id FROM profiles WHERE NOT ('admin' = ANY(COALESCE(roles, ARRAY[]::text[]))) AND COALESCE(role,'') <> 'admin' LIMIT 1" | tr -d '[:space:]')
export EXECUTOR_UID=$(sudo docker-compose exec -T db psql -U postgres -d postgres -tAc \
  "SELECT id FROM profiles WHERE 'collection_executor' = ANY(COALESCE(roles, ARRAY[]::text[])) AND NOT ('admin' = ANY(COALESCE(roles, ARRAY[]::text[]))) AND NOT ('scene_operator' = ANY(COALESCE(roles, ARRAY[]::text[]))) LIMIT 1" | tr -d '[:space:]')
export MACRO_ID=$(sudo docker-compose exec -T db psql -U postgres -d postgres -tAc \
  "SELECT id FROM scene_macro_sites LIMIT 1" | tr -d '[:space:]')
echo "nonadmin=${NONADMIN_UID:-NONE} executor=${EXECUTOR_UID:-NONE} macro=${MACRO_ID:-NONE}"
python3 ~/delivery_test_rls.py
