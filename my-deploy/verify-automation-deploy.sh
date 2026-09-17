#!/usr/bin/env bash
# 批次1+2 部署后功能验证：automation 身份 + 集成密钥 + webhook 直投 + 安全负例
# fixture 全部自建自删，不依赖手工账号数据（登录用 embed-tenant-admin，只读会话）
set -u
BASE=http://127.0.0.1:3090
COOKIE=/tmp/gf-e2e-auto-cookie.txt
EMAIL="e2e-automation-$(date +%s)@geo-foundry.test"
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1"; }
check() { # $1=期望状态码 $2=实际 $3=说明
  if [ "$1" = "$2" ]; then ok "$3 ($2)"; else bad "$3 (want $1 got $2)"; fi
}
PSQL() { sudo docker exec pg-server psql -U gpucloud -d geo_foundry -At -c "$1"; }

TENANT=413
SITE=$(PSQL "SELECT id FROM geo_foundry.sites WHERE tenant_id=$TENANT AND status='active' ORDER BY id LIMIT 1")
[ -n "$SITE" ] && ok "fixture site=$SITE" || { bad "no site in tenant $TENANT"; exit 1; }

# 1. tenant-admin 登录
CODE=$(curl -s -o /tmp/gf-e2e-login.json -w '%{http_code}' -c "$COOKIE" \
  -H 'content-type: application/json' \
  -d '{"email":"embed-tenant-admin@geo-foundry.test","password":"gf-ta-003"}' \
  "$BASE/api/users/login")
check 200 "$CODE" "tenant-admin 登录"

# 2. 建 automation 用户
CODE=$(curl -s -o /tmp/gf-e2e-user.json -w '%{http_code}' -b "$COOKIE" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"gf-auto-e2e-001\",\"role\":\"automation\",\"tenant\":$TENANT}" \
  "$BASE/api/users")
check 201 "$CODE" "创建 automation 用户"
USER_ID=$(PSQL "SELECT id FROM geo_foundry.users WHERE email='$EMAIL'")
[ -n "$USER_ID" ] && ok "automation 用户 id=$USER_ID" || bad "用户未落库"

# 3. 签发集成密钥
CODE=$(curl -s -o /tmp/gf-e2e-key.json -w '%{http_code}' -b "$COOKIE" \
  -H 'content-type: application/json' \
  -d "{\"name\":\"e2e-自动投稿\",\"userId\":$USER_ID}" \
  "$BASE/api/api-credentials")
check 201 "$CODE" "签发集成密钥"
API_KEY=$(sed -n 's/.*"apiKey":"\([^"]*\)".*/\1/p' /tmp/gf-e2e-key.json)
case "$API_KEY" in
  gfa_*) ok "密钥格式 gfa_ 前缀 (${API_KEY:0:12}…)" ;;
  *) bad "密钥格式异常: $API_KEY" ;;
esac
CRED_ID=$(PSQL "SELECT id FROM geo_foundry.api_credentials WHERE user_id=$USER_ID ORDER BY id DESC LIMIT 1")
PLAIN_IN_DB=$(PSQL "SELECT count(*) FROM geo_foundry.api_credentials WHERE key_index LIKE '%${API_KEY#gfa_}%' OR key_prefix='${API_KEY}'")
[ "$PLAIN_IN_DB" = "0" ] && ok "明文未落库" || bad "明文疑似落库"

AUTH="Authorization: users API-Key $API_KEY"
IDEM="Idempotency-Key: e2e-auto-$(date +%s)"
BODY=$(printf '{"channel":"webhook","title":"E2E 自动化投稿 %s","bodyMarkdown":"# 标题\\n\\n直投正文。","suggestedSiteId":%s,"summary":"e2e 自动化"}' "$(date +%s)" "$SITE")

# 4. webhook 直投
CODE=$(curl -s -o /tmp/gf-e2e-post1.json -w '%{http_code}' -H "$AUTH" -H "$IDEM" \
  -H 'content-type: application/json' -d "$BODY" "$BASE/api/intake-operations")
check 201 "$CODE" "webhook 直投投稿"
STATUS=$(sed -n 's/.*"status":"\([a-z]*\)".*/\1/p' /tmp/gf-e2e-post1.json | head -1)
[ "$STATUS" = "ready" ] && ok "直投状态 ready" || bad "直投状态=$STATUS"
ITEM_TITLE=$(printf '%s' "$BODY" | sed -n 's/.*"title":"\([^"]*\)".*/\1/p')
ITEM_ID=$(PSQL "SELECT id FROM geo_foundry.intake_items WHERE title='$ITEM_TITLE' LIMIT 1")
[ -n "$ITEM_ID" ] && ok "稿源条目 id=$ITEM_ID" || bad "条目未落库"
BLOCKS=$(PSQL "SELECT jsonb_array_length(content_blocks) FROM geo_foundry.intake_items WHERE id=$ITEM_ID")
[ "$BLOCKS" -gt 0 ] 2>/dev/null && ok "contentBlocks 已转换($BLOCKS 块)" || bad "contentBlocks 空"

# 5. 幂等重放：同 key 同文重发，不产生新行
CODE=$(curl -s -o /tmp/gf-e2e-post2.json -w '%{http_code}' -H "$AUTH" -H "$IDEM" \
  -H 'content-type: application/json' -d "$BODY" "$BASE/api/intake-operations")
