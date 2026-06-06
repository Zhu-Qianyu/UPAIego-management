#!/usr/bin/env bash
set -euo pipefail
cd ~/supabase/docker
docker-compose exec -T db psql -U postgres -d postgres <<'SQL'
SELECT proname, prosecdef
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND proname IN (
    'manual_tracked_devices_assign_public_code',
    'manual_tracked_devices_party_same_group_chk',
    'set_party_device_code_prefix_if_empty'
  );

SELECT id, client_company, device_code_prefix
FROM party_demands
WHERE client_company ILIKE '%智元觅蜂%' OR title ILIKE '%智元觅蜂%';
SQL
