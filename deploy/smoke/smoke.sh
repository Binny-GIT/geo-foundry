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
check "${PUBLIC_BASE}/api/health" '"status":"alive"'
echo "smoke passed"
