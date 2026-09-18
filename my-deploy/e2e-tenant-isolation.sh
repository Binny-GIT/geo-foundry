#!/usr/bin/env bash
# 跨租户泄漏 E2E：租户 413 的 editor / tenant-admin / content-service / automation
# 四种身份交叉访问 414/415 的文章、站点、connector、媒体、internal 与 Console。
# 期望详情/写路径精确 403/404；真实列表路由必须 200 且结果集为空。
set -uo pipefail

BASE=${BASE:-http://127.0.0.1:3090}
TS="$(date +%s)-$$"
PREFIX="E2E-TI-$TS"
PASS=()
FAIL=()
EDPW="${GF_E2E_EDITOR_PASSWORD:?set GF_E2E_EDITOR_PASSWORD}"
TAPW="${GF_E2E_TENANT_ADMIN_PASSWORD:?set GF_E2E_TENANT_ADMIN_PASSWORD}"
ECOOKIE="/tmp/ti-e-$TS.jar"
ACOOKIE="/tmp/ti-a-$TS.jar"
TMP="/tmp/ti-$TS"
mkdir -p "$TMP"

ok() { PASS+=("$1"); echo "PASS: $1"; }
bad() { FAIL+=("$1"); echo "FAIL: $1"; }
check() {
  if [ "$1" = "$2" ]; then ok "$3 ($2)"; else bad "$3 (want $1 got $2)"; fi
}

PSQL() { sudo docker exec pg-server psql -U gpucloud -d geo_foundry -qAt -c "$1"; }
Q() { PSQL "SELECT $1"; }

jget() { # file dotted.path
  python3 - "$1" "$2" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh:
    value=json.load(fh)
for part in sys.argv[2].split("."):
    if not part: continue
    value=value[int(part)] if isinstance(value,list) else value[part]
if value is True: print("true")
elif value is False: print("false")
elif value is None: print("null")
else: print(value)
PY
}

cleanup() {
  set +e
  PSQL "DELETE FROM pgboss.job WHERE singleton_key IN (SELECT 'intake-'||id FROM geo_foundry.intake_items WHERE title LIKE '$PREFIX%') OR data->>'intakeItemId' IN (SELECT id::text FROM geo_foundry.intake_items WHERE title LIKE '$PREFIX%')" >/dev/null 2>&1
  PSQL "DELETE FROM geo_foundry.source_snapshots WHERE intake_item_id IN (SELECT id FROM geo_foundry.intake_items WHERE title LIKE '$PREFIX%')" >/dev/null 2>&1
  PSQL "DELETE FROM geo_foundry.article_sources WHERE intake_item_id IN (SELECT id FROM geo_foundry.intake_items WHERE title LIKE '$PREFIX%')" >/dev/null 2>&1
  PSQL "DELETE FROM geo_foundry.intake_items WHERE title LIKE '$PREFIX%' OR connector_id IN (SELECT id FROM geo_foundry.connectors WHERE name LIKE '$PREFIX%')" >/dev/null 2>&1
  PSQL "DELETE FROM geo_foundry.connectors WHERE name LIKE '$PREFIX%'" >/dev/null 2>&1
  PSQL "DELETE FROM geo_foundry.api_credentials WHERE name LIKE '$PREFIX%'" >/dev/null 2>&1
  rm -rf "$TMP" "$ECOOKIE" "$ACOOKIE"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

login() { # email password jar outfile
  curl -sS -o "$4" -w '%{http_code}' -X POST "$BASE/api/users/login" \
    -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" -c "$3"
}

expect_denied() { # name url jar expected [method body expectedCode]
  local name=$1 url=$2 jar=$3 want=$4 method=${5:-GET} body=${6:-} expected_code=${7:-}
  local outfile="$TMP/denied-${#PASS[@]}-${#FAIL[@]}.json"
  local args=(-sS -o "$outfile" -w '%{http_code}' -X "$method")
  [ -n "$jar" ] && args+=(-b "$jar")
  [ -n "$body" ] && args+=(-H 'content-type: application/json' -d "$body")
  local code
  code=$(curl "${args[@]}" "$url")
  if [ "$want" = "40x" ]; then
    case "$code" in 403|404) ok "$name -> $code";; *) bad "$name -> $code $(cut -c1-160 "$outfile")";; esac
  elif [ "$code" = "$want" ]; then
    ok "$name -> $code"
  else
    bad "$name -> $code (want $want; $(cut -c1-160 "$outfile"))"
    return
  fi
  if [ -n "$expected_code" ]; then
    local actual_code
    actual_code=$(jget "$outfile" error.code 2>/dev/null || true)
    check "$expected_code" "$actual_code" "$name stable code"
  fi
}

