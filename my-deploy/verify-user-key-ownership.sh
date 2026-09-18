#!/usr/bin/env bash
# 用户密钥归属链验证：自助创建 → 密钥权限面（角色无关）→ 投稿归属 →
# 采纳后文章 owner/来源标注 → 自助吊销。fixture 全部自建自删。
set -u
BASE=http://127.0.0.1:3090
PSQL() { sudo docker exec pg-server psql -U gpucloud -d geo_foundry -At -c "$1"; }
ECOOKIE=/tmp/gf-e2e-uk-editor.txt
TACOOKIE=/tmp/gf-e2e-uk-ta.txt
STAMP=$(date +%s)
EEMAIL="e2e-uk-editor-$STAMP@geo-foundry.test"
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1"; }
check() {
  if [ "$1" = "$2" ]; then ok "$3 ($2)"; else bad "$3 (want $1 got $2)"; fi
}
jqget() { python3 -c "import json,sys;d=json.load(sys.stdin);print($1)"; }

TENANT=413
SITE=$(PSQL "SELECT id FROM geo_foundry.sites WHERE tenant_id=$TENANT AND status='active' ORDER BY id LIMIT 1")
[ -n "$SITE" ] && ok "fixture site=$SITE" || { bad "no site in tenant $TENANT"; exit 1; }

# 0. tenant-admin 登录（建用户 + 采纳接力）
CODE=$(curl -s -o /dev/null -w '%{http_code}' -c "$TACOOKIE" -H 'content-type: application/json' \
  -d '{"email":"embed-tenant-admin@geo-foundry.test","password":"gf-ta-003"}' "$BASE/api/users/login")
check 200 "$CODE" "tenant-admin 登录"

# 1. 建 editor 用户（真人，无 users 资源管理权限）
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$TACOOKIE" -H 'content-type: application/json' \
  -d "{\"email\":\"$EEMAIL\",\"password\":\"gf-uk-e2e-001\",\"role\":\"editor\",\"tenant\":$TENANT}" \
  "$BASE/api/users")
check 201 "$CODE" "创建 editor 用户"
EID=$(PSQL "SELECT id FROM geo_foundry.users WHERE email='$EEMAIL'")
[ -n "$EID" ] && ok "editor id=$EID" || bad "editor 未落库"

# 2. editor 登录，然后自助创建密钥（不带 userId —— 无 users.create 权限也应成功）
CODE=$(curl -s -o /dev/null -w '%{http_code}' -c "$ECOOKIE" -H 'content-type: application/json' \
  -d "{\"email\":\"$EEMAIL\",\"password\":\"gf-uk-e2e-001\"}" "$BASE/api/users/login")
check 200 "$CODE" "editor 登录"
CODE=$(curl -s -o /tmp/gf-uk-issue.json -w '%{http_code}' -b "$ECOOKIE" -H 'content-type: application/json' \
  -d '{"name":"e2e 我的采集流"}' "$BASE/api/api-credentials")
check 201 "$CODE" "editor 自助创建密钥"
KEY=$(jqget 'd["apiKey"]' </tmp/gf-uk-issue.json)
DOCUSER=$(jqget 'd["doc"]["userId"]' </tmp/gf-uk-issue.json)
check "$EID" "$DOCUSER" "密钥归属 editor 本人"

# 3. editor 视角列表只看到自己的；页面渲染自助表单且隐藏 admin 区块
N=$(curl -s -b "$ECOOKIE" "$BASE/api/api-credentials" | jqget 'd["totalDocs"]')
check 1 "$N" "editor 列表仅含自己的密钥"
PAGE=$(curl -s -b "$ECOOKIE" "$BASE/admin/integrations")
echo "$PAGE" | grep -q 新建密钥 && ok "editor 页面显示自助创建表单" || bad "editor 页面缺自助表单"
if echo "$PAGE" | grep -q 管理员代签; then bad "editor 页面泄漏 admin 区块"; else ok "editor 页面隐藏 admin 区块"; fi

# 4. 用 editor 的密钥投稿 webhook（应记归属）
CODE=$(curl -s -o /tmp/gf-uk-post.json -w '%{http_code}' \
  -H "Authorization: users API-Key $KEY" -H 'content-type: application/json' \
  -d "{\"channel\":\"webhook\",\"title\":\"UK-$STAMP 归属链样例\",\"bodyMarkdown\":\"# 标题\n\n正文。\",\"suggestedSiteId\":$SITE}" \
  "$BASE/api/intake-operations")
check 201 "$CODE" "editor 密钥 webhook 直投"
IID=$(jqget 'd["intakeItem"]["id"]' </tmp/gf-uk-post.json)
CREATEDBY=$(jqget 'd["intakeItem"]["createdBy"]' </tmp/gf-uk-post.json)
check "$EID" "$CREATEDBY" "投稿归属记为 editor"

