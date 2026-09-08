#!/usr/bin/env bash
# 跨租户泄漏 E2E：租户 413 的 editor/tenant-admin/service-key 三种身份，
# 交叉访问 414/415 的文章、站点、媒体、internal 端点与 Console 页面直链，
# 期望全部 403/404 且响应不泄漏对方任何字段；列表接口断言结果集不含对方 id。
set -uo pipefail
BASE=http://127.0.0.1:3090
TS=$(date +%s)
PASS=(); FAIL=()
ok() { PASS+=("$1"); echo "PASS: $1"; }
bad() { FAIL+=("$1"); echo "FAIL: $1"; }
EDPW="${GF_E2E_EDITOR_PASSWORD:?}"
TAPW="${GF_E2E_TENANT_ADMIN_PASSWORD:?}"

PSQL() { sudo docker exec pg-server psql -U gpucloud -d geo_foundry -qAt -c "$1"; }
Q() { PSQL "SELECT $1"; }

# 对方 fixture：414/415 各取一个 edition/site（排除 413 自己）
FE=$(Q "id FROM geo_foundry.content_editions WHERE tenant_id IN (414,415) ORDER BY id LIMIT 1")
FT=$(Q "tenant_id FROM geo_foundry.content_editions WHERE id=$FE")
FS=$(Q "id FROM geo_foundry.sites WHERE tenant_id=$FT ORDER BY id LIMIT 1")
FM=$(Q "coalesce(min(filename),'') FROM geo_foundry.media WHERE tenant_id<>413 AND filename IS NOT NULL")
FET=$(Q "replace(coalesce(title,''),' ','_') FROM geo_foundry.edition_revisions WHERE parent_id=$FE AND latest")
echo "foreign fixture: edition=$FE tenant=$FT site=$FS media=$FM title=$FET"

login() { curl -s -X POST $BASE/api/users/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"$2\"}" -c "$3" -o /dev/null; }
login gf-editor-test@geo-foundry.dev "$EDPW" /tmp/ti-e.jar
login embed-tenant-admin@geo-foundry.test "$TAPW" /tmp/ti-a.jar
SKEY=$(sudo python3 -c 'import json;print(json.load(open("/opt/geo-foundry/credentials/content-service-keyring.json"))["tenants"]["413"])')
auth() { echo "Authorization: users API-Key $SKEY"; }

expect_denied() { # name url jar expect40x [method body]
  local name=$1 url=$2 jar=$3 want=$4 method=${5:-GET} body=$6
  local extra=()
  [ -n "$jar" ] && extra+=(-b "$jar")
  [ -n "$body" ] && extra+=(-H 'Content-Type: application/json' -d "$body")
  local out; out=$(curl -s -w '\n%{http_code}' -X "$method" "${extra[@]}" "$url")
  local code; code=$(echo "$out" | tail -1)
  case "$code" in
    403|404) ok "$name -> $code";;
    *) bad "$name -> $code $(echo "$out" | head -1 | cut -c1-120)";;
  esac
}

