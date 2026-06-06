#!/usr/bin/env bash
set -euo pipefail

SUPABASE_DIR="${HOME}/supabase/docker"
SCHEMA_FILE="${1:-${HOME}/schema.sql}"
DATA_FILE="${2:-${HOME}/data.sql}"

cd "${SUPABASE_DIR}"

if [[ ! -f "${SCHEMA_FILE}" ]]; then
  echo "Missing schema file: ${SCHEMA_FILE}"
  echo "Export from your PC (see docs/SERVER_SUPABASE_DEPLOY.md), then scp to server."
  exit 1
fi

echo "==> Restore schema: ${SCHEMA_FILE}"
docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "${SCHEMA_FILE}" || {
  echo "Schema restore had errors (PG17->15 mismatch is common)."
  echo "Edit SQL: remove lines with transaction_timeout, oauth_clients, buckets_vectors, etc."
  echo "See https://supabase.com/docs/guides/self-hosting/restore-from-platform"
  exit 1
}

if [[ -f "${DATA_FILE}" ]]; then
  echo "==> Restore data: ${DATA_FILE}"
  docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=0 < "${DATA_FILE}" || true
fi

echo "==> Restart API services"
docker compose restart auth rest storage kong functions

echo "Restore finished. Test: docker compose exec -T db psql -U postgres -c 'SELECT count(*) FROM auth.users;'"