expect_empty_list() { # name url header-or-cookie mode
  local name=$1 url=$2 auth=$3 mode=$4 outfile="$TMP/list-${#PASS[@]}-${#FAIL[@]}.json" code
  if [ "$mode" = "header" ]; then
    code=$(curl --globoff -sS -o "$outfile" -w '%{http_code}' -H "$auth" "$url")
  else
    code=$(curl --globoff -sS -o "$outfile" -w '%{http_code}' -b "$auth" "$url")
  fi
  if [ "$code" != "200" ]; then
    bad "$name -> $code (must be a real 200 list route)"
    return
  fi
  local count
  count=$(python3 - "$outfile" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
docs=d.get("docs",[]) if isinstance(d,dict) else []
print(len(docs) if isinstance(docs,list) else -1)
PY
)
  [ "$count" = "0" ] && ok "$name -> 200 empty" || bad "$name -> 200 but docs=$count"
}

# ---------- 0. 稳定 foreign fixture ----------
FE=$(Q "id FROM geo_foundry.content_editions WHERE tenant_id IN (414,415) ORDER BY id LIMIT 1")
FT=$(Q "tenant_id FROM geo_foundry.content_editions WHERE id=$FE")
FS=$(Q "id FROM geo_foundry.sites WHERE tenant_id=$FT AND status='active' ORDER BY id LIMIT 1")
FS414=$(Q "id FROM geo_foundry.sites WHERE tenant_id=414 AND status='active' ORDER BY id LIMIT 1")
FS415=$(Q "id FROM geo_foundry.sites WHERE tenant_id=415 AND status='active' ORDER BY id LIMIT 1")
LS413=$(Q "id FROM geo_foundry.sites WHERE tenant_id=413 AND status='active' ORDER BY id LIMIT 1")
FM=$(Q "coalesce(min(filename),'') FROM geo_foundry.media WHERE tenant_id<>413 AND filename IS NOT NULL")
FET=$(Q "coalesce(title,'') FROM geo_foundry.edition_revisions WHERE parent_id=$FE AND latest")
[ -n "$FE" ] && [ -n "$FS" ] && [ -n "$FS414" ] && [ -n "$FS415" ] && [ -n "$LS413" ] \
  || { echo "missing foreign/local fixture"; exit 1; }
FCID=$(PSQL "INSERT INTO geo_foundry.connectors (name,type,status,site_id,tenant_id,source_endpoint,poll_interval_minutes,last_polled_at) VALUES ('$PREFIX foreign rss','rss','active',$FS415,415,'https://example.com/$TS/foreign.xml',10080,now()) RETURNING id")
[ -n "$FCID" ] || { echo "failed to create foreign connector"; exit 1; }
echo "foreign fixture: edition=$FE tenant=$FT site=$FS sites414/415=$FS414/$FS415 connector=$FCID media=$FM"

# ---------- 1. 登录三个人工/服务身份 + 自助 automation key ----------
CODE=$(login gf-editor-test@geo-foundry.dev "$EDPW" "$ECOOKIE" "$TMP/editor-login.json")
check 200 "$CODE" "editor login"
CODE=$(login embed-tenant-admin@geo-foundry.test "$TAPW" "$ACOOKIE" "$TMP/admin-login.json")
check 200 "$CODE" "tenant-admin login"
SKEY=$(sudo python3 -c 'import json;print(json.load(open("/opt/geo-foundry/credentials/content-service-keyring.json"))["tenants"]["413"])')
[ -n "$SKEY" ] || { bad "tenant 413 service key missing"; exit 1; }
SAUTH="Authorization: users API-Key $SKEY"

