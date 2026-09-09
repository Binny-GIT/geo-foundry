#!/usr/bin/env bash
# 公开 Delivery API E2E：临时给一个已有 published 测试站点绑定 canonical domain，
# 验证列表/详情成功、非发布文章和未知站点拒绝；不修改任何文章内容。
set -uo pipefail
BASE=http://127.0.0.1:3090
TS=$(date +%s)
DOMAIN="e2e-delivery-$TS.test"
PASS=(); FAIL=()
ok() { PASS+=("$1"); echo "PASS: $1"; }
bad() { FAIL+=("$1"); echo "FAIL: $1"; }
PSQL() { sudo docker exec pg-server psql -U gpucloud -d geo_foundry -qAt -c "$1"; }
Q() { PSQL "SELECT $1"; }

FIXTURE=$(Q "id||'|'||site_id||'|'||tenant_id FROM geo_foundry.content_editions WHERE workflow_status='published' AND site_id IS NOT NULL AND tenant_id IS NOT NULL ORDER BY id DESC LIMIT 1")
ED=${FIXTURE%%|*}
REST=${FIXTURE#*|}; SITE=${REST%%|*}; TENANT=${REST##*|}
DRAFT=$(Q "id FROM geo_foundry.content_editions WHERE workflow_status<>'published' ORDER BY id DESC LIMIT 1")
if [ -z "$ED" ] || [ -z "$SITE" ] || [ -z "$TENANT" ]; then
  echo "DELIVERY_E2E_PUBLISHED_FIXTURE_MISSING" >&2
  exit 1
fi
cleanup() { PSQL "DELETE FROM geo_foundry.domains WHERE hostname='$DOMAIN'" >/dev/null; }
trap cleanup EXIT
PSQL "INSERT INTO geo_foundry.domains (hostname,site_id,tenant_id,role,status) VALUES ('$DOMAIN',$SITE,$TENANT,'canonical','active')" >/dev/null

R=$(curl -s -w '\n%{http_code}' "$BASE/api/delivery/sites/$DOMAIN/articles?limit=50")
CODE=$(echo "$R" | tail -1); BODY=$(echo "$R" | head -n -1)
[ "$CODE" = "200" ] && echo "$BODY" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert isinstance(d["docs"],list) and d["totalDocs"]>=1' \
  && ok "published list 200" || bad "list code=$CODE body=$BODY"

echo "$BODY" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert any(x.get("id")=='"$ED"' for x in d["docs"])' \
  && ok "list contains edition $ED" || bad "list missing edition $ED"

R=$(curl -s -w '\n%{http_code}' "$BASE/api/delivery/articles/$ED")
CODE=$(echo "$R" | tail -1); BODY=$(echo "$R" | head -n -1)
[ "$CODE" = "200" ] && echo "$BODY" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["id"]=='"$ED"' and isinstance(d["body"],list) and d["locale"]' \
  && ok "published detail 200" || bad "detail code=$CODE body=$BODY"

if [ -n "$DRAFT" ]; then
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/delivery/articles/$DRAFT")
  [ "$CODE" = "404" ] && ok "non-published detail 404" || bad "draft detail code=$CODE"
fi
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/delivery/sites/missing-$TS.test/articles")
[ "$CODE" = "404" ] && ok "unknown domain 404" || bad "unknown domain code=$CODE"

for _ in $(seq 1 10); do
  USAGE=$(Q "count(*) FROM geo_foundry.api_usage_dailies WHERE tenant_id=$TENANT AND site_id=$SITE AND route IN ('article','articles') AND date=(now() AT TIME ZONE 'UTC')::date::text")
  [ "$USAGE" -ge 2 ] && break
  sleep 1
done
[ "$USAGE" -ge 2 ] && ok "delivery usage upserted" || bad "usage rows=$USAGE"

echo "PASS=${#PASS[@]} FAIL=${#FAIL[@]}"
[ "${#FAIL[@]}" = "0" ]
