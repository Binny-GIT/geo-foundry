#!/usr/bin/env bash
# 清理 site 375 上 2026-09-09/09-18 模拟 worker 发布遗留的 published 夹具：
# 它们没有真实质量评估记录，真实编译器（assertEditionCompilable）会对
# 快照内每篇文章断言 assessmentState=passed，导致任何真实发布失败。
# 走正式 workflow-transitions 端点归档（free-flow 矩阵允许 published→archived）。
set -uo pipefail
BASE=http://127.0.0.1:3090
RTPW="${GF_E2E_ROOT_PASSWORD:?}"
PASS=(); FAIL=()
ok() { PASS+=("$1"); echo "PASS: $1"; }
bad() { FAIL+=("$1"); echo "FAIL: $1"; }

curl -s -X POST "$BASE/api/users/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"gf-root-test@geo-foundry.dev\",\"password\":\"$RTPW\"}" -c /tmp/clean-r.jar -o /dev/null

for ED in 600 602 604 606 615 619 643; do
  CODE=$(curl -s -o /tmp/clean-last.json -w '%{http_code}' \
    -X POST "$BASE/api/editions/$ED/workflow-transitions" -b /tmp/clean-r.jar \
    -H 'Content-Type: application/json' \
    -d '{"target":"archived","reason":"批次0a：清理模拟发布遗留夹具（无真实评估，阻塞真实编译）"}')
  if [ "$CODE" = "200" ]; then ok "edition $ED archived"; else bad "edition $ED code=$CODE $(cat /tmp/clean-last.json)"; fi
done

rm -f /tmp/clean-r.jar /tmp/clean-last.json
echo "==== RESULT: ${#PASS[@]} passed, ${#FAIL[@]} failed ===="
[ ${#FAIL[@]} -gt 0 ] && exit 1
exit 0