CODE=$(curl -sS -o "$TMP/key.json" -w '%{http_code}' -b "$ECOOKIE" \
  -H 'content-type: application/json' \
  -d "{\"name\":\"$PREFIX automation\",\"defaultSiteId\":$LS413}" \
  "$BASE/api/api-credentials")
check 201 "$CODE" "editor self-issues automation key"
AKEY=$(jget "$TMP/key.json" apiKey)
AAUTH="Authorization: users API-Key $AKEY"

# ---------- 2. automation key 跨租户面 ----------
expect_empty_list "automation foreign sites filtered" \
  "$BASE/api/sites?depth=0&limit=100&where[id][in]=$FS414,$FS415" "$AAUTH" header
expect_empty_list "automation foreign connector filtered" \
  "$BASE/api/connectors?depth=0&limit=100&where[id][in]=$FCID" "$AAUTH" header

for pair in "414|$FS414" "415|$FS415"; do
  tenant=${pair%%|*}; site=${pair#*|}; outfile="$TMP/site-$tenant.json"
  CODE=$(curl -sS -o "$outfile" -w '%{http_code}' -X POST "$BASE/api/intake-operations" \
    -H "$AAUTH" -H 'content-type: application/json' \
    -d "{\"channel\":\"webhook\",\"title\":\"$PREFIX site $tenant\",\"bodyMarkdown\":\"body $tenant\",\"suggestedSiteId\":$site}")
  check 403 "$CODE" "automation post to tenant $tenant site denied"
  check INTAKE_SITE_TENANT_MISMATCH "$(jget "$outfile" error.code)" "tenant $tenant site code"
done
check 0 "$(Q "count(*) FROM geo_foundry.intake_items WHERE title LIKE '$PREFIX site %'")" "cross-tenant site attempts write no intake"

CODE=$(curl -sS -o "$TMP/foreign-connector.json" -w '%{http_code}' -X POST "$BASE/api/intake-operations" \
  -H "$AAUTH" -H 'content-type: application/json' \
  -d "{\"channel\":\"rss\",\"title\":\"$PREFIX foreign connector\",\"connectorId\":$FCID}")
check 403 "$CODE" "automation foreign connector denied at intake entry"
check INTAKE_CONNECTOR_TENANT_MISMATCH "$(jget "$TMP/foreign-connector.json" error.code)" "foreign connector code"
check 0 "$(Q "count(*) FROM geo_foundry.intake_items WHERE title='$PREFIX foreign connector'")" "foreign connector attempt writes no intake"

CODE=$(curl -sS -o "$TMP/intake-get.json" -w '%{http_code}' -H "$AAUTH" "$BASE/api/intake-operations")
check 404 "$CODE" "public intake read surface remains absent"
check API_ROUTE_NOT_FOUND "$(jget "$TMP/intake-get.json" error.code)" "absent intake-read route code"

# ---------- 3. 既有详情/写路径全拒 ----------
expect_denied "editor foreign draft read" "$BASE/api/content-editions/$FE?draft=true&depth=0" "$ECOOKIE" 404
expect_denied "editor foreign patch" "$BASE/api/content-editions/$FE?draft=true&depth=0" "$ECOOKIE" 403 PATCH '{"title":"leak"}' TENANT_SCOPE_DENIED
expect_denied "editor foreign transition" "$BASE/api/editions/$FE/workflow-transitions" "$ECOOKIE" 403 POST '{"target":"review"}' EDITION_WORKFLOW_TENANT_MISMATCH

CODE=$(curl -sS -o "$TMP/evaluation.json" -w '%{http_code}' -X POST \
  "$BASE/api/workspaces/editor/editions/$FE/evaluation-operations" -b "$ECOOKIE" \
  -H 'content-type: application/json' -H "x-request-id: ti-ev-$TS" -H "idempotency-key: ti-ev-$TS" -d '{}')
case "$CODE" in 403|404) ok "editor foreign evaluation -> $CODE";; *) bad "editor foreign evaluation -> $CODE";; esac

CODE=$(curl -sS -o "$TMP/restore.json" -w '%{http_code}' -X POST \
  "$BASE/api/workspaces/editions/$FE/restore-draft" -b "$ECOOKIE" \
  -H 'content-type: application/json' -H "x-request-id: ti-rs-$TS" -H "idempotency-key: ti-rs-$TS" \
  -d '{"expectedRevision":0,"expectedUpdatedAt":"2026-09-09T00:00:00.000Z","reason":"probe","versionId":1}')
