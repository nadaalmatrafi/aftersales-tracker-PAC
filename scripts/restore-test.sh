#!/usr/bin/env bash
# Verifies a backup by restoring it into a NEW scratch database and comparing row counts with the source.
# Usage: scripts/restore-test.sh <backup.dump> <admin-url-of-a-server-where-a-scratch-db-may-be-created>
# It never writes to the source database.
set -euo pipefail
[ -f .env ] && set -a && . ./.env && set +a
dump="${1:?backup file required}"
admin="${2:?admin connection URL required (e.g. postgres://user:pass@host:5432/postgres)}"
: "${DATABASE_URL:?DATABASE_URL (source) is not set}"
sha256sum --check "$dump.sha256"
scratch="bp_restore_test_$(date +%s)"
psql "$admin" -qc "CREATE DATABASE $scratch"
target="${admin%/*}/$scratch"
pg_restore --no-owner --no-privileges --dbname="$target" "$dump"
q="SELECT string_agg(t || '=' || n, ' ' ORDER BY t) FROM (
  SELECT 'organizations' t, count(*) n FROM organizations UNION ALL SELECT 'users', count(*) FROM users
  UNION ALL SELECT 'action_plans', count(*) FROM action_plans UNION ALL SELECT 'action_steps', count(*) FROM action_steps
  UNION ALL SELECT 'action_updates', count(*) FROM action_updates UNION ALL SELECT 'attachments', count(*) FROM attachments
  UNION ALL SELECT 'meetings', count(*) FROM meetings UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs) x"
src=$(psql "$DATABASE_URL" -Atc "$q"); dst=$(psql "$target" -Atc "$q")
echo "source:   $src"; echo "restored: $dst"
psql "$admin" -qc "DROP DATABASE $scratch"
[ "$src" = "$dst" ] && echo "RESTORE TEST PASSED" || { echo "RESTORE TEST FAILED"; exit 1; }
