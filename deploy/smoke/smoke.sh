#!/usr/bin/env bash
# Geo Foundry CMS — deploy smoke
# 验证 localhost health/readiness 与 Cloudflare hostname smoke，
# 以及交付服务（/healthz、鉴权、已发布页面 JSON/HTML/sitemap、未知站点 404）。
set -euo pipefail

LOCAL_BASE="${LOCAL_BASE:-http://127.0.0.1:3090}"
PUBLIC_BASE="${PUBLIC_BASE:-https://geo-foundry-mk-dev.aixllent.com}"
TIMEOUT="${TIMEOUT:-20}"

DELIVERY_LOCAL_BASE="${DELIVERY_LOCAL_BASE:-http://127.0.0.1:3091}"
DELIVERY_PUBLIC_BASE="${DELIVERY_PUBLIC_BASE:-https://geo-delivery-mk-dev.aixllent.com}"
DELIVERY_CONTAINER="${DELIVERY_CONTAINER:-geo-foundry-delivery-mk-dev}"
CREDENTIALS_DIR="${GEO_FOUNDRY_CREDENTIALS_DIR:-/opt/geo-foundry/credentials}"
KEYRING_FILE="${KEYRING_FILE:-$CREDENTIALS_DIR/site-keyring.json}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-pg-server}"

check() {
  local url="$1" expect="$2"
  shift 2
  local body
  body="$(curl -4 -s -m "${TIMEOUT}" "$@" "${url}")"
  echo "${body}" | grep -q "${expect}" || {
    echo "smoke failed: ${url} missing ${expect}: ${body}" >&2
    exit 1
  }
  echo "ok: ${url}"
}

expect_status() {
  local url="$1" expect="$2"
  shift 2
  local code
  code="$(curl -4 -s -m "${TIMEOUT}" -o /dev/null -w '%{http_code}' "$@" "${url}")"
  if [[ "${code}" != "${expect}" ]]; then
    echo "smoke failed: ${url} expected ${expect} got ${code}" >&2
    exit 1
  fi
  echo "ok: ${url} -> ${expect}"
}

query_scalar() {
  local statement="$1"
  local postgres_user
  postgres_user="$(sudo -n docker exec "${POSTGRES_CONTAINER}" printenv POSTGRES_USER)"
  sudo -n docker exec "${POSTGRES_CONTAINER}" \
    psql -U "${postgres_user}" -d geo_foundry -qAt -c "${statement}"
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

# ---- 交付服务 ----
delivery_image="$(sudo -n docker inspect --format '{{.Image}}' "${DELIVERY_CONTAINER}")"
delivery_state="$(sudo -n docker inspect --format '{{.State.Status}}' "${DELIVERY_CONTAINER}")"
delivery_health="$(sudo -n docker inspect --format '{{.State.Health.Status}}' "${DELIVERY_CONTAINER}")"
if [[ "$delivery_state" != "running" || "$delivery_health" != "healthy" || "$delivery_image" != "$cms_image" ]]; then
  echo "smoke failed: delivery state=${delivery_state} health=${delivery_health} image-match=$([[ "$delivery_image" == "$cms_image" ]] && echo yes || echo no)" >&2
  exit 1
fi
printf 'ok: delivery running healthy with CMS image digest\n'

check "${DELIVERY_LOCAL_BASE}/healthz" '"status":"ok"'
check "${DELIVERY_PUBLIC_BASE}/healthz" '"status":"ok"'

# keyring 是交付服务的启动前提；取全部 host 用于鉴权与 404 检查。
keyring_hosts="$(sudo -n python3 -c 'import json,sys;print("\n".join(sorted(json.load(open(sys.argv[1]))["sites"])))' "${KEYRING_FILE}")"
if [[ -z "${keyring_hosts}" ]]; then
  echo "smoke failed: site keyring has no hosts: ${KEYRING_FILE}" >&2
  exit 1
fi
key_for() {
  sudo -n python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["sites"][sys.argv[2]]["keys"][0]["key"])' "${KEYRING_FILE}" "$1"
}

# 鉴权语义：无凭据 401；对已登记 host 使用错误 key 403。
probe_host="$(head -n 1 <<<"${keyring_hosts}")"
expect_status "${DELIVERY_LOCAL_BASE}/v1/sites/${probe_host}/pages/smoke-probe" 401
expect_status "${DELIVERY_LOCAL_BASE}/v1/sites/${probe_host}/pages/smoke-probe" 403 \
  -H "Authorization: Bearer smoke-wrong-key-0000000000000000"

# 已发布页面：DB 里最新的 published×active 页面，经交付服务 JSON/HTML/sitemap。
page_line="$(query_scalar "
  SELECT d.hostname || ' ' || ur.pathname
  FROM geo_foundry.edition_sites es
  JOIN geo_foundry.url_records ur ON ur.id = es.url_record_id
  JOIN geo_foundry.domains d ON d.site_id = es.site_id
  WHERE es.publish_state = 'published'
    AND ur.state = 'active'
    AND ur.pathname IS NOT NULL
    AND d.status = 'active'
    AND d.role = 'canonical'
  ORDER BY es.published_at DESC NULLS LAST
  LIMIT 1;
")"
if [[ -z "${page_line}" ]]; then
  echo "skip: no published page with active URL; delivery content checks not run"
else
  read -r page_host page_pathname <<<"${page_line}"
  page_key="$(key_for "${page_host}")"
  check "${DELIVERY_LOCAL_BASE}/v1/sites/${page_host}/pages${page_pathname}" '"bodyHtml"' \
    -H "Authorization: Bearer ${page_key}"
  check "${DELIVERY_PUBLIC_BASE}/v1/sites/${page_host}/pages${page_pathname}" '"bodyHtml"' \
    -H "Authorization: Bearer ${page_key}"
  check "${DELIVERY_LOCAL_BASE}${page_pathname}" '<!doctype html>' \
    -H "X-Geo-Site-Host: ${page_host}" -H "Authorization: Bearer ${page_key}"
  check "${DELIVERY_LOCAL_BASE}/v1/sites/${page_host}/sitemap.xml" 'urlset' \
    -H "Authorization: Bearer ${page_key}"
fi

# 未知站点：keyring 已登记但从未发布的 host（在 keyring、不在路由清单）→ 404。
# 全部 host 都有已发布页面时无法构造该场景，打印 skip 而不是硬编码站点。
unpublished_host="$(query_scalar "
  SELECT lower(d.hostname)
  FROM geo_foundry.domains d
  JOIN geo_foundry.sites s ON s.id = d.site_id
  WHERE d.status = 'active'
    AND s.status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM geo_foundry.edition_sites es
      WHERE es.site_id = d.site_id AND es.publish_state = 'published'
    )
  ORDER BY d.hostname
  LIMIT 1;
")"
if [[ -n "${unpublished_host}" ]]; then
  expect_status "${DELIVERY_LOCAL_BASE}/v1/sites/${unpublished_host}/pages/smoke-missing" 404 \
    -H "Authorization: Bearer $(key_for "${unpublished_host}")"
else
  echo "skip: no unpublished keyed host; delivery unknown-site 404 check not run"
fi

echo "smoke passed"