# 4b. 站点校验前移：入口即拒，不再等人工采纳兜底
XSITE=$(PSQL "SELECT id FROM geo_foundry.sites WHERE tenant_id<>$TENANT AND status='active' ORDER BY id LIMIT 1")
CODE=$(curl -s -o /tmp/gf-uk-xsite.json -w '%{http_code}' \
  -H "Authorization: users API-Key $KEY" -H 'content-type: application/json' \
  -d "{\"channel\":\"webhook\",\"title\":\"UK-$STAMP 跨租户站点\",\"bodyMarkdown\":\"# 标题\n\n正文。\",\"suggestedSiteId\":$XSITE}" \
  "$BASE/api/intake-operations")
check 403 "$CODE" "跨租户站点投稿被拒"
check INTAKE_SITE_TENANT_MISMATCH "$(jqget 'd["error"]["code"]' </tmp/gf-uk-xsite.json)" "错误码=SITE_TENANT_MISMATCH"
CODE=$(curl -s -o /tmp/gf-uk-nsite.json -w '%{http_code}' \
  -H "Authorization: users API-Key $KEY" -H 'content-type: application/json' \
  -d "{\"channel\":\"webhook\",\"title\":\"UK-$STAMP 不存在站点\",\"bodyMarkdown\":\"# 标题\n\n正文。\",\"suggestedSiteId\":999999}" \
  "$BASE/api/intake-operations")
check 400 "$CODE" "不存在站点投稿被拒"
check INTAKE_SITE_NOT_FOUND "$(jqget 'd["error"]["code"]' </tmp/gf-uk-nsite.json)" "错误码=SITE_NOT_FOUND"

# 5. 安全负例：密钥权限面与 editor 角色无关（editor 本有 editions 写权限）
CODE=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: users API-Key $KEY" -H 'content-type: application/json' \
  -d '{"title":"越权尝试"}' "$BASE/api/content-editions?draft=true&depth=0")
check 403 "$CODE" "密钥建文章被拒（权限面=投稿）"
CODE=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: users API-Key $KEY" -H 'content-type: application/json' -d '{}' \
  "$BASE/api/intake-operations/$IID/adopt")
check 403 "$CODE" "密钥采纳被拒（机器身份）"

# 6. 人工采纳 → 文章 owner=editor + 来源标注 ai
CODE=$(curl -s -o /tmp/gf-uk-adopt.json -w '%{http_code}' -b "$TACOOKIE" -H 'content-type: application/json' \
  -d '{}' "$BASE/api/intake-operations/$IID/adopt")
check 200 "$CODE" "tenant-admin 采纳"
ROW=$(PSQL "SELECT owner_id||'|'||creation_origin FROM geo_foundry.content_editions WHERE id=(SELECT adopted_edition_id FROM geo_foundry.intake_items WHERE id=$IID)")
check "$EID|ai" "$ROW" "文章 owner=editor 且来源=ai"

# 7. editor 自助吊销后再投稿 → 401
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$ECOOKIE" -X POST \
  "$BASE/api/api-credentials/$(jqget 'd["doc"]["id"]' </tmp/gf-uk-issue.json)/revoke")
check 200 "$CODE" "editor 自助吊销"
CODE=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: users API-Key $KEY" -H 'content-type: application/json' \
  -d "{\"channel\":\"webhook\",\"title\":\"UK-$STAMP 再次\",\"bodyMarkdown\":\"x\",\"suggestedSiteId\":$SITE}" \
  "$BASE/api/intake-operations")
check 401 "$CODE" "吊销后投稿被拒"

# 8. 跨租户负例：editor 密钥投稿指向其它租户站点
XSITE=$(PSQL "SELECT id FROM geo_foundry.sites WHERE tenant_id=414 LIMIT 1")
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$TACOOKIE" -H 'content-type: application/json' \
  -d "{\"name\":\"x\",\"type\":\"url\",\"site\":$XSITE}" "$BASE/api/connectors")
check 403 "$CODE" "回归：跨租户站点仍拒（admin 面）"

# 清理：文章/版本/来源/稿源/密钥/用户
ED=$(PSQL "SELECT adopted_edition_id FROM geo_foundry.intake_items WHERE id=$IID")
PSQL "DELETE FROM geo_foundry.article_sources WHERE edition_id=$ED" >/dev/null
PSQL "DELETE FROM geo_foundry.edition_revisions WHERE parent_id=$ED" >/dev/null
PSQL "DELETE FROM geo_foundry.content_editions WHERE id=$ED" >/dev/null
PSQL "DELETE FROM geo_foundry.intake_items WHERE id=$IID" >/dev/null
PSQL "DELETE FROM geo_foundry.api_credentials WHERE user_id=$EID" >/dev/null
PSQL "DELETE FROM geo_foundry.users WHERE id=$EID" >/dev/null
LEFT=$(PSQL "SELECT count(*) FROM geo_foundry.intake_items WHERE title LIKE 'UK-$STAMP%'")
check 0 "$LEFT" "fixture 清理完成"

echo "-----"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
