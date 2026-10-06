#!/usr/bin/env bash
# mk-dev 宿主运行：source /tmp/gf-e2e.env; bash my-deploy/e2e-a4-concurrency-drill.sh
# 只操作租户 413 的本次夹具。五场景各三轮；每轮新站、新文章、FIFO 同时放行。
# 初始审批评估沿用 A4 的 API passed 回填；追加评估、发布、回滚使用真实 worker。
# I7 明确跳过：现有 my-deploy/*.sh 未展示全局 routing manifest 的读取方法。
# allow: SIZE_OK — 用户要求单文件、可独立搬到服务器的完整演练；不拆外部依赖助手。
set +x
set -uo pipefail
umask 077
BASE=http://127.0.0.1:3090
TENANT=413
R=3
TS="$(date +%Y%m%d%H%M%S)-$$"
PASS=(); FAIL=(); ARTICLES=(); SITES=(); NAMES=(); CHILDREN=(); CODES=()
TMP=''; RECEIVER_PID=''; SECRET_FILE=''; SKEY=''; POLL_END=0; GATE_OPEN=0
ok() { PASS+=("$1"); echo "PASS: $1"; }
bad() { FAIL+=("$1"); echo "FAIL: $1"; }
fatal() { bad "$1"; exit 1; }
check() { local LABEL="$1"; shift; "$@" && ok "$LABEL" || bad "$LABEL"; }
PSQL() {
  local LIMIT=10 REM
  if (( POLL_END > 0 )); then
    REM=$((POLL_END - SECONDS)); (( REM > 0 )) || return 1
    (( REM >= LIMIT )) || LIMIT=$REM
  fi
  timeout "$LIMIT" sudo -n docker exec -e PGOPTIONS='-c statement_timeout=5000' pg-server \
    psql -U gpucloud -d geo_foundry -v ON_ERROR_STOP=1 -qAt -c "$1"
}
Q() { PSQL "SELECT $1"; }
poll() { # 全体操作共享一个硬截止时间，不逐条各等 180 秒。
  local END=$((SECONDS + $1)) REM; shift
  POLL_END=$END
  while (( SECONDS < END )); do
    if "$@" && (( SECONDS <= END )); then POLL_END=0; return 0; fi
    REM=$((END - SECONDS)); (( REM > 0 )) || break
    sleep "$((REM < 2 ? REM : 2))"
  done
  POLL_END=0; return 1
}
# HTTP 传输参数是 curl 的原生参数，不包装领域对象；正文/状态分文件，禁止打印响应秘密。
fetch() { # 文件 URL [curl 参数] -> HTTP 状态码
  local OUT="$1" URL="$2" CODE; shift 2
  CODE=$(curl -q -s --connect-timeout 3 --max-time 30 -o "$OUT" -w '%{http_code}' "$URL" "$@") \
    || { printf '000'; return 1; }
  printf '%s' "$CODE"
}
cms() { # 方法 路径 JSON；COOKIE 由调用方选择角色。
  HTTP_CODE=$(fetch "$TMP/response.json" "$BASE$2" -X "$1" -b "$COOKIE" \
    -H 'Content-Type: application/json' -d "$3") || HTTP_CODE=000
}
field() { jq -er "$2" "$1"; }
idle_sites() {
  [ "$(Q "count(*) FROM geo_foundry.operations WHERE site_id IN ($SITE_IDS)
    AND state NOT IN ('succeeded','failed','cancelled')")" = 0 ]
}
archive_article() {
  local ID="$1" STATE
  [ "$(Q "count(*) FROM geo_foundry.edition_revisions WHERE parent_id=$ID AND latest
    AND tenant_id=$TENANT AND title LIKE 'E2E A4 Drill $TS %'")" = 1 ] || return 1
  STATE=$(Q "workflow_status FROM geo_foundry.edition_revisions WHERE parent_id=$ID AND latest") || return 1
  COOKIE="$TMP/editor.jar"
  case "$STATE" in
    archived) return 0;;
    published)
      cms POST "/api/editions/$ID/draft-from-published" '{"reason":"E2E A4 Drill 清理"}'
      [ "$HTTP_CODE" = 200 ] && [ "$(field "$TMP/response.json" .workflowStatus)" = draft ] || return 1;;
  esac
  cms POST "/api/editions/$ID/workflow-transitions" '{"target":"archived","reason":"E2E A4 Drill 清理"}'
  [ "$HTTP_CODE" = 200 ] && [ "$(field "$TMP/response.json" .workflowStatus)" = archived ]
}
purge_fixture_site() { # 原 A4 的 id+name 双校验及外键清理顺序；整个删除事务化。
  local S="$1" N="$2" TABLE
  [ "$(Q "count(*) FROM geo_foundry.sites WHERE id=$S AND name='$N' AND tenant_id=$TENANT AND status='disabled'")" = 1 ] || return 1
  local SQL='BEGIN;'
  for TABLE in quality_assessments embeddings site_event_deliveries url_records edition_sites rollback_intents operations releases domains; do
    SQL+=" DELETE FROM geo_foundry.$TABLE WHERE site_id=$S;"
  done
  SQL+=" DELETE FROM geo_foundry.sites WHERE id=$S AND name='$N' AND tenant_id=$TENANT; COMMIT;"
  PSQL "$SQL" >/dev/null
}
routing_ready() {
  [ "$(Q "count(*) FROM pgboss.job WHERE (data->>'siteId')::text IN ($SITE_TEXT_IDS)
    AND data->>'kind'='routing-sync' AND created_on >= '$SYNC_SINCE'::timestamptz")" = "${#SITES[@]}" ] &&
  [ "$(Q "count(*) FROM pgboss.job WHERE (data->>'siteId')::text IN ($SITE_TEXT_IDS)
    AND data->>'kind'='routing-sync' AND created_on >= '$SYNC_SINCE'::timestamptz AND state<>'completed'")" = 0 ]
}
finish() {
  local RC=$? PID ID I SAFE=1
  trap - EXIT INT TERM
  (( GATE_OPEN == 0 )) || printf 'xx' >&9
  # 请求最长 30s，先回收请求进程，再等 worker；仍在执行时保留现场，禁止删它的 FK。
  for PID in "${CHILDREN[@]}"; do wait "$PID" 2>/dev/null || true; done
  if (( ${#SITES[@]} > 0 )); then
    SITE_IDS=$(IFS=,; printf '%s' "${SITES[*]}")
    SITE_TEXT_IDS=$(printf "'%s'," "${SITES[@]}"); SITE_TEXT_IDS=${SITE_TEXT_IDS%,}
    poll 180 idle_sites || { bad '清理：仍有非终态操作，保留夹具供人工恢复'; SAFE=0; }
    if (( SAFE )); then
      for ID in "${ARTICLES[@]}"; do
        archive_article "$ID" || { bad "清理：文章 $ID 归档失败，保留夹具"; SAFE=0; }
      done
    fi
    if (( SAFE )); then
      # 所有站先变 disabled，最后一个 routing-sync 必定看不到任何本次夹具 host。
      # 不能 active→disabled→active：恢复 active 会再次把 fixture host 写回路由。
      SYNC_SINCE=$(Q 'clock_timestamp()') || SAFE=0
      COOKIE="$TMP/admin.jar"
      for ID in "${SITES[@]}"; do
        cms PATCH "/api/sites/$ID" '{"status":"disabled"}'
        [ "$HTTP_CODE" = 200 ] || { bad "清理：站 $ID API 禁用失败"; SAFE=0; }
      done
      if (( SAFE )); then
        poll 180 routing_ready && ok '清理：API routing-sync 全部完成，夹具 host 已排除' \
          || { bad '清理：routing-sync 未全部完成，保留 disabled 夹具'; SAFE=0; }
      fi
    fi
    if (( SAFE )); then
      local IDS
      IDS=$(IFS=,; printf '%s' "${ARTICLES[*]}")
      [ -z "$IDS" ] || PSQL "UPDATE geo_foundry.edition_revisions SET site_id=NULL WHERE parent_id IN ($IDS)" >/dev/null || SAFE=0
      if (( SAFE )); then
        for I in "${!SITES[@]}"; do
          purge_fixture_site "${SITES[$I]}" "${NAMES[$I]}" && ok "清理：站 ${SITES[$I]} 删除" \
            || { bad "清理：站 ${SITES[$I]} 删除失败"; SAFE=0; }
        done
      fi
    fi
    (( SAFE )) || { bad '清理未完成：请按运行 TS 精确恢复残留夹具'; RC=1; }
  fi
  [ -z "$RECEIVER_PID" ] || { kill "$RECEIVER_PID" 2>/dev/null || true; wait "$RECEIVER_PID" 2>/dev/null || true; }
  [ -z "$SECRET_FILE" ] || sudo -n rm -f -- "$SECRET_FILE" || bad '清理：webhook 密钥文件删除失败'
  [ -z "$TMP" ] || rm -rf -- "$TMP"
  (( RC == 0 )) || bad "脚本退出状态 $RC"
  if (( ${#CODES[@]} > 0 )); then printf 'OBSERVED_BUSINESS_CODE: %s\n' "${CODES[@]}"; fi
  (( ${#FAIL[@]} == 0 )) || printf 'FAILED: %s\n' "${FAIL[@]}"
  echo "==== RESULT: ${#PASS[@]} passed, ${#FAIL[@]} failed ===="
  (( RC == 0 && ${#FAIL[@]} == 0 )) && exit 0
  exit 1
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ---------- 前提与一次性 webhook 接收端（沿用 A4 宿主网关 + 文件密钥） ----------
for TOOL in curl jq python3 sudo docker timeout flock mktemp mkfifo sha256sum; do
  command -v "$TOOL" >/dev/null || fatal "缺少工具 $TOOL"
done
for ENV in GF_E2E_EDITOR_PASSWORD GF_E2E_ROOT_PASSWORD GF_E2E_PUBLISHER_PASSWORD GF_E2E_TENANT_ADMIN_PASSWORD; do
  [ -n "${!ENV:-}" ] || fatal "未设置 $ENV（先 source /tmp/gf-e2e.env）"
done
exec 8>/tmp/gf-e2e-a4-concurrency-drill.lock
flock -n 8 || fatal '已有同类并发演练运行中'
TMP=$(mktemp -d /tmp/gf-e2e-a4-drill.XXXXXX) || fatal '临时目录创建失败'
echo "INFO: run=$TS；S1-S5 各 $R 轮；I7 SKIP（无现有脚本读取范例）"
check '真实 Delivery /healthz HTTP200' test "$(fetch "$TMP/delivery-health.json" 'http://127.0.0.1:3091/healthz')" = 200
(( ${#FAIL[@]} == 0 )) || exit 1
login() { # 邮箱 环境变量名 cookie 角色由后续身份响应校验。
  local CODE
  CODE=$(jq -n --arg email "$1" --arg password "${!2}" '{email:$email,password:$password}' | \
    fetch "$TMP/login.json" "$BASE/api/users/login" -X POST -c "$TMP/$3.jar" \
      -H 'Content-Type: application/json' -d @-) || return 1
  [ "$CODE" = 200 ] && [ "$(field "$TMP/login.json" .user.role)" = "$3" ]
}
login gf-editor-test@geo-foundry.dev GF_E2E_EDITOR_PASSWORD editor || fatal 'editor 登录失败'
# root 的角色是 super-admin，独立使用原 A4 reviewer 登录。
CODE=$(jq -n --arg password "$GF_E2E_ROOT_PASSWORD" '{email:"gf-root-test@geo-foundry.dev",password:$password}' | \
  fetch "$TMP/login.json" "$BASE/api/users/login" -X POST -c "$TMP/root.jar" -H 'Content-Type: application/json' -d @-) || CODE=000
[ "$CODE" = 200 ] && [ "$(field "$TMP/login.json" .user.role)" = super-admin ] || fatal 'reviewer 登录失败'
login e2e-scheduled-publisher@geo-foundry.test GF_E2E_PUBLISHER_PASSWORD publisher || fatal 'publisher 登录失败'
CODE=$(jq -n --arg password "$GF_E2E_TENANT_ADMIN_PASSWORD" '{email:"embed-tenant-admin@geo-foundry.test",password:$password}' | \
  fetch "$TMP/login.json" "$BASE/api/users/login" -X POST -c "$TMP/admin.jar" -H 'Content-Type: application/json' -d @-) || CODE=000
[ "$CODE" = 200 ] && [ "$(field "$TMP/login.json" .user.role)" = tenant-admin ] || fatal 'tenant-admin 登录失败'
rm -f "$TMP/login.json"
SKEY=$(sudo -n jq -er '.tenants["413"] | select(type=="string" and length>0)' /opt/geo-foundry/credentials/content-service-keyring.json) || fatal '读取 content-service key 失败'
GW=$(sudo -n docker inspect -f '{{range .NetworkSettings.Networks}}{{.Gateway}} {{end}}' geo-foundry-worker-mk-dev) || fatal 'worker 网关查询失败'
read -r GW _ <<< "$GW"; [ -n "$GW" ] || fatal 'worker 网关为空'
CONFIG=$(sudo -n timeout 10 cat /opt/geo-foundry/mk-dev.env) || fatal 'mk-dev.env 不可读'
env_value() { local LINE; while IFS= read -r LINE; do case "$LINE" in "$1="*) printf '%s' "${LINE#*=}"; return;; esac; done <<< "$CONFIG"; }
CRED_DIR=$(env_value GEO_FOUNDRY_CREDENTIALS_DIR)
PREFIX=$(env_value GEO_FOUNDRY_S3_KEY_PREFIX); PREFIX=${PREFIX:-objects}
BUCKET=$(env_value GEO_FOUNDRY_S3_BUCKET); BUCKET=${BUCKET:-geo-foundry}
[ -n "$CRED_DIR" ] || fatal '凭据目录未配置'
command -v aws >/dev/null || [ -r /tmp/rp-s3get.py ] || fatal '需要 aws 或原 E2E 的 /tmp/rp-s3get.py'
s3_get() {
  if command -v aws >/dev/null; then
    timeout 20 aws s3api get-object --endpoint-url http://127.0.0.1:9000 --bucket "$BUCKET" --key "$1" "$2" >/dev/null 2>&1
  else
    timeout 20 sudo -n python3 /tmp/rp-s3get.py "$CRED_DIR/s3-access-key" "$CRED_DIR/s3-secret-key" "$BUCKET" "$1" > "$2" 2>/dev/null
  fi
}
REF="e2e-a4-drill-$TS"; SECRET="e2e-a4-drill-hook-$TS"
SECRET_FILE="$CRED_DIR/$REF"
printf '%s' "$SECRET" | sudo -n tee "$SECRET_FILE" >/dev/null || fatal '密钥文件创建失败'
sudo -n chown 1001:1001 "$SECRET_FILE" && sudo -n chmod 600 "$SECRET_FILE" || fatal '密钥权限设置失败'
# 只模拟 webhook 接收方；CMS、worker、DB、S3 指针均不模拟。端口由内核分配。
python3 - "$TMP" "$SECRET" <<'PY' &
import hashlib
import hmac
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Final

ROOT: Final = Path(sys.argv[1])
SECRET: Final = sys.argv[2].encode()
class Handler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: str) -> None:
        return
    def do_POST(self) -> None:
        raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        signature = "sha256=" + hmac.new(SECRET, raw, hashlib.sha256).hexdigest()
        valid = hmac.compare_digest(self.headers.get("x-geo-foundry-signature", ""), signature)
        self.send_response(200 if valid else 403)
        self.end_headers()
        self.wfile.write(b'{"ok":true}' if valid else b'{"ok":false}')
with HTTPServer(("0.0.0.0", 0), Handler) as server:
    (ROOT / "port").write_text(str(server.server_port))
    server.serve_forever()
PY
RECEIVER_PID=$!
for ((I=0; I<50; I++)); do [ -s "$TMP/port" ] && break; kill -0 "$RECEIVER_PID" 2>/dev/null || fatal 'webhook 接收端启动失败'; sleep 0.1; done
read -r HOOK_PORT < "$TMP/port" || [ -n "${HOOK_PORT:-}" ] || fatal 'webhook 端口未就绪'
THRESH_HASH=$(printf 'e2e-a4-drill-defaults' | sha256sum); THRESH_HASH=${THRESH_HASH%% *}

# ---------- 夹具准备：创建即记录 ID，避免命令替换子 shell 丢失 trap 清理列表 ----------
mk_site() {
  local NAME="E2E A4 Drill $TS $1"
  SID=$(PSQL "INSERT INTO geo_foundry.sites (name,tenant_id,locale,timezone,status)
    VALUES ('$NAME',$TENANT,'en-US','UTC','active') RETURNING id") || fatal '夹具站创建失败'
  [[ "$SID" =~ ^[1-9][0-9]*$ ]] || fatal '夹具站 ID 非法'
  SITES+=("$SID"); NAMES+=("$NAME")
  PSQL "INSERT INTO geo_foundry.domains (hostname,site_id,tenant_id,role,status)
    VALUES ('drill-$SID-$TS.test',$SID,$TENANT,'canonical','active');
    UPDATE geo_foundry.sites SET webhook_url='http://$GW:$HOOK_PORT/hook/ok',webhook_secret_reference='$REF' WHERE id=$SID" >/dev/null || fatal '夹具域名或 webhook 配置失败'
}
approve() { # ED 全局；JSON 站点数组 + 周期。与 A4 相同 passed 回填，不代替 add 的真实评估。
  local SITES_JSON="$1" CYCLE="$2" REV IH S AS
  COOKIE="$TMP/editor.jar"
  cms POST "/api/editions/$ED/workflow-transitions" '{"target":"review"}'
  [ "$HTTP_CODE" = 200 ] || fatal 'review 失败'
  CODE=$(fetch "$TMP/draft.json" "$BASE/api/content-editions/$ED?draft=true&depth=0" -b "$COOKIE") || CODE=000
  [ "$CODE" = 200 ] || fatal 'draft 查询失败'
  REV=$(field "$TMP/draft.json" .workflowRevision) || fatal 'revision 缺失'
  CODE=$(fetch "$TMP/response.json" "$BASE/api/workspaces/reviewer/editions/$ED/approve" -X POST -b "$TMP/root.jar" \
    -H 'Content-Type: application/json' -H "x-request-id: drill-$TS-$ED-$CYCLE" \
    -H "idempotency-key: drill-$TS-$ED-$CYCLE" -d "{\"expectedRevision\":$REV}") || CODE=000
  [ "$CODE" = 200 ] && [ "$(field "$TMP/response.json" .workflowStatus)" = approved ] || fatal 'approve 失败'
  CODE=$(fetch "$TMP/input.json" "$BASE/api/internal/editions/$ED/input" -H "Authorization: users API-Key $SKEY") || CODE=000
  [ "$CODE" = 200 ] || fatal 'inputHash 请求失败'
  IH=$(field "$TMP/input.json" .inputHash) || fatal 'inputHash 缺失'
  for S in $(jq -r '.[]' <<< "$SITES_JSON"); do
    AS=$(jq -n --argjson siteId "$S" --arg inputHash "$IH" --arg thresholdsHash "$THRESH_HASH" \
      '{siteId:$siteId,inputHash:$inputHash,thresholdsHash:$thresholdsHash,issues:[],modelId:"e2e-a4-drill",overall:90,dimensions:{content:90,seo:90,structure:90},promptVersion:"e2e-1",provider:"e2e",state:"passed"}')
    CODE=$(fetch "$TMP/assessment.json" "$BASE/api/internal/editions/$ED/assessments" -X POST \
      -H "Authorization: users API-Key $SKEY" -H 'Content-Type: application/json' -H "x-request-id: drill-as-$TS-$ED-$S-$CYCLE" -d "$AS") || CODE=000
    [[ "$CODE" = 200 || "$CODE" = 201 ]] && jq -e '.assessmentId>0' "$TMP/assessment.json" >/dev/null || fatal 'passed 回填失败'
  done
}
new_article() { # 标题后缀 + 主站 + 额外站数组
  COOKIE="$TMP/editor.jar"
  local BODY
  BODY=$(jq -n --arg title "E2E A4 Drill $TS $1" --argjson site "$2" --argjson sites "$3" \
    '{title:$title,site:$site,sites:$sites,summary:"并发演练摘要。",bodyMarkdown:("## 并发演练\n\n"+$title+"：此文章仅用于验证独立站点追加、撤下、发布及回滚的一致性，不涉及任何业务数据。") }')
  cms POST '/api/content-editions?draft=true&depth=0' "$BODY"
  [ "$HTTP_CODE" = 201 ] || fatal '文章创建失败'
  ED=$(field "$TMP/response.json" .doc.id) || fatal '文章 ID 缺失'
  [[ "$ED" =~ ^[1-9][0-9]*$ ]] || fatal '文章 ID 非法'
  ARTICLES+=("$ED"); ROUND_ARTICLES+=("$ED")
  approve "$(jq -cn --argjson primary "$2" --argjson extra "$3" '[$primary]+$extra')" initial
}
op_terminal() { [ "$(Q "count(*) FROM geo_foundry.operations WHERE operation_id='$OP' AND state IN ('succeeded','failed','cancelled')")" = 1 ]; }
publish_one() {
  COOKIE="$TMP/publisher.jar"
  cms POST "/api/editions/$ED/publish-operations" "{\"siteId\":$1}"
  [ "$HTTP_CODE" = 202 ] || fatal '夹具发布未创建新操作'
  OP=$(field "$TMP/response.json" .operation.operationId) || fatal '夹具发布操作缺失'
  REL=$(field "$TMP/response.json" .operation.releaseId) || fatal '夹具 release 缺失'
  poll 180 op_terminal || fatal '夹具发布超过180秒'
  [ "$(Q "state FROM geo_foundry.operations WHERE operation_id='$OP'")" = succeeded ] || fatal '夹具发布失败'
}
new_version() {
  COOKIE="$TMP/editor.jar"
  cms POST "/api/editions/$ED/draft-from-published" '{"reason":"E2E A4 Drill 新版本"}'
  [ "$HTTP_CODE" = 200 ] && [ "$(field "$TMP/response.json" .workflowStatus)" = draft ] || fatal '新版本创建失败'
  cms PATCH "/api/content-editions/$ED?draft=true&depth=0" '{"bodyMarkdown":"## 新批准版本\n\n本轮新版本用于验证真实发布操作不会重放旧操作，且与按站撤下及回滚交错时保持状态一致。"}'
  [ "$HTTP_CODE" = 200 ] || fatal '新版本编辑失败'
  approve "[$A]" update
}

# ---------- 同步放行及业务错误：只接受本场景、本动作、指定 HTTP 状态的竞态码 ----------
race_request() { # 动作 标签；ED/A/B/当前与目标 release 属本轮夹具。
  local ACTION="$1" LABEL="$2" METHOD API_PATH BODY TOKEN CODE
  : > "$ROUND/$LABEL.ready"
  IFS= read -r -N 1 -u 9 TOKEN || return 1
  METHOD=POST
  case "$ACTION" in
    add) API_PATH="/api/editions/$ED/sites"; BODY="{\"siteId\":$B}";;
    removeA) METHOD=DELETE; API_PATH="/api/editions/$ED/sites/$A"; BODY='{"reason":"E2E A4 Drill 并发撤下"}';;
    removeB) METHOD=DELETE; API_PATH="/api/editions/$ED/sites/$B"; BODY='{"reason":"E2E A4 Drill 并发撤下"}';;
    publish) API_PATH="/api/editions/$ED/publish-operations"; BODY="{\"siteId\":$A}";;
    rollback) API_PATH='/api/rollback-operations/intents'; BODY="$RB_BODY";;
    *) return 1;;
  esac
  CODE=$(fetch "$ROUND/$LABEL.json" "$BASE$API_PATH" -X "$METHOD" -b "$TMP/publisher.jar" \
    -H 'Content-Type: application/json' -H "x-request-id: drill-$TS-$SC-$ROUND_NO-$LABEL" -d "$BODY") || CODE=000
  printf '%s\n' "$CODE" > "$ROUND/$LABEL.code"
  if [ "$ACTION" = rollback ] && [ "$CODE" = 201 ]; then
    local INTENT RBOP CONSUME
    INTENT=$(field "$ROUND/$LABEL.json" .intentId) && RBOP=$(field "$ROUND/$LABEL.json" .operationId) || return 1
    CONSUME=$(jq -n --argjson b "$RB_BODY" --arg intent "$INTENT" --arg op "$RBOP" --arg site "site-$A" \
      '$b | del(.siteId,.reason) | . + {rollbackIntentId:$intent,operationId:$op,runtimeSiteId:$site}') || return 1
    CODE=$(fetch "$ROUND/consume.json" "$BASE/api/internal/rollback-intents/consume" -X POST \
      -H "Authorization: users API-Key $SKEY" -H 'Content-Type: application/json' -d "$CONSUME") || CODE=000
    printf '%s\n' "$CODE" > "$ROUND/consume.code"
  fi
}
inspect_response() { # 标签 动作 -> HTTP 成功或窄业务失败，记录出现的错误码。
  local LABEL="$1" ACTION="$2" CODE ERR RESPONSE_OP ALLOWED=0
  read -r CODE < "$ROUND/$LABEL.code" || { bad "$TAG I1 $LABEL 响应缺失"; return; }
  case "$ACTION:$CODE" in
    add:202|removeA:202|removeB:202|publish:202|rollback:201|consume:200) ALLOWED=1;;
    removeA:200) [ "$SC" = S4 ] && ALLOWED=1;;
    *:4??)
      ERR=$(field "$ROUND/$LABEL.json" .error.code 2>/dev/null) || ERR=MISSING
      CODES+=("$TAG/$ACTION HTTP=$CODE code=$ERR")
      case "$SC:$ACTION:$CODE:$ERR" in
        S3:add:409:EDITION_SITE_ADD_ALREADY_ASSIGNED|S3:add:409:EDITION_SITE_ADD_ALREADY_PUBLISHED|\
        S4:removeA:409:EDITION_SITE_REMOVE_NOT_PUBLISHED|S4:publish:409:EDITION_WORKFLOW_SITE_NOT_ASSIGNED|\
        S5:removeA:409:EDITION_SITE_REMOVE_ROLLBACK_IN_PROGRESS|\
        S5:rollback:409:ROLLBACK_TARGET_PREDATES_TAKEDOWN|S5:rollback:409:ROLLBACK_RELEASE_STATE_MISMATCH|\
        S5:consume:409:ROLLBACK_INTENT_ALREADY_CONSUMED|S5:consume:409:ROLLBACK_TARGET_PREDATES_TAKEDOWN) ALLOWED=1;;
      esac;;
  esac
  if [ "$ALLOWED" = 1 ] && [[ "$CODE" = 2?? ]] && [ "$ACTION" != consume ]; then
    if [ "$ACTION" = removeA ] && [ "$CODE" = 200 ]; then
      jq -e '.publishState=="removed" and .operation==null' "$ROUND/$LABEL.json" >/dev/null || ALLOWED=0
    else
      RESPONSE_OP=$(field "$ROUND/$LABEL.json" '.operation.operationId // .operationId' 2>/dev/null) || RESPONSE_OP=''
      if [[ "$RESPONSE_OP" =~ ^[a-zA-Z0-9-]+$ ]]; then
        [ "$(Q "count(*) FROM geo_foundry.operations WHERE operation_id='$RESPONSE_OP'
          AND tenant_id=$TENANT AND site_id IN ($A,$B) AND id>$FLOOR")" = 1 ] || ALLOWED=0
      else
        ALLOWED=0
      fi
    fi
  fi
  [ "$ALLOWED" = 1 ] && ok "$TAG I1 $ACTION HTTP=$CODE（合法成功或已记录竞态码）" \
    || bad "$TAG I1 $ACTION HTTP=$CODE code=${ERR:-NONE}（5xx/传输失败/非预期响应）"
}
round_terminal() {
  [ "$(Q "count(*) FROM geo_foundry.operations WHERE tenant_id=$TENANT AND site_id IN ($A,$B)
    AND id>$FLOOR AND state NOT IN ('succeeded','failed','cancelled')")" = 0 ]
}
events_ready() { # 精确按 job 的 site/release/type/eventId 关联，不接受历史成功事件代替。
  [ "$(Q "count(*) FROM pgboss.job j WHERE j.data->>'siteId' IN ('$A','$B')
    AND j.data ? 'eventId' AND NOT EXISTS (SELECT 1 FROM geo_foundry.site_event_deliveries d
      WHERE d.event_id=j.data->>'eventId' AND d.site_id=(j.data->>'siteId')::integer
        AND d.release_id=j.data->>'releaseId' AND d.event_type=j.data->>'eventType'
        AND d.state='delivered' AND d.last_status_code BETWEEN 200 AND 299)")" = 0 ]
}
invariants() {
  local ROW ID TYPE STATE ERR MESSAGE S CURRENT HASH EDID PATHNAME PS URL_STATE FOUND HOST
  poll 180 round_terminal && ok "$TAG I2 全部本轮操作180秒内终态" || { bad "$TAG I2 操作超时"; return 1; }
  Q "coalesce(json_agg(json_build_object('id',operation_id,'type',operation_type,'state',state,
    'error',error,'endpoint',endpoint)),'[]'::json) FROM geo_foundry.operations
    WHERE tenant_id=$TENANT AND site_id IN ($A,$B) AND id>$FLOOR" > "$ROUND/ops.json" || return 1
  check "$TAG I2 操作集合非空（禁止空集通过）" jq -e 'length>0' "$ROUND/ops.json"
  while IFS= read -r ROW; do
    ID=$(jq -r .id <<< "$ROW"); TYPE=$(jq -r .type <<< "$ROW"); STATE=$(jq -r .state <<< "$ROW")
    ERR=$(jq -r '.error.code // ""' <<< "$ROW"); MESSAGE=$(jq -r '.error.message // ""' <<< "$ROW")
    case "$STATE" in
      succeeded) ok "$TAG I2 $TYPE/$ID succeeded";;
      failed)
        CODES+=("$TAG/$TYPE operation=$ID code=$ERR")
        # S4 仅允许普通发布的败方；重发、评估失败均是缺陷。重试耗尽必须有具体门禁证据。
        if [ "$SC" = S4 ] && [ "$TYPE" = publish ] && [ "$(jq -r .endpoint <<< "$ROW")" = "/editions/$ED/publish" ] &&
          [ "$(Q "count(*) FROM geo_foundry.edition_sites WHERE edition_id=$ED AND site_id=$A AND publish_state='published'")" = 0 ]; then
          case "$ERR:$MESSAGE" in
            ARTIFACT_STORE_POINTER_ETAG_STALE:*|WORKER_RETRY_EXHAUSTED:*EDITION_WORKFLOW_SITE_NOT_ASSIGNED*|WORKER_RETRY_EXHAUSTED:*RELEASE_EDITION_SITE_MISMATCH*)
              ok "$TAG I2 已证明撤下败方 $ID code=$ERR"; continue;;
          esac
        fi
        bad "$TAG I2 非预期 failed $TYPE/$ID code=$ERR";;
      *) bad "$TAG I2 非成功终态 $TYPE/$ID state=$STATE";;
    esac
  done < <(jq -c '.[]' "$ROUND/ops.json")
  poll 90 events_ready && ok "$TAG I6 所有夹具事件按 release/type 投递成功（HMAC 接收端）" \
    || bad "$TAG I6 事件缺失或投递失败"
  check "$TAG I6 两个站均有事件（禁止空台账通过）" test "$(Q "count(DISTINCT site_id)
    FROM geo_foundry.site_event_deliveries WHERE site_id IN ($A,$B)")" = 2
  check "$TAG I5 无重复 active URL" test "$(Q "count(*) FROM (SELECT site_id,pathname FROM geo_foundry.url_records
    WHERE site_id IN ($A,$B) AND state='active' GROUP BY site_id,pathname HAVING count(*)>1) x")" = 0
  check "$TAG I6 无重复 site/release/type 台账" test "$(Q "count(*) FROM (SELECT site_id,release_id,event_type
    FROM geo_foundry.site_event_deliveries WHERE site_id IN ($A,$B) GROUP BY site_id,release_id,event_type HAVING count(*)>1) x")" = 0
  check "$TAG I6 无重复 site/release/type 入队" test "$(Q "count(*) FROM (SELECT data->>'siteId',data->>'releaseId',data->>'eventType'
    FROM pgboss.job WHERE data->>'siteId' IN ('$A','$B') AND data ? 'eventId'
    GROUP BY data->>'siteId',data->>'releaseId',data->>'eventType' HAVING count(*)>1) x")" = 0
  for S in "$A" "$B"; do
    CURRENT=$(Q "release_id FROM geo_foundry.releases WHERE site_id=$S AND state='current'") || return 1
    check "$TAG I3 site=$S 恰一 current release" test "$(Q "count(*) FROM geo_foundry.releases WHERE site_id=$S AND state='current'")" = 1
    [[ "$CURRENT" =~ ^rel-[a-zA-Z0-9-]+$ ]] || { bad "$TAG current 标识非法"; continue; }
    s3_get "$PREFIX/sites/site-$S/releases/$CURRENT/manifest.json" "$ROUND/manifest-$S.json" &&
      s3_get "$PREFIX/sites/site-$S/releases/$CURRENT/routes.json" "$ROUND/routes-$S.json" || { bad "$TAG I4 S3 产物读取失败 site=$S"; continue; }
    HASH=$(sha256sum "$ROUND/manifest-$S.json"); HASH=${HASH%% *}
    check "$TAG I4 current manifest 字节 SHA 对应 DB" test "$HASH" = "$(Q "manifest_sha256 FROM geo_foundry.releases WHERE release_id='$CURRENT'")"
    for EDID in "${ROUND_ARTICLES[@]}"; do
      PS=$(Q "publish_state FROM geo_foundry.edition_sites WHERE edition_id=$EDID AND site_id=$S") || return 1
      # pathname 由 URL 台账查询，不按标题猜；未分配站没有 URL，应不存在文档/active 路由。
      Q "coalesce(json_agg(json_build_object('pathname',pathname,'state',state,'status',status_code)),'[]'::json)
        FROM geo_foundry.url_records WHERE edition_id=$EDID AND site_id=$S" > "$ROUND/urls.json" || return 1
      Q "coalesce(json_agg(DISTINCT pathname),'[]'::json) FROM geo_foundry.url_records
        WHERE edition_id=$EDID AND site_id IN ($A,$B)" > "$ROUND/paths.json" || return 1
      FOUND=$(jq --slurpfile paths "$ROUND/paths.json" '[.objects[].path as $p | $paths[0][] | select($p==("pages"+.+".json"))] | length' "$ROUND/manifest-$S.json") || return 1
      case "$PS" in
        published)
          [ "$FOUND" = 1 ] && jq -e '[.[]|select(.state=="active")]|length==1' "$ROUND/urls.json" >/dev/null \
            && ok "$TAG I4 ($EDID,$S) published ⇔ 文档存在/URL active" || bad "$TAG I4 ($EDID,$S) published 内容或 URL 不一致";;
        unpublished)
          [ "$FOUND" = 0 ] && jq -e 'length>0 and all(.[];.state=="gone" and .status==410)' "$ROUND/urls.json" >/dev/null \
            && ok "$TAG I4 ($EDID,$S) unpublished ⇔ 文档缺席/URL gone410" || bad "$TAG I4 ($EDID,$S) 撤下内容或 URL 不一致";;
        pending|failed|'')
          [ "$FOUND" = 0 ] && jq -e 'all(.[];.state=="reserved" or .state=="gone")' "$ROUND/urls.json" >/dev/null \
            && ok "$TAG I4 ($EDID,$S) 待发或未分配不出现在 release" || bad "$TAG I4 ($EDID,$S) 非 published 却存在文档";;
        *) bad "$TAG I4 未知 publish_state=$PS";;
      esac
      # routes.json 再核对台账 URL 的 active/gone，不把 manifest 文档缺席冒充 410。
      while IFS=$'\t' read -r PATHNAME URL_STATE; do
        case "$URL_STATE" in
          active|gone)
            jq -e --arg p "$PATHNAME" --arg st "$URL_STATE" '[.routes[]|select(.pathname==$p)] | length==1 and .[0].status==$st' "$ROUND/routes-$S.json" >/dev/null \
              && ok "$TAG I4 路由 $S$PATHNAME=$URL_STATE" || bad "$TAG I4 路由状态与台账不符 $S$PATHNAME";;
        esac
      done < <(jq -r '.[]|[.pathname,.state]|@tsv' "$ROUND/urls.json")
    done
    HOST=$(Q "hostname FROM geo_foundry.domains WHERE site_id=$S AND role='canonical' AND status='active'") || return 1
    CODE=$(fetch "$ROUND/delivery-$S.json" "$BASE/api/delivery/sites/$HOST/articles?limit=100") || CODE=000
    check "$TAG CMS delivery 站点列表仍可读" test "$CODE" = 200
  done
}