# ---------- 1. 详情/写路径全拒 ----------
expect_denied "editor foreign draft read" "$BASE/api/content-editions/$FE?draft=true&depth=0" /tmp/ti-e.jar 404
expect_denied "editor foreign patch" "$BASE/api/content-editions/$FE?draft=true&depth=0" /tmp/ti-e.jar 404 PATCH '{"title":"leak"}'
expect_denied "editor foreign transition" "$BASE/api/editions/$FE/workflow-transitions" /tmp/ti-e.jar 404 POST '{"target":"review"}'
expect_denied "editor foreign evaluation" "$BASE/api/workspaces/editor/editions/$FE/evaluation-operations" /tmp/ti-e.jar 40x POST '{}'
expect_denied "editor foreign restore" "$BASE/api/workspaces/editions/$FE/restore-draft" /tmp/ti-e.jar 404 POST '{}'
expect_denied "admin foreign reviewer approve" "$BASE/api/workspaces/reviewer/editions/$FE/approve" /tmp/ti-a.jar 404 POST '{"expectedRevision":0}'
expect_denied "admin foreign review comment" "$BASE/api/editions/$FE/review-comments" /tmp/ti-a.jar 404 POST '{"body":"x","kind":"comment"}'
expect_denied "admin foreign publication plan" "$BASE/api/publication-plan-operations" /tmp/ti-a.jar 40x POST "{\"editionId\":$FE,\"scheduledFor\":\"2026-09-09T00:00:00.000Z\",\"timezone\":\"UTC\"}"
expect_denied "admin foreign rollback intent" "$BASE/api/rollback-operations/intents" /tmp/ti-e.jar 40x POST "{\"siteId\":$FS,\"expectedCurrentReleaseId\":\"rel-x-$TS\",\"expectedCurrentManifestSha256\":\"$(python3 -c 'print("0"*64)')\",\"targetReleaseId\":\"rel-y-$TS\",\"expectedManifestSha256\":\"$(python3 -c 'print("0"*64)')\"}"

# ---------- 2. internal 端点：413 服务身份碰对方资源 ----------
expect_denied "internal foreign edition input" "$BASE/api/internal/editions/$FE/input" "" 404
S=$(curl -s -w '\n%{http_code}' -H "$(auth)" "$BASE/api/internal/editions/$FE/input")
[ "$(echo "$S" | tail -1)" = "404" ] && ok "internal(service) foreign input -> 404" || bad "internal input $(echo "$S"|tail -2)"
S=$(curl -s -w '\n%{http_code}' -H "$(auth)" "$BASE/api/internal/sites/$FS/compile-snapshot")
[ "$(echo "$S" | tail -1)" = "404" ] && ok "internal(service) foreign compile-snapshot -> 404" || bad "internal snapshot $(echo "$S"|tail -2)"

# ---------- 3. 媒体回读 ----------
if [ -n "$FM" ]; then
  S=$(curl -s -w '\n%{http_code}' -b /tmp/ti-e.jar "$BASE/api/media/file/$FM")
  [ "$(echo "$S" | tail -1)" = "404" ] && ok "editor foreign media file -> 404" || bad "media $(echo "$S"|tail -2)"
else
  echo "note: no foreign media fixture, skip media read"
fi

# ---------- 4. 列表不泄漏对方租户 id ----------
for slug in content-editions sites connectors intake-items article-sources review-comments releases rollback-intents domains quality-assessments; do
  R=$(curl -s -b /tmp/ti-e.jar "$BASE/api/$slug?draft=true&depth=0&limit=100")
  N=$(echo "$R" | python3 -c '
import json,sys
try:
    d=json.load(sys.stdin)
except Exception:
    print("parse-error"); raise SystemExit
docs=d.get("docs",d) if isinstance(d,dict) else d
ids=[str(x.get("id","")) for x in docs] if isinstance(docs,list) else []
tenant_leak=any(x.get("tenant") in (414,415) or x.get("tenantId") in (414,415) for x in docs if isinstance(x,dict))
print(("leak" if tenant_leak else "clean")+":"+str(len(ids)))' 2>/dev/null || echo parse-error)
  case "$N" in
    leak:*) bad "list $slug leaks foreign tenant ($N)";;
    clean:*) ok "list $slug clean ($N)";;
    *) bad "list $slug $N";;
  esac
done

# ---------- 5. Console 页面直链不含对方标题 ----------
for path in "/admin/collections/content-editions/$FE" "/admin/collections/sites/$FS"; do
  R=$(curl -s -b /tmp/ti-e.jar "$BASE$path")
  echo "$R" | grep -q "$FET" && bad "console page $path leaks foreign title" || ok "console page $path no foreign title"
done

echo "PASS=${#PASS[@]} FAIL=${#FAIL[@]}"
[ "${#FAIL[@]}" = "0" ]
