#!/usr/bin/env bash
# 批次 4 部署后验证：投稿面 OpenAPI 公开端点 + 契约一致性 + 接入文档页渲染
# 只读验证（登录会话仅用于 Console 页面），无 fixture 写入，无需清理
set -u
BASE=http://127.0.0.1:3090
COOKIE=/tmp/gf-e2e-intdoc-cookie.txt
DOC=/tmp/gf-e2e-integration-openapi.json
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1"; }
check() { # $1=期望 $2=实际 $3=说明
  if [ "$1" = "$2" ]; then ok "$3 ($2)"; else bad "$3 (want $1 got $2)"; fi
}

# 1. 公开访问：无任何认证头
CODE=$(curl -s -o "$DOC" -w '%{http_code}' "$BASE/api/integration/openapi.json")
check 200 "$CODE" "openapi.json 公开可访问（无认证）"

# 2. 版本与文档骨架
check "3.1.0" "$(python3 -c 'import json;print(json.load(open("'"$DOC"'"))["openapi"])')" "openapi 版本"
check "Geo Foundry Integration API" "$(python3 -c 'import json;print(json.load(open("'"$DOC"'"))["info"]["title"])')" "文档标题"
N=$(python3 -c 'import json;print(len(json.load(open("'"$DOC"'"))["paths"]))')
check 5 "$N" "路径数"

# 3. 五个端点与 operationId
for P in "/intake-operations" "/sites" "/connectors" "/delivery/sites/{domain}/articles" "/delivery/articles/{id}"; do
  HAS=$(python3 -c 'import json;print("'"$P"'" in json.load(open("'"$DOC"'"))["paths"])')
  check True "$HAS" "路径 $P"
done
check "createIntakeItem" "$(python3 -c 'import json;d=json.load(open("'"$DOC"'"));print(d["paths"]["/intake-operations"]["post"]["operationId"])')" "投稿 operationId"

# 4. 安全边界：intake/reference 挂 usersApiKey，delivery 公开
for S in '"/intake-operations","post"' '"/sites","get"' '"/connectors","get"'; do
  SEC=$(python3 -c 'import json;d=json.load(open("'"$DOC"'"));p,m='"$S"';print(d["paths"][p][m].get("security"))')
  check "[{'usersApiKey': []}]" "$SEC" "安全方案 $S"
done
for S in '"/delivery/sites/{domain}/articles","get"' '"/delivery/articles/{id}","get"'; do
  SEC=$(python3 -c 'import json;d=json.load(open("'"$DOC"'"));p,m='"$S"';print(d["paths"][p][m].get("security"))')
  check None "$SEC" "delivery 公开 $S"
done

# 5. 缓存头与内容类型
HDR=$(curl -s -o /dev/null -D - "$BASE/api/integration/openapi.json" | tr -d '\r')
echo "$HDR" | grep -qi '^cache-control: public, max-age=300' && ok "缓存头 max-age=300" || bad "缓存头缺失"
echo "$HDR" | grep -qi '^content-type: application/json' && ok "内容类型 JSON" || bad "内容类型错误"

# 6. 与签入 fixture 的语义一致（线上 body 是紧凑 JSON，字节稳定性由本地契约测试守卫）
REPO_DOC=~/project/Binny-GIT/geo-foundry/apps/cms/contracts/integration-openapi.json
if [ -f "$REPO_DOC" ]; then
  SAME=$(python3 -c '
import json
live = json.load(open("'"$DOC"'"))
committed = json.load(open("'"$REPO_DOC"'"))
print(live == committed)')
  check True "$SAME" "线上文档与签入 fixture 语义一致"
else
  bad "服务器仓库找不到 fixture：$REPO_DOC"
fi

# 7. 投稿请求 schema 关键字段与约束
FLD=$(python3 -c 'import json;d=json.load(open("'"$DOC"'"));s=d["paths"]["/intake-operations"]["post"]["requestBody"]["content"]["application/json"]["schema"];print(sorted(s["properties"].keys()))')
check "['bodyMarkdown', 'channel', 'connectorId', 'contentHash', 'sourceUrl', 'suggestedSiteId', 'summary', 'title']" "$FLD" "投稿字段清单"
REQ=$(python3 -c 'import json;d=json.load(open("'"$DOC"'"));s=d["paths"]["/intake-operations"]["post"]["requestBody"]["content"]["application/json"]["schema"];print(sorted(s["required"]))')
check "['channel', 'title']" "$REQ" "必填字段"

# 8. Console 接入文档页渲染（登录后）
curl -s -o /dev/null -c "$COOKIE" -H 'content-type: application/json' \
  -d '{"email":"embed-tenant-admin@geo-foundry.test","password":"gf-ta-003"}' "$BASE/api/users/login"
HTML=$(curl -s -b "$COOKIE" "$BASE/admin/integration-docs")
echo "$HTML" | grep -q 'intake-operations' && ok "文档页含投稿端点" || bad "文档页缺投稿端点"
echo "$HTML" | grep -q 'openapi.json' && ok "文档页含机器可读契约指引" || bad "文档页缺 openapi.json 指引"
echo "$HTML" | grep -q '无发布权限' && ok "文档页含能力边界声明" || bad "文档页缺边界声明"
echo "$HTML" | grep -q 'gfa_' && ok "文档页含密钥前缀说明" || bad "文档页缺密钥说明"

echo "-----"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
