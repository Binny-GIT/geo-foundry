#!/usr/bin/env bash
set -euo pipefail

CMS_CONTAINER="${CMS_CONTAINER:-geo-foundry-cms-mk-dev}"
WORKER_CONTAINER="${WORKER_CONTAINER:-geo-foundry-worker-mk-dev}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-pg-server}"
LOCAL_BASE="${LOCAL_BASE:-http://127.0.0.1:3090}"
PUBLIC_BASE="${PUBLIC_BASE:-https://geo-foundry-mk-dev.aixllent.com}"
BACKUP_DIRECTORY="${BACKUP_DIRECTORY:-/var/backups/geo-foundry}"
BACKUP_MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-30}"
MAX_RESTART_COUNT="${MAX_RESTART_COUNT:-3}"
MAX_OUTBOX_AGE_MINUTES="${MAX_OUTBOX_AGE_MINUTES:-15}"
MAX_OPERATION_AGE_MINUTES="${MAX_OPERATION_AGE_MINUTES:-30}"
RSS_MAX_AGE_HOURS="${RSS_MAX_AGE_HOURS:-2}"
RECENT_PUBLICATION_FAILURE_MINUTES="${RECENT_PUBLICATION_FAILURE_MINUTES:-30}"

require_running() {
  local container="$1"
  local state
  state="$(sudo -n docker inspect --format '{{.State.Status}}' "$container")"
  if [[ "$state" != "running" ]]; then
    printf 'RUNTIME_CONTAINER_NOT_RUNNING name=%s state=%s\n' "$container" "$state" >&2
    return 1
  fi
}

query_scalar() {
  local statement="$1"
  local postgres_user
  postgres_user="$(sudo -n docker exec "$POSTGRES_CONTAINER" printenv POSTGRES_USER)"
  sudo -n docker exec "$POSTGRES_CONTAINER" \
    psql -U "$postgres_user" -d geo_foundry -At -c "$statement"
}

require_running "$CMS_CONTAINER"
require_running "$WORKER_CONTAINER"

cms_health_status="$(sudo -n docker inspect --format '{{.State.Health.Status}}' "$CMS_CONTAINER")"
cms_restart_count="$(sudo -n docker inspect --format '{{.RestartCount}}' "$CMS_CONTAINER")"
worker_restart_count="$(sudo -n docker inspect --format '{{.RestartCount}}' "$WORKER_CONTAINER")"
printf 'CMS_DOCKER_HEALTH=%s\n' "$cms_health_status"
printf 'CMS_RESTART_COUNT=%s\n' "$cms_restart_count"
printf 'WORKER_RESTART_COUNT=%s\n' "$worker_restart_count"
if [[ "$cms_health_status" != "healthy" ]] || (( cms_restart_count > MAX_RESTART_COUNT || worker_restart_count > MAX_RESTART_COUNT )); then
  printf 'RUNTIME_CONTAINER_HEALTH_ATTENTION_REQUIRED\n' >&2
  exit 1
fi

health="$(curl -4 -fsS --max-time 20 "${LOCAL_BASE}/api/health")"
readiness="$(curl -4 -fsS --max-time 20 "${LOCAL_BASE}/api/readiness")"
public_health="$(curl -4 --retry 2 --retry-all-errors --retry-delay 1 -fsS --max-time 20 "${PUBLIC_BASE}/api/health")"
printf 'CMS_HEALTH=%s\n' "$(printf '%s' "$health" | tr -d '\n')"
printf 'CMS_READINESS=%s\n' "$(printf '%s' "$readiness" | tr -d '\n')"
printf 'PUBLIC_HEALTH=%s\n' "$(printf '%s' "$public_health" | tr -d '\n')"

cms_image="$(sudo -n docker inspect --format '{{.Image}}' "$CMS_CONTAINER")"
worker_image="$(sudo -n docker inspect --format '{{.Image}}' "$WORKER_CONTAINER")"
printf 'CMS_IMAGE=%s\n' "$cms_image"
printf 'WORKER_IMAGE=%s\n' "$worker_image"
if [[ "$cms_image" != "$worker_image" ]]; then
  printf 'RUNTIME_IMAGE_DIGEST_MISMATCH\n' >&2
  exit 1
fi