case "$CODE" in 403|404) ok "editor foreign restore -> $CODE";; *) bad "editor foreign restore -> $CODE";; esac

expect_denied "admin foreign reviewer approve" "$BASE/api/workspaces/reviewer/editions/$FE/approve" "$ACOOKIE" 403 POST '{"expectedRevision":0}' REVIEWER_EDITION_REVIEWER_REQUIRED
expect_denied "admin foreign review comment" "$BASE/api/editions/$FE/review-comments" "$ACOOKIE" 40x POST '{"body":"cross-tenant probe"}'
expect_denied "admin foreign publication plan" "$BASE/api/publication-plan-operations" "$ACOOKIE" 40x POST "{\"editionId\":$FE,\"scheduledFor\":\"2026-09-09T00:00:00.000Z\",\"timezone\":\"UTC\"}"
expect_denied "admin foreign rollback intent" "$BASE/api/rollback-operations/intents" "$ECOOKIE" 40x POST "{\"siteId\":$FS,\"expectedCurrentReleaseId\":\"rel-x-$TS\",\"expectedCurrentManifestSha256\":\"$(python3 -c 'print("0"*64)')\",\"targetReleaseId\":\"rel-y-$TS\",\"expectedManifestSha256\":\"$(python3 -c 'print("0"*64)')\"}"

# ---------- 4. internal：413 content-service 碰 foreign 资源 ----------
CODE=$(curl -sS -o "$TMP/internal-edition.json" -w '%{http_code}' -H "$SAUTH" "$BASE/api/internal/editions/$FE/input")
check 404 "$CODE" "internal service foreign edition hidden"
CODE=$(curl -sS -o "$TMP/internal-site.json" -w '%{http_code}' -H "$SAUTH" "$BASE/api/internal/sites/$FS/compile-snapshot")
check 404 "$CODE" "internal service foreign site hidden"

# ---------- 5. 媒体回读 ----------
if [ -n "$FM" ]; then
  CODE=$(curl -sS -o "$TMP/media.json" -w '%{http_code}' -b "$ECOOKIE" "$BASE/api/media/file/$FM")
  check 404 "$CODE" "editor foreign media file hidden"
else
  echo "note: no foreign media fixture, skip media read"
fi

# ---------- 6. 真实列表路由必须 200 且对 foreign id 返回空 ----------
expect_empty_list "editor foreign edition list filtered" \
  "$BASE/api/content-editions?draft=true&depth=0&limit=100&where[id][in]=$FE" "$ECOOKIE" cookie
expect_empty_list "editor foreign sites list filtered" \
  "$BASE/api/sites?depth=0&limit=100&where[id][in]=$FS414,$FS415" "$ECOOKIE" cookie
expect_empty_list "editor foreign connectors list filtered" \
  "$BASE/api/connectors?depth=0&limit=100&where[id][in]=$FCID" "$ECOOKIE" cookie

# ---------- 7. Console 直链不泄漏 foreign 标题 ----------
for path in "/admin/collections/content-editions/$FE" "/admin/collections/sites/$FS"; do
  PAGE=$(curl -sS -b "$ECOOKIE" "$BASE$path")
  if [ -n "$FET" ] && printf '%s' "$PAGE" | grep -Fq "$FET"; then
    bad "console page $path leaks foreign title"
  else
    ok "console page $path no foreign title"
  fi
done

# ---------- 8. 清理完整性 ----------
cleanup
trap - EXIT
check 0 "$(Q "count(*) FROM geo_foundry.api_credentials WHERE name LIKE '$PREFIX%'")" "automation key cleaned"
check 0 "$(Q "count(*) FROM geo_foundry.connectors WHERE name LIKE '$PREFIX%'")" "foreign connector cleaned"
check 0 "$(Q "count(*) FROM geo_foundry.intake_items WHERE title LIKE '$PREFIX%'")" "cross-tenant attempts cleaned"

echo "PASS=${#PASS[@]} FAIL=${#FAIL[@]}"
[ "${#FAIL[@]}" = "0" ]
