#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
PG_SERVICE="${PG_SERVICE:-db}"
PG_CONTAINER="${PG_CONTAINER:-}"
POSTGRES_USER="${POSTGRES_USER:-parkvanta}"
POSTGRES_DB="${POSTGRES_DB:-parkvanta}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_DIR/parkvanta-$STAMP.dump.gz"
TMP="$FILE.partial"

mkdir -p "$BACKUP_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required to run pg_dump through the compose service" >&2
  exit 1
fi

if [ -n "$PG_CONTAINER" ]; then
  dump() { docker exec -i "$PG_CONTAINER" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner; }
  SOURCE="container '$PG_CONTAINER'"
else
  dump() { docker compose exec -T "$PG_SERVICE" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner; }
  SOURCE="compose service '$PG_SERVICE'"
fi

echo "Backing up $POSTGRES_DB from $SOURCE ..."
if ! dump | gzip -9 > "$TMP"; then
  rm -f "$TMP"
  echo "backup failed; partial file removed" >&2
  exit 1
fi

mv "$TMP" "$FILE"
gzip -t "$FILE"
SIZE="$(du -h "$FILE" | cut -f1)"
echo "wrote $FILE ($SIZE)"

find "$BACKUP_DIR" -name 'parkvanta-*.dump.gz' -mtime +"$RETENTION_DAYS" -print -delete
echo "retention: files older than $RETENTION_DAYS days pruned"
