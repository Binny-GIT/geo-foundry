#!/usr/bin/env bash
# 批次 3 修复后复验：bad-site 400 / 跨租户站点 403 / 停摆修复（active 源）
set -u
BASE=http://127.0.0.1:3090
COOKIE=/tmp/gf-stall-cookie.txt
PSQL() { sudo docker exec pg-server psql -U gpucloud -d geo_foundry -qAt -c "$1"; }
SKEY=$(sudo python3 -c 'import json;print(json.load(open("/opt/geo-foundry/credentials/content-service-keyring.json"))["tenants"]["413"])')

curl -s -o /dev/null -c "$COOKIE" -H "content-type: application/json" \
  -d '{"email":"embed-tenant-admin@geo-foundry.test","password":"gf-ta-003"}' "$BASE/api/users/login"

CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$COOKIE" -H "content-type: application/json" \
  -d '{"name":"bad-site","type":"url","site":999999}' "$BASE/api/connectors")
echo "BAD_SITE=$CODE (expect 400)"

XSITE=$(PSQL "SELECT id FROM geo_foundry.sites WHERE tenant_id=414 LIMIT 1")
CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$COOKIE" -H "content-type: application/json" \
  -d "{\"name\":\"x-site\",\"type\":\"url\",\"site\":$XSITE}" "$BASE/api/connectors")
echo "CROSS_TENANT_SITE=$CODE (expect 403)"

CID=$(PSQL "INSERT INTO geo_foundry.connectors (name,type,status,site_id,tenant_id,source_endpoint) VALUES ('e2e-stall-'||extract(epoch from now())::int,'rss','active',374,413,'https://example.com/s.xml') RETURNING id")
PSQL "INSERT INTO geo_foundry.intake_items (channel,connector_id,tenant_id,status,duplicate_status,suggested_site_id,title) VALUES ('rss',$CID,413,'adopted','unique',374,'RSS: old')" >/dev/null
curl -s -o /dev/null -w "POLL=%{http_code}\n" -X POST "$BASE/api/internal/connectors/poll-due" \
  -H "Authorization: users API-Key $SKEY" -H "x-request-id: diag-stall2" \
  -H "content-type: application/json" -d "{}"
N=$(PSQL "SELECT count(*) FROM geo_foundry.intake_items WHERE connector_id=$CID AND channel='rss'")
LATEST=$(PSQL "SELECT status FROM geo_foundry.intake_items WHERE connector_id=$CID AND channel='rss' ORDER BY id DESC LIMIT 1")
echo "STALL_FIX: parents=$N (expect 2) latest=$LATEST (expect fetching or failed)"

PSQL "DELETE FROM geo_foundry.intake_items WHERE connector_id IN (SELECT id FROM geo_foundry.connectors WHERE name LIKE 'e2e-stall-%')" >/dev/null
PSQL "DELETE FROM geo_foundry.connectors WHERE name LIKE 'e2e-stall-%' OR name IN ('bad-site','x-site')" >/dev/null
echo CLEANED
