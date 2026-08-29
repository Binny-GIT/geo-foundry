#!/usr/bin/env bash
# Geo Foundry CMS — deploy smoke
# 验证 localhost health/readiness 与 Cloudflare hostname smoke。
set -euo pipefail

LOCAL_BASE="${LOCAL_BASE:-http://127.0.0.1:3090}"
PUBLIC_BASE="${PUBLIC_BASE:-https://geo-foundry-mk-dev.aixllent.com}"
TIMEOUT="${TIMEOUT:-20}"

check() {
  local url="$1" expect="$2"
  local body
  body="$(curl -4 -s -m "${TIMEOUT}" "${url}")"
  echo "${body}" | grep -q "${expect}" || {
    echo "smoke failed: ${url} missing ${expect}: ${body}" >&2
    exit 1
  }
  echo "ok: ${url}"
}

check "${LOCAL_BASE}/api/health" '"status":"alive"'
check "${LOCAL_BASE}/api/readiness" '"status":"ready"'
check "${PUBLIC_BASE}/api/health" '"status":"alive"'

cms_image="$(sudo -n docker inspect --format '{{.Image}}' geo-foundry-cms-mk-dev)"
worker_image="$(sudo -n docker inspect --format '{{.Image}}' geo-foundry-worker-mk-dev)"
worker_state="$(sudo -n docker inspect --format '{{.State.Status}}' geo-foundry-worker-mk-dev)"
if [[ "$worker_state" != "running" || "$cms_image" != "$worker_image" ]]; then
  echo "smoke failed: worker state=${worker_state}; image-match=$([[ "$cms_image" == "$worker_image" ]] && echo yes || echo no)" >&2
  exit 1
fi
printf 'ok: worker running with CMS image digest\n'
bash "$(dirname "$0")/worker-smoke.sh"
echo "smoke passed"
