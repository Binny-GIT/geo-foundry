#!/usr/bin/env bash
# Console 页面 + 实体写路由 E2E：以 super-admin / editor / tenant-admin 三个会话
# 请求全部 Console 页面（HTTP 200 + 关键文案），并跑 tenants/domains/sites/users
# 写路由与媒体上传/回读。凭据经环境变量注入。测试数据带 e2e- 前缀并在末尾清理。
set -uo pipefail
BASE=http://127.0.0.1:3090
TS=$(date +%s)
PASS=(); FAIL=()
ok() { PASS+=("$1"); echo "PASS: $1"; }
bad() { FAIL+=("$1"); echo "FAIL: $1"; }
PSQL() { sudo docker exec pg-server psql -U gpucloud -d geo_foundry -qAt -c "$1"; }
EDPW="${GF_E2E_EDITOR_PASSWORD:?}"; RTPW="${GF_E2E_ROOT_PASSWORD:?}"; TAPW="${GF_E2E_TENANT_ADMIN_PASSWORD:?}"
login() { curl -s -X POST $BASE/api/users/login -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" -c "$3" -o /dev/null; }
login gf-editor-test@geo-foundry.dev "$EDPW" /tmp/cp-e.jar
login gf-root-test@geo-foundry.dev "$RTPW" /tmp/cp-r.jar
login embed-tenant-admin@geo-foundry.test "$TAPW" /tmp/cp-t.jar
page() { # jar path expected_text label
  local out; out=$(curl -s -w '\n%{http_code}' -b "$1" "$BASE$2"); local code=$(echo "$out" | tail -1)
  if [ "$code" = 200 ] && echo "$out" | grep -q -- "$3"; then ok "$4 [$2]"; else bad "$4 [$2] code=$code $(echo "$out" | grep -o 'CMS_INTERNAL_ERROR\|Application error\|Internal Server Error' | head -1)"; fi
}
jget() { python3 -c "import json,sys;d=json.load(sys.stdin);print(eval('d'+sys.argv[1]))" "$1"; }
call() { # jar method path body
  if [ -n "${4:-}" ]; then curl -s -w '\n%{http_code}' -b "$1" -X "$2" "$BASE/api$3" -H 'Content-Type: application/json' -d "$4"; else curl -s -w '\n%{http_code}' -b "$1" -X "$2" "$BASE/api$3"; fi
}
status() { echo "$1" | tail -1; }
body() { echo "$1" | head -1; }

# ---------- 1. 页面（super-admin） ----------
page /tmp/cp-r.jar /admin "文章状态分布" "dashboard root"
page /tmp/cp-r.jar /admin/work "工作台" "work root"
page /tmp/cp-r.jar /admin/inbox "Inbox\|稿源\|intake" "inbox root"
page /tmp/cp-r.jar /admin/api-stats "接口统计" "api-stats root"
for slug in users tenants sites domains content-editions media url-records quality-assessments releases rollback-intents publication-plans operations; do
  page /tmp/cp-r.jar "/admin/collections/$slug" "" "list $slug root"
done
page /tmp/cp-r.jar "/admin/collections/content-editions?site=375&status=published&q=e" "文章列表" "editions filtered root"
page /tmp/cp-r.jar "/admin/collections/users?role=editor" "系统用户管理" "users filtered root"
page /tmp/cp-r.jar "/admin/collections/content-editions/586" "站点文章入口" "article detail root"
page /tmp/cp-r.jar "/admin/collections/sites/375" "发布历史与恢复" "site detail root"
page /tmp/cp-r.jar "/admin/collections/publication-plans?view=week" "按周" "plans week root"
RID=$(PSQL "SELECT id FROM geo_foundry.releases ORDER BY id DESC LIMIT 1")
page /tmp/cp-r.jar "/admin/collections/releases/$RID" "发布版本" "release detail root"
OID=$(PSQL "SELECT id FROM geo_foundry.operations ORDER BY id DESC LIMIT 1")
page /tmp/cp-r.jar "/admin/collections/operations/$OID" "操作 ID" "operation detail root"
UID_=$(PSQL "SELECT id FROM geo_foundry.url_records ORDER BY id DESC LIMIT 1")
page /tmp/cp-r.jar "/admin/collections/url-records/$UID_" "路径" "url-record detail root"
page /tmp/cp-r.jar "/admin/collections/tenants/413" "租户" "tenant detail root"
page /tmp/cp-r.jar "/admin/collections/tenants/413/edit" "编辑租户" "tenant edit root"
page /tmp/cp-r.jar "/admin/collections/users/1115/edit" "编辑系统用户管理" "user edit root"
# 已下线资源 404
for slug in contents performance-snapshots; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -b /tmp/cp-r.jar "$BASE/admin/collections/$slug")
  [ "$code" = 404 ] && ok "removed resource $slug 404" || bad "removed $slug code=$code"
