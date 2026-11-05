#!/usr/bin/env bash
# Creates a compressed, timestamped pg_dump of DATABASE_URL in ./backups (read-only for the source database).
set -euo pipefail
[ -f .env ] && set -a && . ./.env && set +a
: "${DATABASE_URL:?DATABASE_URL is not set}"
mkdir -p backups
out="backups/business-performance-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$out"
sha256sum "$out" > "$out.sha256"
echo "Backup written: $out ($(du -h "$out" | cut -f1))"