check 200 "$CODE" "幂等重放返回 200"
REPLAY=$(sed -n 's/.*"idempotentReplay":\([a-z]*\).*/\1/p' /tmp/gf-e2e-post2.json)
[ "$REPLAY" = "true" ] && ok "idempotentReplay=true" || bad "idempotentReplay=$REPLAY"
ROWS=$(PSQL "SELECT count(*) FROM geo_foundry.intake_items WHERE title='$ITEM_TITLE'")
[ "$ROWS" = "1" ] && ok "重放后仍只有 1 行" || bad "重放产生 $ROWS 行"

# 6. 安全负例：机器身份不得成稿/建文章/流转/发布/读工作台/打内部面
#    流转与发布用租户内真实文章 id 验证（请求在写入前被拒，不改数据）
REAL_EID=$(PSQL "SELECT id FROM geo_foundry.content_editions WHERE tenant_id=$TENANT ORDER BY id LIMIT 1")
[ -n "$REAL_EID" ] && ok "对照文章 id=$REAL_EID" || bad "租户 $TENANT 无文章"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" -H 'content-type: application/json' \
  -d '{}' "$BASE/api/intake-operations/$ITEM_ID/adopt")
check 403 "$CODE" "adopt 被拒"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"site\":$SITE,\"title\":\"不应成功\"}" "$BASE/api/content-editions?draft=true&depth=0")
check 403 "$CODE" "创建文章被拒"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" -H 'content-type: application/json' \
  -d '{"target":"review"}' "$BASE/api/editions/$REAL_EID/workflow-transitions")
check 403 "$CODE" "工作流流转被拒"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" -H 'content-type: application/json' \
  -d '{}' "$BASE/api/editions/$REAL_EID/publish-operations")
check 403 "$CODE" "发布操作被拒"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" \
  "$BASE/api/workspaces/editions/$REAL_EID/context")
check 403 "$CODE" "工作台上下文被拒"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"hi"}]}' "$BASE/api/editions/ai-chat")
check 403 "$CODE" "AI 对话被拒"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" -H 'x-request-id: e2e-internal-probe' \
  "$BASE/api/internal/operations/e2e-probe-0001")
case "$CODE" in 401|403) ok "internal 面被拒 ($CODE)";; *) bad "internal 面放行 ($CODE)";; esac

# 7. webhook 缺站点 → 400
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" -H 'content-type: application/json' \
  -d '{"channel":"webhook","title":"缺站点的投稿'"$RANDOM"'"}' "$BASE/api/intake-operations")
check 400 "$CODE" "webhook 缺 suggestedSiteId 被拒"

# 8. 人工接力：tenant-admin 采纳该条目成草稿
CODE=$(curl -s -o /tmp/gf-e2e-adopt.json -w '%{http_code}' -b "$COOKIE" \
  -H 'content-type: application/json' -d '{}' "$BASE/api/intake-operations/$ITEM_ID/adopt")
check 200 "$CODE" "人工 adopt 成功"
EDITION_ID=$(sed -n 's/.*"editionId":\([0-9]*\).*/\1/p' /tmp/gf-e2e-adopt.json)
if [ -n "$EDITION_ID" ]; then
  ok "采纳产出文章 id=$EDITION_ID"
  WS=$(PSQL "SELECT workflow_status FROM geo_foundry.content_editions WHERE id=$EDITION_ID")
  [ "$WS" = "draft" ] && ok "文章状态 draft" || bad "文章状态=$WS"
  MD=$(PSQL "SELECT length(body_markdown) FROM geo_foundry.content_editions WHERE id=$EDITION_ID")
  [ "$MD" -gt 0 ] 2>/dev/null && ok "文章正文来自直投内容($MD 字符)" || bad "文章正文空"
  SRC=$(PSQL "SELECT count(*) FROM geo_foundry.article_sources WHERE edition_id=$EDITION_ID AND role='primary'")
  [ "$SRC" = "1" ] && ok "article_sources 已关联" || bad "article_sources 缺失"
else
  bad "未取到 editionId"
fi

# 9. 吊销密钥 → 下一次请求 401
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -H 'content-type: application/json' \
  -X POST "$BASE/api/api-credentials/$CRED_ID/revoke")
check 200 "$CODE" "吊销密钥"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" -H 'content-type: application/json' \
  -d "$BODY" "$BASE/api/intake-operations")
check 401 "$CODE" "吊销后请求被拒"

# 清理（不动 Mark 的业务数据，只删本次自建 fixture）
if [ -n "$EDITION_ID" ]; then
  PSQL "DELETE FROM geo_foundry.article_sources WHERE edition_id=$EDITION_ID" >/dev/null
  PSQL "DELETE FROM geo_foundry.edition_revisions WHERE parent_id=$EDITION_ID" >/dev/null
  PSQL "DELETE FROM geo_foundry.content_editions WHERE id=$EDITION_ID" >/dev/null
fi
PSQL "DELETE FROM geo_foundry.intake_items WHERE title='$ITEM_TITLE'" >/dev/null
PSQL "DELETE FROM geo_foundry.api_credentials WHERE user_id=$USER_ID" >/dev/null
PSQL "DELETE FROM geo_foundry.users WHERE id=$USER_ID AND email='$EMAIL'" >/dev/null
LEFT=$(PSQL "SELECT count(*) FROM geo_foundry.intake_items WHERE title='$ITEM_TITLE'")
[ "$LEFT" = "0" ] && ok "fixture 清理完成" || bad "清理残留 $LEFT 行"

echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