done

# ---------- 2. 页面（editor，租户 413） ----------
page /tmp/cp-e.jar /admin "文章状态分布" "dashboard editor"
page /tmp/cp-e.jar /admin/work "工作台" "work editor"
page /tmp/cp-e.jar /admin/inbox "" "inbox editor"
page /tmp/cp-e.jar "/admin/collections/content-editions" "文章列表" "editions editor"
page /tmp/cp-e.jar "/admin/collections/sites" "站点列表" "sites editor"
page /tmp/cp-e.jar "/admin/collections/content-editions/586" "站点文章入口" "article detail editor"
page /tmp/cp-e.jar "/admin/collections/sites/374" "站点信息" "site detail editor"
code=$(curl -s -o /dev/null -w '%{http_code}' -b /tmp/cp-e.jar "$BASE/admin/collections/users")
[ "$code" = 404 ] && ok "editor users list 404 (policy)" || bad "editor users code=$code"
code=$(curl -s -o /dev/null -w '%{http_code}' -b /tmp/cp-e.jar "$BASE/admin/collections/sites/376")
[ "$code" = 404 ] && ok "editor foreign site 404" || bad "editor foreign site code=$code"

# ---------- 3. 页面（tenant-admin 413） ----------
page /tmp/cp-t.jar /admin "文章状态分布" "dashboard tenant-admin"
page /tmp/cp-t.jar "/admin/collections/users" "系统用户管理" "users tenant-admin"
page /tmp/cp-t.jar "/admin/collections/domains" "域名" "domains tenant-admin"
page /tmp/cp-t.jar "/admin/collections/tenants" "租户" "tenants tenant-admin"
N=$(curl -s -b /tmp/cp-t.jar "$BASE/api/users?depth=0&limit=100" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("totalDocs","?"))' 2>/dev/null)
echo "(users list api for tenant-admin totalDocs=$N)"

# ---------- 4. 写路由：tenants（super-admin） ----------
R=$(call /tmp/cp-r.jar POST /tenants "{\"name\":\"e2e-tenant-$TS\"}")
TID=$(body "$R" | jget '["doc"]["id"]' 2>/dev/null)
[ "$(status "$R")" = 201 ] && [ -n "$TID" ] && ok "tenant create 201 id=$TID" || bad "tenant create $R"
R=$(call /tmp/cp-r.jar PATCH "/tenants/$TID" "{\"name\":\"e2e-tenant-$TS-renamed\"}")
[ "$(status "$R")" = 200 ] && [ "$(PSQL "SELECT name FROM geo_foundry.tenants WHERE id=$TID")" = "e2e-tenant-$TS-renamed" ] && ok "tenant patch 200" || bad "tenant patch $R"
R=$(call /tmp/cp-t.jar POST /tenants "{\"name\":\"nope\"}")
[ "$(status "$R")" = 403 ] && ok "tenant create by tenant-admin 403" || bad "tenant create ta $R"

# ---------- 5. 写路由：sites + domains（tenant-admin 413） ----------
SITE_BODY="{\"name\":\"e2e-site-$TS\",\"locale\":\"en-US\",\"timezone\":\"UTC\",\"status\":\"active\",\"contentStrategy\":{\"contentAngles\":[\"a1\"],\"cta\":\"go\",\"expertise\":[],\"language\":null,\"positioning\":\"pos\",\"preferredTopics\":[\"t1\",\"t2\"],\"prohibitedExpressions\":[\"x\"],\"prohibitedTopics\":[],\"targetAudience\":[],\"tone\":null},\"qualityThresholds\":{\"crossDomainBlock\":0.9,\"crossDomainReview\":0.8,\"dimensionMinimum\":70,\"overallMinimum\":75,\"sameSiteTitleBlock\":0.85},\"seoDefaults\":{\"defaultDescription\":\"d\",\"titleSuffix\":\"s\"}}"
R=$(call /tmp/cp-t.jar POST /sites "$SITE_BODY")
SID=$(body "$R" | jget '["doc"]["id"]' 2>/dev/null)
[ "$(status "$R")" = 201 ] && [ -n "$SID" ] && [ "$(PSQL "SELECT tenant_id||'|'||quality_thresholds_overall_minimum FROM geo_foundry.sites WHERE id=$SID")" = "413|75" ] \
  && [ "$(PSQL "SELECT content_strategy_preferred_topics::text||'|'||content_strategy_content_angles::text FROM geo_foundry.sites WHERE id=$SID")" = '["t1", "t2"]|["a1"]' ] && ok "site create 201 (strategy arrays persisted)" || bad "site create $R"