# ---------- Given / When / Then：五类竞态各 R=3，任何轮超时即停止，不叠加在途操作 ----------
for SC in S1 S2 S3 S4 S5; do
  for ((ROUND_NO=1; ROUND_NO<=R; ROUND_NO++)); do
    TAG="$SC/$ROUND_NO"; ROUND="$TMP/$SC-$ROUND_NO"; mkdir "$ROUND"
    ROUND_ARTICLES=()
    mk_site "$SC-$ROUND_NO-A"; A=$SID
    mk_site "$SC-$ROUND_NO-B"; B=$SID
    new_article "$TAG anchor-A" "$A" '[]'; publish_one "$A"
    new_article "$TAG anchor-B" "$B" '[]'; publish_one "$B"
    EXTRA='[]'; [ "$SC" != S2 ] || EXTRA="[$B]"
    new_article "$TAG race" "$A" "$EXTRA"
    publish_one "$A"; OLD_OP=$OP; OLD_REL=$REL
    [ "$SC" != S2 ] || publish_one "$B"
    ACTION1=add; ACTION2=removeA
    case "$SC" in
      S1) :;;
      S2) ACTION1=removeA; ACTION2=removeB;;
      S3) ACTION2=add;;
      S4) new_version; ACTION1=publish;;
      S5)
        PREV=$OLD_REL; new_version; publish_one "$A"
        [ "$OP" != "$OLD_OP" ] && [ "$REL" != "$OLD_REL" ] || fatal '新版本回放旧 operation/release'
        RB_BODY=$(jq -n --argjson siteId "$A" --arg cur "$REL" --arg target "$PREV" \
          --arg cursha "$(Q "manifest_sha256 FROM geo_foundry.releases WHERE release_id='$REL'")" \
          --arg targetsha "$(Q "manifest_sha256 FROM geo_foundry.releases WHERE release_id='$PREV'")" \
          '{siteId:$siteId,expectedCurrentReleaseId:$cur,expectedCurrentManifestSha256:$cursha,targetReleaseId:$target,expectedManifestSha256:$targetsha,reason:"E2E A4 Drill 并发回滚"}') || fatal '回滚 JSON 准备失败'
        ACTION1=rollback;;
    esac
    FLOOR=$(Q "coalesce(max(id),0) FROM geo_foundry.operations WHERE tenant_id=$TENANT AND site_id IN ($A,$B)") || fatal '操作基线查询失败'
    mkfifo "$ROUND/gate" || fatal 'FIFO 创建失败'
    exec 9<>"$ROUND/gate"; GATE_OPEN=1
    race_request "$ACTION1" left & P1=$!; CHILDREN+=("$P1")
    race_request "$ACTION2" right & P2=$!; CHILDREN+=("$P2")
    READY_END=$((SECONDS+10))
    until [ -f "$ROUND/left.ready" ] && [ -f "$ROUND/right.ready" ]; do
      (( SECONDS < READY_END )) || fatal '请求进程未到同步屏障'
      sleep 0.05
    done
    printf 'xx' >&9
    wait "$P1" || bad "$TAG 左请求进程失败"
    wait "$P2" || bad "$TAG 右请求进程失败"
    CHILDREN=(); exec 9>&-; GATE_OPEN=0
    inspect_response left "$ACTION1"; inspect_response right "$ACTION2"
    [ ! -f "$ROUND/consume.code" ] || inspect_response consume consume
    invariants || fatal "$TAG 无法完成终态/不变量检查"
    if [ "$SC" = S3 ]; then
      check "$TAG 双追加恰好一条 evaluate 操作" test "$(Q "count(*) FROM geo_foundry.operations WHERE site_id=$B AND id>$FLOOR AND operation_type='evaluate'")" = 1
      check "$TAG 双追加恰好一个202一个409" test "$(sort "$ROUND/left.code" "$ROUND/right.code" | tr '\n' ' ')" = '202 409 '
    fi
    if [ "$SC" = S4 ] && [ "$(<"$ROUND/left.code")" = 202 ]; then
      check "$TAG 新批准版本创建新操作/新release" jq -e --arg op "$OLD_OP" --arg rel "$OLD_REL" \
        '.operation.created==true and .operation.operationId!=$op and .operation.releaseId!=$rel' "$ROUND/left.json"
    fi
    if [ "$SC" = S5 ] && [ "$(<"$ROUND/left.code")" = 201 ]; then
      INTENT=$(field "$ROUND/left.json" .intentId) || fatal 'rollback intent ID 缺失'
      check "$TAG rollback intent 真正 consumed" test "$(Q "consumed_at IS NOT NULL FROM geo_foundry.rollback_intents WHERE intent_id='$INTENT'")" = t
    fi
    echo "SKIP: $TAG I7 全局 routing hosts 对比（现有 E2E 无双端读取范例）"
  done
done
exit 0
