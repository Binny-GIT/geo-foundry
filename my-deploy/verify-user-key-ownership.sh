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
SITE2=$(PSQL "SELECT id FROM geo_foundry.sites WHERE tenant_id=$TENANT AND status='active' ORDER BY id OFFSET 1 LIMIT 1")
[ -n "$SITE" ] && ok "fixture site=$SITE" || { bad "no site in tenant $TENANT"; exit 1; }
[ -n "$SITE2" ] && ok "fixture site2=$SITE2" || { bad "need 2 active sites in tenant $TENANT"; exit 1; }

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
  -d "{\"name\":\"e2e 我的采集流\",\"defaultSiteId\":$SITE}" "$BASE/api/api-credentials")
check 201 "$CODE" "editor 自助创建密钥"
KEY=$(jqget 'd["apiKey"]' </tmp/gf-uk-issue.json)
DOCUSER=$(jqget 'd["doc"]["userId"]' </tmp/gf-uk-issue.json)
check "$EID" "$DOCUSER" "密钥归属 editor 本人"
DOCSITE=$(jqget 'd["doc"]["defaultSiteId"]' </tmp/gf-uk-issue.json)
check "$SITE" "$DOCSITE" "密钥默认站点落库"

# 3. editor 视角列表只看到自己的；页面渲染自助表单且隐藏 admin 区块
N=$(curl -s -b "$ECOOKIE" "$BASE/api/api-credentials" | jqget 'd["totalDocs"]')
check 1 "$N" "editor 列表仅含自己的密钥"
PAGE=$(curl -s -b "$ECOOKIE" "$BASE/admin/integrations")
echo "$PAGE" | grep -q 新建密钥 && ok "editor 页面显示自助创建表单" || bad "editor 页面缺自助表单"
if echo "$PAGE" | grep -q 管理员代签; then bad "editor 页面泄漏 admin 区块"; else ok "editor 页面隐藏 admin 区块"; fi

# 4. 用 editor 的密钥投稿 webhook，不带 siteId —— 应回落到密钥默认站点
CODE=$(curl -s -o /tmp/gf-uk-post.json -w '%{http_code}' \
  -H "Authorization: users API-Key $KEY" -H 'content-type: application/json' \
  -d "{\"channel\":\"webhook\",\"title\":\"UK-$STAMP 归属链样例\",\"bodyMarkdown\":\"# 标题\n\n正文。\"}" \
  "$BASE/api/intake-operations")
check 201 "$CODE" "editor 密钥 webhook 直投（无 siteId）"
IID=$(jqget 'd["intakeItem"]["id"]' </tmp/gf-uk-post.json)
CREATEDBY=$(jqget 'd["intakeItem"]["createdBy"]' </tmp/gf-uk-post.json)
check "$EID" "$CREATEDBY" "投稿归属记为 editor"
SUGG=$(jqget 'd["intakeItem"]["suggestedSite"]' </tmp/gf-uk-post.json)
check "$SITE" "$SUGG" "无显式站点回落密钥默认站点"

# 4c. 显式 siteId 优先于密钥默认站点（正文与 4 不同，避免内容哈希幂等合并）
CODE=$(curl -s -o /tmp/gf-uk-post2.json -w '%{http_code}' \
  -H "Authorization: users API-Key $KEY" -H 'content-type: application/json' \
  -d "{\"channel\":\"webhook\",\"title\":\"UK-$STAMP 显式站点优先\",\"bodyMarkdown\":\"# 标题\n\n正文 B。\",\"suggestedSiteId\":$SITE2}" \
  "$BASE/api/intake-operations")
check 201 "$CODE" "显式站点投稿"
IID2=$(jqget 'd["intakeItem"]["id"]' </tmp/gf-uk-post2.json)
SUGG2=$(jqget 'd["intakeItem"]["suggestedSite"]' </tmp/gf-uk-post2.json)
check "$SITE2" "$SUGG2" "显式站点优先于密钥默认"

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
# 未开自动成稿的密钥：直投只进收件箱
STATUS0=$(jqget 'd["intakeItem"]["status"]' </tmp/gf-uk-post2.json)
check ready "$STATUS0" "未开自动成稿 → 收件箱 ready"

# 4d. 自动成稿密钥：webhook 直投直通工作台草稿
CODE=$(curl -s -o /tmp/gf-uk-issue2.json -w '%{http_code}' -b "$ECOOKIE" -H 'content-type: application/json' \
  -d "{\"name\":\"e2e 直通流\",\"defaultSiteId\":$SITE,\"autoAdopt\":true}" "$BASE/api/api-credentials")
