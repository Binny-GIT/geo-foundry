#!/usr/bin/env bash
set -euo pipefail

POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-pg-server}"
BACKUP_DIRECTORY="${BACKUP_DIRECTORY:-/var/backups/geo-foundry}"
BACKUP_FILE="${1:-}"

if [[ -z "$BACKUP_FILE" ]]; then
  BACKUP_FILE="$(sudo -n find "$BACKUP_DIRECTORY" -maxdepth 1 -type f -name 'geo-foundry-*.dump' -printf '%T@|%p\n' | sort -rn | head -n 1 | cut -d'|' -f2-)"
fi
if [[ -z "$BACKUP_FILE" ]] || ! sudo -n test -s "$BACKUP_FILE"; then
  printf 'BACKUP_RESTORE_INPUT_MISSING\n' >&2
  exit 1
fi

verify_database="geo_foundry_restore_verify_$(date -u +%Y%m%d%H%M%S)_$$"
cleanup() {
  sudo -n docker exec "$POSTGRES_CONTAINER" sh -ceu '
    dropdb -U "$POSTGRES_USER" --if-exists "$1"
  ' sh "$verify_database" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

sudo -n cat "$BACKUP_FILE" | sudo -n docker exec -i "$POSTGRES_CONTAINER" sh -ceu '
  pg_restore --list >/dev/null
' sh

sudo -n docker exec "$POSTGRES_CONTAINER" sh -ceu '
  dropdb -U "$POSTGRES_USER" --if-exists "$1"
  createdb -U "$POSTGRES_USER" "$1"
' sh "$verify_database"

sudo -n cat "$BACKUP_FILE" | sudo -n docker exec -i "$POSTGRES_CONTAINER" sh -ceu '
  pg_restore -U "$POSTGRES_USER" --no-owner --no-privileges --dbname="$1"
' sh "$verify_database"

read -r table_count migration_count core_tables_present < <(
  sudo -n docker exec "$POSTGRES_CONTAINER" sh -ceu '
    psql -U "$POSTGRES_USER" -d "$1" -At -F " " -c "
      SELECT
        (SELECT count(*) FROM information_schema.tables WHERE table_schema = '\''geo_foundry'\''),
        (SELECT count(*) FROM geo_foundry.payload_migrations),
        (SELECT count(*) FROM information_schema.tables
         WHERE table_schema = '\''geo_foundry'\''
           AND table_name IN ('\''users'\'', '\''sites'\'', '\''content_editions'\'', '\''releases'\'', '\''operations'\''));
    "
  ' sh "$verify_database"
)

if [[ ! "$table_count" =~ ^[1-9][0-9]*$ || ! "$migration_count" =~ ^[1-9][0-9]*$ || "$core_tables_present" != "5" ]]; then
  printf 'BACKUP_RESTORE_VERIFICATION_INVALID tables=%s migrations=%s core_tables=%s\n' "$table_count" "$migration_count" "$core_tables_present" >&2
  exit 1
fi

printf 'BACKUP_RESTORE_VERIFIED bytes=%s tables=%s migrations=%s core_tables=%s\n' \
  "$(sudo -n stat -c '%s' "$BACKUP_FILE")" "$table_count" "$migration_count" "$core_tables_present"