R=$(call /tmp/cp-t.jar PATCH "/sites/$SID" '{"timezone":"Not/AZone"}')
[ "$(status "$R")" = 400 ] && ok "site patch invalid timezone 400" || bad "site tz $R"
R=$(call /tmp/cp-t.jar PATCH "/sites/$SID" '{"name":"e2e-site-renamed","status":"disabled"}')
[ "$(status "$R")" = 200 ] && [ "$(PSQL "SELECT name||'|'||status FROM geo_foundry.sites WHERE id=$SID")" = "e2e-site-renamed|disabled" ] && ok "site patch 200" || bad "site patch $R"
R=$(call /tmp/cp-r.jar POST /sites "$SITE_BODY")
[ "$(status "$R")" = 403 ] && ok "site create by super-admin 403 (policy)" || bad "site create root $R"
R=$(call /tmp/cp-t.jar POST /domains "{\"hostname\":\"E2E-$TS.Example.COM\",\"site\":$SID,\"role\":\"canonical\",\"status\":\"active\"}")
DID=$(body "$R" | jget '["doc"]["id"]' 2>/dev/null)
[ "$(status "$R")" = 201 ] && [ "$(PSQL "SELECT hostname||'|'||tenant_id FROM geo_foundry.domains WHERE id=$DID")" = "e2e-$TS.example.com|413" ] && ok "domain create 201 normalized" || bad "domain create $R"
R=$(call /tmp/cp-t.jar POST /domains "{\"hostname\":\"e2e-$TS.example.com\",\"site\":$SID}")
[ "$(status "$R")" = 400 ] && ok "domain duplicate hostname 400" || bad "domain dup $R"
R=$(call /tmp/cp-t.jar POST /domains "{\"hostname\":\"e2e-x-$TS.example.com\",\"site\":376}")
[ "$(status "$R")" = 400 ] && ok "domain foreign-tenant site 400" || bad "domain foreign $R"
R=$(call /tmp/cp-t.jar PATCH "/domains/$DID" '{"status":"disabled","role":"alias"}')
[ "$(status "$R")" = 200 ] && [ "$(PSQL "SELECT role||'|'||status FROM geo_foundry.domains WHERE id=$DID")" = "alias|disabled" ] && ok "domain patch 200" || bad "domain patch $R"

# ---------- 6. 写路由：users ----------
R=$(call /tmp/cp-t.jar POST /users "{\"email\":\"e2e-user-$TS@geo-foundry.test\",\"role\":\"editor\",\"password\":\"e2e-pass-001\"}")
NUID=$(body "$R" | jget '["doc"]["id"]' 2>/dev/null)
[ "$(status "$R")" = 201 ] && [ "$(PSQL "SELECT role||'|'||tenant_id FROM geo_foundry.users WHERE id=$NUID")" = "editor|413" ] && ok "user create by tenant-admin 201 (tenant forced)" || bad "user create $R"
login "e2e-user-$TS@geo-foundry.test" e2e-pass-001 /tmp/cp-n.jar
[ "$(curl -s -o /dev/null -w '%{http_code}' -b /tmp/cp-n.jar "$BASE/admin/work")" = 200 ] && ok "new user can log in" || bad "new user login"
R=$(call /tmp/cp-t.jar POST /users "{\"email\":\"e2e-sa-$TS@geo-foundry.test\",\"role\":\"super-admin\",\"password\":\"e2e-pass-001\"}")
[ "$(status "$R")" = 403 ] && ok "tenant-admin cannot mint super-admin 403" || bad "escalation $R"
R=$(call /tmp/cp-t.jar POST /users "{\"email\":\"e2e-user-$TS@geo-foundry.test\",\"role\":\"editor\",\"password\":\"e2e-pass-001\"}")
[ "$(status "$R")" = 400 ] && ok "duplicate email 400" || bad "dup email $R"
R=$(call /tmp/cp-t.jar PATCH "/users/$NUID" '{"role":"reviewer","password":"e2e-pass-002"}')
[ "$(status "$R")" = 200 ] && [ "$(PSQL "SELECT role FROM geo_foundry.users WHERE id=$NUID")" = reviewer ] && ok "user patch role+password 200" || bad "user patch $R"
login "e2e-user-$TS@geo-foundry.test" e2e-pass-002 /tmp/cp-n2.jar
[ "$(curl -s -o /dev/null -w '%{http_code}' -b /tmp/cp-n2.jar "$BASE/admin/work")" = 200 ] && ok "new password works" || bad "new password"
R=$(call /tmp/cp-e.jar PATCH "/users/$NUID" '{"role":"editor"}')
[ "$(status "$R")" = 403 ] && ok "editor cannot patch users 403" || bad "editor patch $R"
R=$(call /tmp/cp-r.jar POST /users "{\"email\":\"e2e-root-$TS@geo-foundry.test\",\"role\":\"editor\",\"password\":\"e2e-pass-001\"}")
[ "$(status "$R")" = 400 ] && ok "super-admin creating tenant role without tenant 400" || bad "root no tenant $R"
R=$(call /tmp/cp-r.jar POST /users "{\"email\":\"e2e-root-$TS@geo-foundry.test\",\"role\":\"editor\",\"password\":\"e2e-pass-001\",\"tenant\":$TID}")
RUID=$(body "$R" | jget '["doc"]["id"]' 2>/dev/null)
[ "$(status "$R")" = 201 ] && [ "$(PSQL "SELECT tenant_id FROM geo_foundry.users WHERE id=$RUID")" = "$TID" ] && ok "super-admin creates user in chosen tenant" || bad "root create $R"

