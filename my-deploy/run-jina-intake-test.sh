#!/usr/bin/env bash
# Jina 采集 + AI 整理 → 投稿全链路实测（产物保留供 Console 检查，不自删）
set -u
BASE=http://127.0.0.1:3090
COOKIE=/tmp/gf-jina-cookie.txt
MD=/tmp/jina-gis-clean.md
PSQL() { sudo docker exec pg-server psql -U gpucloud -d geo_foundry -At -c "$1"; }
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1"; }
check() { if [ "$1" = "$2" ]; then ok "$3 ($2)"; else bad "$3 (want $1 got $2)"; fi; }
jget() { python3 -c "import json,sys;d=json.load(sys.stdin);print($1)"; }

# 0. tenant-admin 登录（自助创建密钥 + 后续采纳）
CODE=$(curl -s -o /dev/null -w '%{http_code}' -c "$COOKIE" -H 'content-type: application/json' \
  -d '{"email":"embed-tenant-admin@geo-foundry.test","password":"gf-ta-003"}' "$BASE/api/users/login")
check 200 "$CODE" "tenant-admin 登录"
ADMIN_ID=$(PSQL "SELECT id FROM geo_foundry.users WHERE email='embed-tenant-admin@geo-foundry.test'")

# 1. 自助创建「Jina 采集测试」密钥（不带 userId = 给自己）
CODE=$(curl -s -o /tmp/gf-jina-key.json -w '%{http_code}' -b "$COOKIE" -H 'content-type: application/json' \
  -d '{"name":"Jina 采集测试"}' "$BASE/api/api-credentials")
check 201 "$CODE" "自助创建密钥"
KEY=$(jget 'd["apiKey"]' </tmp/gf-jina-key.json)
KEY_ID=$(jget 'd["doc"]["id"]' </tmp/gf-jina-key.json)
DOCUSER=$(jget 'd["doc"]["userId"]' </tmp/gf-jina-key.json)
check "$ADMIN_ID" "$DOCUSER" "密钥归属创建者本人"
echo "key id=$KEY_ID prefix=${KEY:0:12}…"

# 2. 取本租户 active 站点
SITE=$(curl -s -H "Authorization: users API-Key $KEY" "$BASE/api/sites?limit=100" | \
  python3 -c 'import json,sys;d=json.load(sys.stdin);print(next(x["id"] for x in d["docs"] if x["status"]=="active"))')
[ -n "$SITE" ] && ok "目标站点=$SITE（用密钥读 sites 成功）" || bad "未取到站点"

# 3. webhook 直投整理稿
python3 - "$MD" "$SITE" > /tmp/gf-jina-payload.json <<'PYEOF'
import json, sys
md = open(sys[1] if False else sys.argv[1], encoding="utf-8").read()
payload = {
    "channel": "webhook",
    "title": "【采集测试】地理信息系统：从伦敦霍乱地图到空间智能",
    "summary": "由 Jina Reader 采集维基百科「地理信息系统」条目、AI 整理排版后经 webhook 直投的测试稿。涵盖 GIS 定义、五个组成部分、发展简史（伦敦霍乱地图到 CGIS）、栅格与矢量数据模型、数据采集、空间分析与开放标准。",
    "bodyMarkdown": md,
    "suggestedSiteId": int(sys.argv[2]),
    "sourceUrl": "https://zh.wikipedia.org/wiki/地理信息系统",
}
json.dump(payload, open(sys.argv[0] if False else "/tmp/gf-jina-payload.json", "w", encoding="utf-8"), ensure_ascii=False)
PYEOF
CODE=$(curl -s -o /tmp/gf-jina-post.json -w '%{http_code}' \
  -H "Authorization: users API-Key $KEY" -H 'content-type: application/json' \
  -H "Idempotency-Key: jina-gis-260918-001" \
  --data-binary @/tmp/gf-jina-payload.json "$BASE/api/intake-operations")
check 201 "$CODE" "webhook 直投"
IID=$(jget 'd["intakeItem"]["id"]' </tmp/gf-jina-post.json)
STATUS=$(jget 'd["intakeItem"]["status"]' </tmp/gf-jina-post.json)
CREATED=$(jget 'd["intakeItem"]["createdBy"]' </tmp/gf-jina-post.json)
check ready "$STATUS" "入箱即 ready"
check "$ADMIN_ID" "$CREATED" "投稿归属密钥创建者"

# 4. 幂等重放（同 Idempotency-Key）
CODE=$(curl -s -o /tmp/gf-jina-replay.json -w '%{http_code}' \
  -H "Authorization: users API-Key $KEY" -H 'content-type: application/json' \
  -H "Idempotency-Key: jina-gis-260918-001" \
  --data-binary @/tmp/gf-jina-payload.json "$BASE/api/intake-operations")
REPLAY=$(jget 'd["idempotentReplay"]' </tmp/gf-jina-replay.json)
RIID=$(jget 'd["intakeItem"]["id"]' </tmp/gf-jina-replay.json)
check 200 "$CODE" "幂等重放返回 200"
check True "$REPLAY" "重放标记 idempotentReplay"
check "$IID" "$RIID" "重放返回同一条目"

# 5. 人工采纳成文章
CODE=$(curl -s -o /tmp/gf-jina-adopt.json -w '%{http_code}' -b "$COOKIE" -H 'content-type: application/json' \
  -d '{}' "$BASE/api/intake-operations/$IID/adopt")
check 200 "$CODE" "人工采纳"
ED=$(jget 'd["editionId"]' </tmp/gf-jina-adopt.json)
ROW=$(PSQL "SELECT owner_id||'|'||creation_origin||'|'||workflow_status FROM geo_foundry.content_editions WHERE id=$ED")
check "$ADMIN_ID|ai|draft" "$ROW" "文章 owner=创建者 来源=ai 状态=draft"
SRC=$(PSQL "SELECT count(*) FROM geo_foundry.article_sources WHERE edition_id=$ED AND role='primary'")
check 1 "$SRC" "article_sources 建立溯源"

echo "-----"
echo "intake_item=$IID edition=$ED key=$KEY_ID（保留：Console 可查看/删除/吊销）"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