check 201 "$CODE" "签发自动成稿密钥"
KEY2=$(jqget 'd["apiKey"]' </tmp/gf-uk-issue2.json)
check True "$(jqget 'd["doc"]["autoAdopt"]' </tmp/gf-uk-issue2.json)" "密钥 autoAdopt=true"
CODE=$(curl -s -o /tmp/gf-uk-auto.json -w '%{http_code}' \
  -H "Authorization: users API-Key $KEY2" -H 'content-type: application/json' \
  -d "{\"channel\":\"webhook\",\"title\":\"UK-$STAMP 自动成稿样例\",\"bodyMarkdown\":\"# 标题\n\n直通正文。\"}" \
  "$BASE/api/intake-operations")
check 201 "$CODE" "自动成稿密钥 webhook 直投"
check True "$(jqget 'd["autoAdopted"]' </tmp/gf-uk-auto.json)" "autoAdopted=true"
ED2=$(jqget 'd["editionId"]' </tmp/gf-uk-auto.json)
[ -n "$ED2" ] && [ "$ED2" != "None" ] && ok "直通文章 editionId=$ED2" || bad "缺 editionId"
IID3=$(jqget 'd["intakeItem"]["id"]' </tmp/gf-uk-auto.json)
ROW=$(PSQL "SELECT owner_id||'|'||creation_origin||'|'||workflow_status FROM geo_foundry.content_editions WHERE id=$ED2")
check "$EID|ai|draft" "$ROW" "直通文章 owner/来源/工作流"
SRCCNT=$(PSQL "SELECT count(*) FROM geo_foundry.article_sources WHERE edition_id=$ED2 AND intake_item_id=$IID3 AND role='primary'")
check 1 "$SRCCNT" "来源关联 primary 回指"
ASTATUS=$(jqget 'd["intakeItem"]["status"]' </tmp/gf-uk-auto.json)
check adopted "$ASTATUS" "稿源条目 status=adopted"
# 幂等重放：同正文重投不产生第二篇文章
CODE=$(curl -s -o /tmp/gf-uk-replay.json -w '%{http_code}' \
  -H "Authorization: users API-Key $KEY2" -H 'content-type: application/json' \
  -d "{\"channel\":\"webhook\",\"title\":\"UK-$STAMP 自动成稿样例\",\"bodyMarkdown\":\"# 标题\n\n直通正文。\"}" \
  "$BASE/api/intake-operations")
check 200 "$CODE" "同正文重放 200"
check True "$(jqget 'd["idempotentReplay"]' </tmp/gf-uk-replay.json)" "idempotentReplay=true"
check "$ED2" "$(jqget 'd["editionId"]' </tmp/gf-uk-replay.json)" "重放返回同一 editionId"
EDCNT=$(PSQL "SELECT count(*) FROM geo_foundry.content_editions WHERE title='UK-$STAMP 自动成稿样例'")
check 1 "$EDCNT" "重放不产生第二篇文章"
# 自动成稿密钥调 adopt 端点仍然 403（权限面不因开关扩大）
CODE=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: users API-Key $KEY2" -H 'content-type: application/json' -d '{}' \
  "$BASE/api/intake-operations/$IID3/adopt")
check 403 "$CODE" "自动成稿密钥 adopt 仍被拒"
# url 通道不受开关影响：仍走抓取队列，不直通
CODE=$(curl -s -o /tmp/gf-uk-url.json -w '%{http_code}' \
  -H "Authorization: users API-Key $KEY2" -H 'content-type: application/json' \
  -d "{\"channel\":\"url\",\"title\":\"UK-$STAMP url 通道\",\"sourceUrl\":\"https://example.com/uk-$STAMP\"}" \
  "$BASE/api/intake-operations")
case "$CODE" in 201|202) ok "url 通道投稿 ($CODE)";; *) bad "url 通道投稿 (want 201/202 got $CODE)";; esac
check False "$(jqget 'd["autoAdopted"]' </tmp/gf-uk-url.json)" "url 通道不直通"
IID4=$(jqget 'd["intakeItem"]["id"]' </tmp/gf-uk-url.json)

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
PSQL "DELETE FROM geo_foundry.article_sources WHERE edition_id IN ($ED,$ED2)" >/dev/null
PSQL "DELETE FROM geo_foundry.edition_revisions WHERE parent_id IN ($ED,$ED2)" >/dev/null
PSQL "DELETE FROM geo_foundry.content_editions WHERE id IN ($ED,$ED2)" >/dev/null
PSQL "DELETE FROM geo_foundry.intake_items WHERE id IN ($IID,$IID2,$IID3,$IID4)" >/dev/null
PSQL "DELETE FROM geo_foundry.api_credentials WHERE user_id=$EID" >/dev/null
PSQL "DELETE FROM geo_foundry.users WHERE id=$EID" >/dev/null
LEFT=$(PSQL "SELECT count(*) FROM geo_foundry.intake_items WHERE title LIKE 'UK-$STAMP%'")
check 0 "$LEFT" "fixture 清理完成"

echo "-----"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