# ---------- 7. 媒体上传与回读（editor 413） ----------
printf '\x89PNG\r\n\x1a\n' > /tmp/e2e-$TS.png; head -c 300 /dev/urandom >> /tmp/e2e-$TS.png
R=$(curl -s -w '\n%{http_code}' -b /tmp/cp-e.jar -X POST "$BASE/api/media" -F "file=@/tmp/e2e-$TS.png;type=image/png" -F "alt=e2e alt $TS" -F "caption=cap")
MID=$(body "$R" | jget '["doc"]["id"]' 2>/dev/null)
[ "$(status "$R")" = 201 ] && [ "$(PSQL "SELECT tenant_id||'|'||filename FROM geo_foundry.media WHERE id=$MID")" = "413|e2e-$TS.png" ] && body "$R" | python3 -c 'import json,sys; d=json.load(sys.stdin)["doc"]; assert d["url"]=="/api/media/file/e2e-'"$TS"'.png" and d["mediaPath"]=="/media/tenants/413/e2e-'"$TS"'.png"' && ok "media upload 201 with derived paths" || bad "media upload $R"
curl -s -b /tmp/cp-e.jar -o /tmp/e2e-$TS.back "$BASE/api/media/file/e2e-$TS.png" -w '%{http_code}\n' > /tmp/mcode
[ "$(cat /tmp/mcode)" = 200 ] && cmp -s /tmp/e2e-$TS.png /tmp/e2e-$TS.back && ok "media file readback byte-identical" || bad "media readback code=$(cat /tmp/mcode)"
code=$(curl -s -o /dev/null -w '%{http_code}' -b /tmp/cp-t.jar "$BASE/api/media/file/ui-loop-admin-ui-20260823-3a5da6eb756e.png")
[ "$code" = 404 ] && ok "media of other tenant 404" || bad "media foreign code=$code"
code=$(curl -s -o /dev/null -w '%{http_code}' -b /tmp/cp-r.jar "$BASE/api/media/file/ui-loop-admin-ui-20260823-3a5da6eb756e.png")
[ "$code" = 200 ] && ok "legacy media object readable by super-admin" || bad "legacy media code=$code"
R=$(curl -s -w '\n%{http_code}' -b /tmp/cp-e.jar -X POST "$BASE/api/media" -F "file=@/tmp/e2e-$TS.png;type=text/plain" -F "alt=x")
[ "$(status "$R")" = 400 ] && ok "media wrong mime 400" || bad "media mime $R"
page /tmp/cp-e.jar "/admin/collections/media/$MID" "替代文本" "media detail editor"

# ---------- 清理 ----------
PSQL "DELETE FROM geo_foundry.users_sessions WHERE parent_id IN ($NUID,$RUID)" >/dev/null 2>&1
PSQL "DELETE FROM geo_foundry.users WHERE id IN ($NUID,$RUID)" >/dev/null
PSQL "DELETE FROM geo_foundry.domains WHERE id=$DID" >/dev/null
PSQL "DELETE FROM geo_foundry.sites WHERE id=$SID" >/dev/null
PSQL "DELETE FROM geo_foundry.tenants WHERE id=$TID" >/dev/null
PSQL "DELETE FROM geo_foundry.media WHERE id=$MID" >/dev/null
rm -f /tmp/e2e-$TS.png /tmp/e2e-$TS.back

echo; echo "PASS=${#PASS[@]} FAIL=${#FAIL[@]}"; for f in "${FAIL[@]}"; do echo "  - $f"; done
