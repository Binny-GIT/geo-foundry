#!/usr/bin/env bash
# 外部采集工具全链路 E2E：用户自助密钥、默认站点、收件箱/自动成稿、
# 幂等、URL/RSS、入口校验、权限边界、请求体上限、限流与吊销。
# fixture 全部自建自删；在 mk-dev 宿主机运行。
set -uo pipefail

BASE=${BASE:-http://127.0.0.1:3090}
TENANT=413
RUN="$(date +%s)-$$"
PREFIX="E2E-IA-$RUN"
FUNC_EMAIL="e2e-ia-$RUN@geo-foundry.test"
RATE_EMAIL="e2e-ia-rate-$RUN@geo-foundry.test"
FUNC_PASSWORD="gf-ia-func-001"
RATE_PASSWORD="gf-ia-rate-001"
TAPW="${GF_E2E_TENANT_ADMIN_PASSWORD:?set GF_E2E_TENANT_ADMIN_PASSWORD}"
TMP="/tmp/gf-e2e-intake-$RUN"
ADMIN_COOKIE="$TMP/admin.cookie"
FUNC_COOKIE="$TMP/func.cookie"
RATE_COOKIE="$TMP/rate.cookie"
mkdir -p "$TMP"

PASS=()
FAIL=()
ok() { PASS+=("$1"); echo "PASS: $1"; }
bad() { FAIL+=("$1"); echo "FAIL: $1"; }
check() {
  if [ "$1" = "$2" ]; then ok "$3 ($2)"; else bad "$3 (want $1 got $2)"; fi
}
check_one_of() {
  local actual=$1 name=$2; shift 2
  local candidate
  for candidate in "$@"; do
    if [ "$actual" = "$candidate" ]; then ok "$name ($actual)"; return; fi
  done
  bad "$name (got $actual; want one of: $*)"
}

PSQL() { sudo docker exec pg-server psql -U gpucloud -d geo_foundry -qAt -c "$1"; }
Q() { PSQL "SELECT $1"; }

jget() { # file dotted.path
  python3 - "$1" "$2" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh:
    value = json.load(fh)
for part in sys.argv[2].split("."):
    if not part:
        continue
    value = value[int(part)] if isinstance(value, list) else value[part]
if value is True:
    print("true")
elif value is False:
    print("false")
elif value is None:
    print("null")
elif isinstance(value, (dict, list)):
    print(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
else:
    print(value)
PY
}

call_key() { # key method path outfile [json]
  local key=$1 method=$2 path=$3 outfile=$4 body=${5:-}
  if [ -n "$body" ]; then
    curl -sS -o "$outfile" -w '%{http_code}' -X "$method" "$BASE$path" \
      -H "Authorization: users API-Key $key" -H 'content-type: application/json' -d "$body"
  else
    curl -sS -o "$outfile" -w '%{http_code}' -X "$method" "$BASE$path" \
      -H "Authorization: users API-Key $key"
  fi
}

call_key_file() { # key method path outfile bodyfile
  curl -sS -o "$4" -w '%{http_code}' -X "$2" "$BASE$3" \
    -H "Authorization: users API-Key $1" -H 'content-type: application/json' \
    --data-binary "@$5"
}

call_cookie() { # cookie method path outfile [json]
  local cookie=$1 method=$2 path=$3 outfile=$4 body=${5:-}
  if [ -n "$body" ]; then
    curl -sS -o "$outfile" -w '%{http_code}' -X "$method" "$BASE$path" \
      -b "$cookie" -H 'content-type: application/json' -d "$body"
  else
    curl -sS -o "$outfile" -w '%{http_code}' -X "$method" "$BASE$path" -b "$cookie"
  fi
}

cleanup() {
  local prefix="$PREFIX%"
  set +e
  # 停掉/删除仍在队列中的测试抓取任务，防止清理后 Worker 再回写。
  PSQL "DELETE FROM pgboss.job WHERE singleton_key IN (SELECT 'intake-'||id FROM geo_foundry.intake_items WHERE title LIKE '$prefix') OR data->>'intakeItemId' IN (SELECT id::text FROM geo_foundry.intake_items WHERE title LIKE '$prefix')" >/dev/null 2>&1
  PSQL "DELETE FROM geo_foundry.source_snapshots WHERE intake_item_id IN (SELECT id FROM geo_foundry.intake_items WHERE title LIKE '$prefix')" >/dev/null 2>&1
  PSQL "DELETE FROM geo_foundry.article_sources WHERE intake_item_id IN (SELECT id FROM geo_foundry.intake_items WHERE title LIKE '$prefix') OR edition_id IN (SELECT id FROM geo_foundry.content_editions WHERE owner_id IN (SELECT id FROM geo_foundry.users WHERE email IN ('$FUNC_EMAIL','$RATE_EMAIL')))" >/dev/null 2>&1
  PSQL "DELETE FROM geo_foundry.edition_revisions WHERE parent_id IN (SELECT id FROM geo_foundry.content_editions WHERE owner_id IN (SELECT id FROM geo_foundry.users WHERE email IN ('$FUNC_EMAIL','$RATE_EMAIL')))" >/dev/null 2>&1
  PSQL "DELETE FROM geo_foundry.content_editions WHERE owner_id IN (SELECT id FROM geo_foundry.users WHERE email IN ('$FUNC_EMAIL','$RATE_EMAIL')) OR title LIKE '$prefix'" >/dev/null 2>&1
  PSQL "DELETE FROM geo_foundry.intake_items WHERE title LIKE '$prefix' OR created_by_id IN (SELECT id FROM geo_foundry.users WHERE email IN ('$FUNC_EMAIL','$RATE_EMAIL'))" >/dev/null 2>&1
  PSQL "DELETE FROM geo_foundry.connectors WHERE name LIKE '$prefix%'" >/dev/null 2>&1
  PSQL "DELETE FROM geo_foundry.api_credentials WHERE user_id IN (SELECT id FROM geo_foundry.users WHERE email IN ('$FUNC_EMAIL','$RATE_EMAIL'))" >/dev/null 2>&1
  PSQL "DELETE FROM geo_foundry.users_sessions WHERE _parent_id IN (SELECT id FROM geo_foundry.users WHERE email IN ('$FUNC_EMAIL','$RATE_EMAIL'))" >/dev/null 2>&1
  PSQL "DELETE FROM geo_foundry.users WHERE email IN ('$FUNC_EMAIL','$RATE_EMAIL')" >/dev/null 2>&1
  PSQL "DELETE FROM geo_foundry.tenants WHERE name='$PREFIX unauthorized tenant'" >/dev/null 2>&1
  rm -rf "$TMP"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

SITE=$(Q "id FROM geo_foundry.sites WHERE tenant_id=$TENANT AND status='active' ORDER BY id LIMIT 1")
SITE2=$(Q "id FROM geo_foundry.sites WHERE tenant_id=$TENANT AND status='active' ORDER BY id OFFSET 1 LIMIT 1")
[ -n "$SITE" ] && [ -n "$SITE2" ] || { echo "need two active tenant-$TENANT sites"; exit 1; }
ok "fixture sites=$SITE,$SITE2"

# ---------- 0. 管理员登录 + 两个临时真人用户（功能 / 限流隔离） ----------
CODE=$(curl -sS -o "$TMP/admin-login.json" -w '%{http_code}' -c "$ADMIN_COOKIE" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"embed-tenant-admin@geo-foundry.test\",\"password\":\"$TAPW\"}" \
  "$BASE/api/users/login")
check 200 "$CODE" "tenant-admin login"

for spec in "$FUNC_EMAIL|$FUNC_PASSWORD" "$RATE_EMAIL|$RATE_PASSWORD"; do
  email=${spec%%|*}; password=${spec#*|}
  out="$TMP/create-${email%%@*}.json"
  CODE=$(call_cookie "$ADMIN_COOKIE" POST /api/users "$out" \
    "{\"email\":\"$email\",\"password\":\"$password\",\"role\":\"editor\",\"tenant\":$TENANT}")
  check 201 "$CODE" "create fixture user $email"
done
FUNC_UID=$(Q "id FROM geo_foundry.users WHERE email='$FUNC_EMAIL'")
RATE_UID=$(Q "id FROM geo_foundry.users WHERE email='$RATE_EMAIL'")
[ -n "$FUNC_UID" ] && [ -n "$RATE_UID" ] && ok "fixture user ids=$FUNC_UID,$RATE_UID" || { bad "fixture users missing"; exit 1; }

CODE=$(curl -sS -o "$TMP/func-login.json" -w '%{http_code}' -c "$FUNC_COOKIE" \
  -H 'content-type: application/json' -d "{\"email\":\"$FUNC_EMAIL\",\"password\":\"$FUNC_PASSWORD\"}" \
  "$BASE/api/users/login")
check 200 "$CODE" "functional user login"
CODE=$(curl -sS -o "$TMP/rate-login.json" -w '%{http_code}' -c "$RATE_COOKIE" \
  -H 'content-type: application/json' -d "{\"email\":\"$RATE_EMAIL\",\"password\":\"$RATE_PASSWORD\"}" \
  "$BASE/api/users/login")
check 200 "$CODE" "rate-limit user login"

# ---------- 1. 密钥配置：无默认 / 默认站点 / 自动成稿 ----------
CODE=$(call_cookie "$FUNC_COOKIE" POST /api/api-credentials "$TMP/key-nosite.json" \
  "{\"name\":\"$PREFIX no-site\"}")
check 201 "$CODE" "issue no-default key"
KEY_NOSITE=$(jget "$TMP/key-nosite.json" apiKey)

CODE=$(call_cookie "$FUNC_COOKIE" POST /api/api-credentials "$TMP/key-manual.json" \
  "{\"name\":\"$PREFIX inbox\",\"defaultSiteId\":$SITE}")
check 201 "$CODE" "issue inbox key"
KEY_MANUAL=$(jget "$TMP/key-manual.json" apiKey)
KEY_MANUAL_ID=$(jget "$TMP/key-manual.json" doc.id)
check "$SITE" "$(jget "$TMP/key-manual.json" doc.defaultSiteId)" "default site persisted"

CODE=$(call_cookie "$FUNC_COOKIE" POST /api/api-credentials "$TMP/key-auto-missing-site.json" \
  "{\"name\":\"$PREFIX invalid-auto\",\"autoAdopt\":true}")
check 400 "$CODE" "auto-adopt requires default site"
check API_CREDENTIAL_AUTO_ADOPT_SITE_REQUIRED "$(jget "$TMP/key-auto-missing-site.json" error.code)" "auto-adopt missing-site code"

CODE=$(call_cookie "$FUNC_COOKIE" POST /api/api-credentials "$TMP/key-auto.json" \
  "{\"name\":\"$PREFIX auto\",\"defaultSiteId\":$SITE,\"autoAdopt\":true}")
check 201 "$CODE" "issue auto-adopt key"
KEY_AUTO=$(jget "$TMP/key-auto.json" apiKey)
KEY_AUTO_ID=$(jget "$TMP/key-auto.json" doc.id)
check true "$(jget "$TMP/key-auto.json" doc.autoAdopt)" "autoAdopt persisted"

# ---------- 2. 默认站点 / 收件箱 / 人工采纳 ----------
TITLE_READY="$PREFIX ready"
CODE=$(call_key "$KEY_MANUAL" POST /api/intake-operations "$TMP/ready.json" \
  "{\"channel\":\"webhook\",\"title\":\"$TITLE_READY\",\"bodyMarkdown\":\"# Ready\\n\\nmanual adoption\"}")
check 201 "$CODE" "webhook submission without explicit site"
READY_ID=$(jget "$TMP/ready.json" intakeItem.id)
check "$SITE" "$(jget "$TMP/ready.json" intakeItem.suggestedSite)" "credential default site fallback"
check ready "$(jget "$TMP/ready.json" intakeItem.status)" "non-auto key stays ready"
check false "$(jget "$TMP/ready.json" autoAdopted)" "non-auto response flag"

CODE=$(call_key "$KEY_MANUAL" POST "/api/intake-operations/$READY_ID/adopt" "$TMP/adopt-denied.json" '{}')
check 403 "$CODE" "automation key cannot adopt"
check INTAKE_EDITOR_REQUIRED "$(jget "$TMP/adopt-denied.json" error.code)" "adopt denied code"

CODE=$(call_cookie "$ADMIN_COOKIE" POST "/api/intake-operations/$READY_ID/adopt" "$TMP/adopt.json" '{}')
check 200 "$CODE" "human admin adopts inbox item"
MANUAL_EDITION=$(jget "$TMP/adopt.json" editionId)
ROW=$(Q "owner_id||'|'||creation_origin||'|'||workflow_status FROM geo_foundry.content_editions WHERE id=$MANUAL_EDITION")
check "$FUNC_UID|ai|draft" "$ROW" "manual adoption owner/origin/status"
check 1 "$(Q "count(*) FROM geo_foundry.article_sources WHERE edition_id=$MANUAL_EDITION AND intake_item_id=$READY_ID AND role='primary'")" "manual adoption source link"

# ---------- 3. 自动成稿 + 幂等重放 ----------
TITLE_AUTO="$PREFIX auto draft"
AUTO_BODY="# Auto\n\ndirect-to-workspace $RUN"
CODE=$(call_key "$KEY_AUTO" POST /api/intake-operations "$TMP/auto.json" \
  "{\"channel\":\"webhook\",\"title\":\"$TITLE_AUTO\",\"bodyMarkdown\":\"$AUTO_BODY\"}")
check 201 "$CODE" "auto-adopt webhook submission"
check true "$(jget "$TMP/auto.json" autoAdopted)" "autoAdopted=true"
AUTO_ID=$(jget "$TMP/auto.json" intakeItem.id)
AUTO_EDITION=$(jget "$TMP/auto.json" editionId)
check adopted "$(jget "$TMP/auto.json" intakeItem.status)" "auto intake adopted"
ROW=$(Q "owner_id||'|'||creation_origin||'|'||workflow_status||'|'||site_id FROM geo_foundry.content_editions WHERE id=$AUTO_EDITION")
check "$FUNC_UID|ai|draft|$SITE" "$ROW" "auto draft owner/origin/status/site"
check 1 "$(Q "count(*) FROM geo_foundry.article_sources WHERE edition_id=$AUTO_EDITION AND intake_item_id=$AUTO_ID AND role='primary'")" "auto source link"

CODE=$(call_key "$KEY_AUTO" POST /api/intake-operations "$TMP/replay.json" \
  "{\"channel\":\"webhook\",\"title\":\"$TITLE_AUTO\",\"bodyMarkdown\":\"$AUTO_BODY\"}")
check 200 "$CODE" "same-body replay returns 200"
check true "$(jget "$TMP/replay.json" idempotentReplay)" "replay flag"
check "$AUTO_ID" "$(jget "$TMP/replay.json" intakeItem.id)" "replay returns same intake"
check "$AUTO_EDITION" "$(jget "$TMP/replay.json" editionId)" "replay returns same edition"
check 1 "$(Q "count(*) FROM geo_foundry.content_editions WHERE title='$TITLE_AUTO'")" "replay creates no second article"

# ---------- 4. 正文与请求体入口校验（失败零落库） ----------
TITLE_NOSITE="$PREFIX missing site"
CODE=$(call_key "$KEY_NOSITE" POST /api/intake-operations "$TMP/missing-site.json" \
  "{\"channel\":\"webhook\",\"title\":\"$TITLE_NOSITE\",\"bodyMarkdown\":\"body\"}")
check 400 "$CODE" "webhook missing explicit/default site"
check INTAKE_SUGGESTED_SITE_REQUIRED "$(jget "$TMP/missing-site.json" error.code)" "missing-site code"

python3 - "$TMP/invalid-block.json" "$PREFIX invalid block" <<'PY'
import json, sys
body = ':::gf-block\n{"blockType":"image","src":"not-a-url","alt":""}\n:::'
json.dump({"channel":"webhook","title":sys.argv[2],"bodyMarkdown":body}, open(sys.argv[1],"w",encoding="utf-8"), ensure_ascii=False)
PY
CODE=$(call_key_file "$KEY_AUTO" POST /api/intake-operations "$TMP/invalid-block-response.json" "$TMP/invalid-block.json")
check 400 "$CODE" "invalid protected block rejected"
check INTAKE_BODY_BLOCKS_INVALID "$(jget "$TMP/invalid-block-response.json" error.code)" "stable body-block error code"
check 0 "$(Q "count(*) FROM geo_foundry.intake_items WHERE title='$PREFIX invalid block'")" "invalid block writes no intake"

python3 - "$TMP/field-too-long.json" "$PREFIX field too long" <<'PY'
import json, sys
json.dump({"channel":"webhook","title":sys.argv[2],"suggestedSiteId":413,"bodyMarkdown":"x"*200001}, open(sys.argv[1],"w",encoding="utf-8"))
PY
# 用真实站点替换占位值，避免 JSON 生成命令依赖 shell 插值。
python3 - "$TMP/field-too-long.json" "$SITE" <<'PY'
import json, sys
p=sys.argv[1]; d=json.load(open(p)); d["suggestedSiteId"]=int(sys.argv[2]); json.dump(d,open(p,"w"))
PY
CODE=$(call_key_file "$KEY_MANUAL" POST /api/intake-operations "$TMP/field-too-long-response.json" "$TMP/field-too-long.json")
check 400 "$CODE" "200001-char field rejected"
check INTAKE_CREATE_BODY_INVALID "$(jget "$TMP/field-too-long-response.json" error.code)" "field-length error code"

python3 - "$TMP/body-too-large.json" "$PREFIX body too large" "$SITE" <<'PY'
import json, sys
json.dump({"channel":"webhook","title":sys.argv[2],"suggestedSiteId":int(sys.argv[3]),"bodyMarkdown":"x"*1100000}, open(sys.argv[1],"w"))
PY
CODE=$(call_key_file "$KEY_MANUAL" POST /api/intake-operations "$TMP/body-too-large-response.json" "$TMP/body-too-large.json")
check 413 "$CODE" ">1MiB request rejected before schema"
check INTEGRATION_BODY_TOO_LARGE "$(jget "$TMP/body-too-large-response.json" error.code)" "body-size error code"

# ---------- 5. URL / RSS 通道与 connector 入口校验 ----------
CODE=$(call_key "$KEY_MANUAL" POST /api/intake-operations "$TMP/url-missing.json" \
  "{\"channel\":\"url\",\"title\":\"$PREFIX url missing\"}")
check 400 "$CODE" "url requires sourceUrl"
check INTAKE_SOURCE_URL_REQUIRED "$(jget "$TMP/url-missing.json" error.code)" "url missing-source code"

TITLE_URL="$PREFIX url"
URL="https://example.com/$RUN/article?utm_source=e2e#fragment"
CODE=$(call_key "$KEY_MANUAL" POST /api/intake-operations "$TMP/url.json" \
  "{\"channel\":\"url\",\"title\":\"$TITLE_URL\",\"sourceUrl\":\"$URL\"}")
check_one_of "$CODE" "url submission queued or safely deferred" 201 202
URL_ID=$(jget "$TMP/url.json" intakeItem.id)
check false "$(jget "$TMP/url.json" autoAdopted)" "url never auto-adopts"

CODE=$(call_key "$KEY_MANUAL" POST /api/intake-operations "$TMP/url-duplicate.json" \
  "{\"channel\":\"url\",\"title\":\"$PREFIX url duplicate title\",\"sourceUrl\":\"https://example.com/$RUN/article\"}")
check 200 "$CODE" "normalized duplicate URL returns 200"
check duplicate "$(jget "$TMP/url-duplicate.json" intakeItem.duplicateStatus)" "duplicate URL marked duplicate"

CODE=$(call_key "$KEY_MANUAL" POST /api/intake-operations "$TMP/rss-missing.json" \
  "{\"channel\":\"rss\",\"title\":\"$PREFIX rss missing\"}")
check 400 "$CODE" "rss requires connectorId"
check INTAKE_CONNECTOR_REQUIRED "$(jget "$TMP/rss-missing.json" error.code)" "rss missing-connector code"

CODE=$(call_key "$KEY_MANUAL" POST /api/intake-operations "$TMP/connector-wrong-channel.json" \
  "{\"channel\":\"webhook\",\"title\":\"$PREFIX wrong connector channel\",\"bodyMarkdown\":\"body\",\"connectorId\":999999}")
check 400 "$CODE" "non-rss channel rejects connectorId"
check INTAKE_CONNECTOR_CHANNEL_INVALID "$(jget "$TMP/connector-wrong-channel.json" error.code)" "connector channel code"

CODE=$(call_key "$KEY_MANUAL" POST /api/intake-operations "$TMP/rss-missing-row.json" \
  "{\"channel\":\"rss\",\"title\":\"$PREFIX missing connector row\",\"connectorId\":999999}")
check 400 "$CODE" "rss rejects missing connector row"
check INTAKE_CONNECTOR_NOT_FOUND "$(jget "$TMP/rss-missing-row.json" error.code)" "missing connector code"

CODE=$(call_cookie "$ADMIN_COOKIE" POST /api/connectors "$TMP/connector-rss.json" \
  "{\"name\":\"$PREFIX rss\",\"type\":\"rss\",\"status\":\"active\",\"site\":$SITE,\"sourceEndpoint\":\"https://example.com/$RUN/feed.xml\"}")
check 201 "$CODE" "create active RSS connector"
RSS_CONNECTOR=$(jget "$TMP/connector-rss.json" doc.id)
CODE=$(call_cookie "$ADMIN_COOKIE" POST /api/connectors "$TMP/connector-webhook.json" \
  "{\"name\":\"$PREFIX webhook\",\"type\":\"webhook\",\"status\":\"active\",\"site\":$SITE}")
check 201 "$CODE" "create non-RSS connector fixture"
WEBHOOK_CONNECTOR=$(jget "$TMP/connector-webhook.json" doc.id)
CODE=$(call_cookie "$ADMIN_COOKIE" POST /api/connectors "$TMP/connector-disabled.json" \
  "{\"name\":\"$PREFIX disabled rss\",\"type\":\"rss\",\"status\":\"disabled\",\"site\":$SITE,\"sourceEndpoint\":\"https://example.com/$RUN/disabled.xml\"}")
check 201 "$CODE" "create disabled RSS connector fixture"
DISABLED_CONNECTOR=$(jget "$TMP/connector-disabled.json" doc.id)

for pair in "$WEBHOOK_CONNECTOR|wrong-type" "$DISABLED_CONNECTOR|disabled"; do
  cid=${pair%%|*}; label=${pair#*|}
  CODE=$(call_key "$KEY_MANUAL" POST /api/intake-operations "$TMP/rss-invalid-$label.json" \
    "{\"channel\":\"rss\",\"title\":\"$PREFIX rss $label\",\"connectorId\":$cid}")
  check 400 "$CODE" "rss rejects $label connector"
  check INTAKE_CONNECTOR_INVALID "$(jget "$TMP/rss-invalid-$label.json" error.code)" "$label connector code"
done

TITLE_RSS="$PREFIX rss valid"
CODE=$(call_key "$KEY_MANUAL" POST /api/intake-operations "$TMP/rss.json" \
  "{\"channel\":\"rss\",\"title\":\"$TITLE_RSS\",\"connectorId\":$RSS_CONNECTOR}")
check_one_of "$CODE" "valid RSS submission queued or safely deferred" 201 202
RSS_ID=$(jget "$TMP/rss.json" intakeItem.id)
check "$RSS_CONNECTOR" "$(Q "connector_id FROM geo_foundry.intake_items WHERE id=$RSS_ID")" "RSS connector persisted"

# ---------- 6. automation 权限边界（绑定用户本身是 editor 也不放大） ----------
CODE=$(call_key "$KEY_AUTO" POST '/api/content-editions?draft=true&depth=0' "$TMP/edition-create-denied.json" '{}')
check 403 "$CODE" "automation cannot create article"

CODE=$(call_key "$KEY_AUTO" POST "/api/editions/$AUTO_EDITION/workflow-transitions" "$TMP/workflow-denied.json" '{"target":"review"}')
check 403 "$CODE" "automation cannot transition workflow"
check EDITION_WORKFLOW_ACTOR_INVALID "$(jget "$TMP/workflow-denied.json" error.code)" "workflow denied code"

CODE=$(call_key "$KEY_AUTO" POST "/api/editions/$AUTO_EDITION/publish-operations" "$TMP/publish-denied.json" '{}')
check 403 "$CODE" "automation cannot publish"
check EDITION_WORKFLOW_ACTOR_INVALID "$(jget "$TMP/publish-denied.json" error.code)" "publish denied code"

CODE=$(call_key "$KEY_AUTO" POST /api/media "$TMP/media-denied.json")
check 403 "$CODE" "automation cannot upload media"
check CMS_FORBIDDEN "$(jget "$TMP/media-denied.json" message)" "media denied code"

CODE=$(call_key "$KEY_AUTO" POST /api/tenants "$TMP/tenant-denied.json" \
  "{\"name\":\"$PREFIX unauthorized tenant\"}")
check 403 "$CODE" "automation cannot create tenant"
check CMS_FORBIDDEN "$(jget "$TMP/tenant-denied.json" message)" "tenant denied code"

CODE=$(call_key "$KEY_AUTO" GET "/api/internal/editions/$AUTO_EDITION/input" "$TMP/internal-denied.json")
check 403 "$CODE" "automation cannot access internal zero-trust surface"
check INTERNAL_FORBIDDEN "$(jget "$TMP/internal-denied.json" error.code)" "internal denied code"

CODE=$(call_key "$KEY_AUTO" GET '/api/sites?depth=0&limit=100' "$TMP/sites.json")
check 200 "$CODE" "automation can read reference sites"
CODE=$(call_key "$KEY_AUTO" GET '/api/connectors?depth=0&limit=100' "$TMP/connectors.json")
check 200 "$CODE" "automation can read reference connectors"

# ---------- 7. 吊销下一请求立即 401 ----------
CODE=$(call_cookie "$FUNC_COOKIE" POST "/api/api-credentials/$KEY_AUTO_ID/revoke" "$TMP/revoke.json")
check 200 "$CODE" "self-revoke auto key"
CODE=$(call_key "$KEY_AUTO" POST /api/intake-operations "$TMP/revoked.json" \
  "{\"channel\":\"webhook\",\"title\":\"$PREFIX revoked\",\"bodyMarkdown\":\"body\",\"suggestedSiteId\":$SITE}")
check 401 "$CODE" "revoked key rejected on next request"
check INTAKE_UNAUTHENTICATED "$(jget "$TMP/revoked.json" error.code)" "revoked key code"

# ---------- 8. 独立身份限流：前 120 次计数，第 121 次 429 ----------
CODE=$(call_cookie "$RATE_COOKIE" POST /api/api-credentials "$TMP/key-rate.json" \
  "{\"name\":\"$PREFIX rate\"}")
check 201 "$CODE" "issue dedicated rate-limit key"
KEY_RATE=$(jget "$TMP/key-rate.json" apiKey)
RESTART_BEFORE=$(sudo docker inspect -f '{{.RestartCount}}' geo-foundry-cms-mk-dev)
RATE_400=0
RATE_OTHER=0
START_SECONDS=$(date +%s)
for _ in $(seq 1 120); do
  code=$(call_key "$KEY_RATE" POST /api/intake-operations "$TMP/rate-loop.json" '{}')
  if [ "$code" = 400 ]; then RATE_400=$((RATE_400+1)); else RATE_OTHER=$((RATE_OTHER+1)); fi
done
ELAPSED=$(( $(date +%s) - START_SECONDS ))
check 120 "$RATE_400" "first 120 guarded requests accepted then fail schema"
check 0 "$RATE_OTHER" "no early rate-limit response"
CODE=$(call_key "$KEY_RATE" POST /api/intake-operations "$TMP/rate-121.json" '{}')
check 429 "$CODE" "121st request rate-limited"
check INTEGRATION_RATE_LIMITED "$(jget "$TMP/rate-121.json" error.code)" "rate-limit code"
RESTART_AFTER=$(sudo docker inspect -f '{{.RestartCount}}' geo-foundry-cms-mk-dev)
check "$RESTART_BEFORE" "$RESTART_AFTER" "CMS did not restart during in-memory rate-limit test"
[ "$ELAPSED" -lt 60 ] && ok "rate-limit burst completed inside one window (${ELAPSED}s)" || bad "rate-limit burst crossed 60s (${ELAPSED}s)"

# ---------- 9. 清理完整性（先手工执行一次，EXIT trap 再幂等兜底） ----------
cleanup
trap - EXIT
LEFT=$(Q "count(*) FROM geo_foundry.users WHERE email IN ('$FUNC_EMAIL','$RATE_EMAIL')")
check 0 "$LEFT" "fixture users cleaned"
LEFT=$(Q "count(*) FROM geo_foundry.intake_items WHERE title LIKE '$PREFIX%'")
check 0 "$LEFT" "fixture intake cleaned"
LEFT=$(Q "count(*) FROM geo_foundry.content_editions WHERE title LIKE '$PREFIX%'")
check 0 "$LEFT" "fixture editions cleaned"
LEFT=$(Q "count(*) FROM geo_foundry.connectors WHERE name LIKE '$PREFIX%'")
check 0 "$LEFT" "fixture connectors cleaned"

echo "-----"
echo "PASS=${#PASS[@]} FAIL=${#FAIL[@]}"
[ "${#FAIL[@]}" = "0" ]