outbox_pending="$(query_scalar "SELECT count(*) FROM geo_foundry.outbox_events WHERE status = 'pending';")"
outbox_oldest_age_minutes="$(query_scalar "SELECT coalesce(floor(extract(epoch FROM now() - min(created_at)) / 60)::int, 0) FROM geo_foundry.outbox_events WHERE status = 'pending';")"
operation_nonterminal="$(query_scalar "SELECT count(*) FROM geo_foundry.operations WHERE state IN ('queued', 'running');")"
operation_oldest_age_minutes="$(query_scalar "SELECT coalesce(floor(extract(epoch FROM now() - min(created_at)) / 60)::int, 0) FROM geo_foundry.operations WHERE state IN ('queued', 'running');")"
publication_failed="$(query_scalar "
  SELECT count(*)
  FROM geo_foundry.publication_plans plan
  JOIN geo_foundry.content_editions edition ON edition.id = plan.edition_id
  WHERE plan.status = 'failed'
    AND edition.title NOT LIKE 'Scheduled publish E2E %';
")"
publication_failed_e2e="$(query_scalar "
  SELECT count(*)
  FROM geo_foundry.publication_plans plan
  JOIN geo_foundry.content_editions edition ON edition.id = plan.edition_id
  WHERE plan.status = 'failed'
    AND edition.title LIKE 'Scheduled publish E2E %';
")"
publication_failed_recent="$(query_scalar "
  SELECT count(*)
  FROM geo_foundry.publication_plans
  WHERE status = 'failed'
    AND updated_at >= now() - interval '${RECENT_PUBLICATION_FAILURE_MINUTES} minutes';
")"
rss_stale="$(query_scalar "SELECT count(*) FROM geo_foundry.connectors WHERE type = 'rss' AND status = 'active' AND (last_polled_at IS NULL OR last_polled_at < now() - interval '${RSS_MAX_AGE_HOURS} hours');")"
printf 'OUTBOX_PENDING=%s\n' "$outbox_pending"
printf 'OUTBOX_OLDEST_AGE_MINUTES=%s\n' "$outbox_oldest_age_minutes"
printf 'OPERATIONS_NONTERMINAL=%s\n' "$operation_nonterminal"
printf 'OPERATIONS_OLDEST_AGE_MINUTES=%s\n' "$operation_oldest_age_minutes"
printf 'PUBLICATION_PLANS_FAILED=%s\n' "$publication_failed"
printf 'PUBLICATION_PLANS_FAILED_E2E=%s\n' "$publication_failed_e2e"
printf 'PUBLICATION_PLANS_FAILED_RECENT=%s\n' "$publication_failed_recent"
printf 'RSS_ACTIVE_STALE=%s\n' "$rss_stale"

latest_backup="$(sudo -n find "$BACKUP_DIRECTORY" -maxdepth 1 -type f -name '*.dump' -printf '%T@|%s|%p\n' 2>/dev/null | sort -rn | head -n 1)"
if [[ -z "$latest_backup" ]]; then
  printf 'RUNTIME_BACKUP_MISSING directory=%s\n' "$BACKUP_DIRECTORY" >&2
  exit 1
fi
IFS='|' read -r backup_timestamp backup_bytes backup_path <<<"$latest_backup"
backup_age_hours="$(python3 - "$backup_timestamp" <<'PY'
import sys
import time

print(int((time.time() - float(sys.argv[1])) // 3600))
PY
)"
printf 'BACKUP_LATEST_BYTES=%s\n' "$backup_bytes"
printf 'BACKUP_LATEST_AGE_HOURS=%s\n' "$backup_age_hours"
printf 'BACKUP_LATEST_PATH=%s\n' "$backup_path"

if (( backup_age_hours > BACKUP_MAX_AGE_HOURS )); then
  printf 'RUNTIME_BACKUP_STALE age_hours=%s max_age_hours=%s\n' "$backup_age_hours" "$BACKUP_MAX_AGE_HOURS" >&2
  exit 1
fi

if (( outbox_oldest_age_minutes > MAX_OUTBOX_AGE_MINUTES || operation_oldest_age_minutes > MAX_OPERATION_AGE_MINUTES )); then
  printf 'RUNTIME_WORK_AGE_ATTENTION_REQUIRED\n' >&2
  exit 1
fi

if [[ "$outbox_pending" != "0" || "$publication_failed_recent" != "0" || "$rss_stale" != "0" ]]; then
  printf 'RUNTIME_STATUS_ATTENTION_REQUIRED\n' >&2
  exit 1
fi

printf 'RUNTIME_STATUS_OK\n'
