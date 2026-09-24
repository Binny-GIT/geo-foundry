#!/usr/bin/env bash
# B3 站点事件 webhook E2E（真实 worker 投递，不经模拟）：
#  1. 三个一次性夹具站（租户 413，各带 active canonical 域名 + webhook 配置）：
#     A HookOk    — webhook 指向宿主 mock 接收端 /hook/ok（恒 200）；
#     B HookRetry — webhook 指向 /hook/retry（前 2 次 500，第 3 次 200）；
#     D HookDown  — webhook 指向宿主未监听端口（ECONNREFUSED，必然死信）。
#     密钥文件写入 /opt/geo-foundry/credentials（uid 1001:1001, 600），
#     由 worker 经 GEO_FOUNDRY_SITE_WEBHOOK_CREDENTIALS_DIR 读取。
#  2. 各站文章 draft→review→approve→passed 评估→publish-operations，
#     真实 worker 消费 site-events 队列完成投递：
#     A 首篇 → published 事件 delivered（1 次尝试、200、HMAC 验签通过、
#       请求体无内部字段）；A 第二篇 → updated 事件 delivered；
#     B → delivered（3 次尝试，最后 200）；
#     D → failed 死信行（3 次尝试、无状态码、error=fetch failed）。
#  3. 同事务入队证据：pgboss.job singleton_key=evt-*（确定性 eventId）。
#  4. 回执端点门禁：tenantId 与 API key 租户不符 → 403；相符 → 200 recorded。
#  5. canonical 台账：新发布 URL 为 https://<域名><pathname>（无 locale 前缀）；
#     全库不再存在旧的 https://<域名>/<locale><pathname> 形态（0013 回填）。
# 收尾：四篇 draft-from-published→archived，三个夹具站按 id+name 双校验清除，
# 删除密钥文件与接收端进程。
# 在 mk-dev 宿主机运行；需要 GF_E2E_EDITOR_PASSWORD / GF_E2E_ROOT_PASSWORD /
# GF_E2E_PUBLISHER_PASSWORD。
set -uo pipefail
BASE=http://127.0.0.1:3090
TENANT=413
HOOK_PORT=18099
DEAD_PORT=18098
TS=$(date +%s)
PASS=(); FAIL=()
ok() { PASS+=("$1"); echo "PASS: $1"; }
bad() { FAIL+=("$1"); echo "FAIL: $1"; }
EDPW="${GF_E2E_EDITOR_PASSWORD:?}"
RTPW="${GF_E2E_ROOT_PASSWORD:?}"
PBPW="${GF_E2E_PUBLISHER_PASSWORD:?}"

PSQL() { sudo docker exec pg-server psql -U gpucloud -d geo_foundry -qAt -c "$1"; }
Q() { PSQL "SELECT $1"; }

login() { curl -s -X POST $BASE/api/users/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"$2\"}" -c "$3" -o /dev/null; }
login gf-editor-test@geo-foundry.dev "$EDPW" /tmp/se-e.jar
login gf-root-test@geo-foundry.dev "$RTPW" /tmp/se-r.jar
login e2e-scheduled-publisher@geo-foundry.test "$PBPW" /tmp/se-p.jar
echo "logins ok"
SKEY=$(sudo python3 -c 'import json;print(json.load(open("/opt/geo-foundry/credentials/content-service-keyring.json"))["tenants"]["413"])')
auth() { echo "Authorization: users API-Key $SKEY"; }

st_of() { echo "$1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["workflowStatus"])'; }
rev_of() { echo "$1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["workflowRevision"])'; }
draft() { curl -s -b /tmp/se-e.jar "$BASE/api/content-editions/$1?draft=true&depth=0"; }

# ---------- 0. 前提：接收端端口空闲、worker 容器网关、旧夹具必须为空 ----------
for P in "$HOOK_PORT" "$DEAD_PORT"; do
  python3 -c 'import socket,sys
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    s.bind(("0.0.0.0", int(sys.argv[1]))); s.close()
except OSError:
    sys.exit(1)' "$P" \
    && ok "port $P free" || { bad "port $P busy"; exit 1; }
done
GW=$(sudo docker inspect -f '{{range .NetworkSettings.Networks}}{{.Gateway}} {{end}}' \
  geo-foundry-worker-mk-dev 2>/dev/null | awk '{print $1}')
[ -n "$GW" ] && ok "worker gateway=$GW" || { bad "worker container gateway not found"; exit 1; }

OLD_FIXTURES=$(PSQL "SELECT id||': '||name FROM geo_foundry.sites
  WHERE name IN ('E2E B3 HookOk','E2E B3 HookRetry','E2E B3 HookDown')")
[ -z "$OLD_FIXTURES" ] || { bad "old fixture sites need manual review: $OLD_FIXTURES"; exit 1; }

# ---------- 1. mock 接收端（宿主 0.0.0.0:HOOK_PORT，验签 + 记回执） ----------
SECRET="e2e-b3-webhook-secret-$TS"
REF="e2e-b3-secret-$TS"
RECEIPT=/tmp/se-receipts-$TS.jsonl
RECEIVER=/tmp/se-receiver-$TS.py
CRED_DIR=$(sudo grep '^GEO_FOUNDRY_CREDENTIALS_DIR=' /opt/geo-foundry/mk-dev.env | cut -d= -f2)
RECEIVER_PID=""
SECRET_FILE=""
SITE_A=""
SITE_B=""
SITE_D=""
cleanup() {
  [ -n "$RECEIVER_PID" ] && kill "$RECEIVER_PID" 2>/dev/null
  [ -n "$SECRET_FILE" ] && sudo rm -f "$SECRET_FILE"
}
cleanup_sites() {
  purge_fixture_site "$SITE_A" 'E2E B3 HookOk'
  purge_fixture_site "$SITE_B" 'E2E B3 HookRetry'
  purge_fixture_site "$SITE_D" 'E2E B3 HookDown'
}
purge_fixture_site() { # 仅按 id + name 双校验清除依赖行
  local S="$1" N="$2"
  [ -n "$S" ] || return 0
  # 评估行 site_id 非空且外键指向 sites，先删否则站点删除被 NOT NULL 级联挡下。
  PSQL "DELETE FROM geo_foundry.quality_assessments WHERE site_id=$S" >/dev/null
  PSQL "DELETE FROM geo_foundry.site_event_deliveries WHERE site_id=$S" >/dev/null
  PSQL "DELETE FROM geo_foundry.url_records WHERE site_id=$S" >/dev/null
  PSQL "DELETE FROM geo_foundry.edition_sites WHERE site_id=$S" >/dev/null
  PSQL "DELETE FROM geo_foundry.operations WHERE site_id=$S" >/dev/null
  PSQL "DELETE FROM geo_foundry.releases WHERE site_id=$S" >/dev/null
  PSQL "DELETE FROM geo_foundry.domains WHERE site_id=$S" >/dev/null
  PSQL "DELETE FROM geo_foundry.sites WHERE id=$S AND name='$N'" >/dev/null
}
trap 'cleanup_sites; cleanup' EXIT

cat > "$RECEIVER" <<'PYEOF'
import hmac, hashlib, json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

receipt, secret, port = sys.argv[1], sys.argv[2], int(sys.argv[3])

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _healthz(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def do_GET(self):
        # 仅探活端点接受 GET；hook 路径未实现 GET（返回 501）。
        if self.path == "/healthz":
            self._healthz()

    def do_POST(self):
        if self.path == "/healthz":
            self._healthz()
            return
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            body = {"__unparseable__": True}
        signature = self.headers.get("x-geo-foundry-signature", "")
        expect = "sha256=" + hmac.new(
            secret.encode("utf-8"), raw, hashlib.sha256
        ).hexdigest()
        status = 200
        if self.path.startswith("/hook/retry"):
            count_file = receipt + ".retry-count"
            try:
                n = int(open(count_file).read().strip() or "0")
            except OSError:
                n = 0
            n += 1
            open(count_file, "w").write(str(n))
            status = 200 if n >= 3 else 500
        with open(receipt, "a") as f:
            f.write(json.dumps({
                "path": self.path,
                "status": status,
                "event_id_header": self.headers.get("x-geo-foundry-event-id"),
                "signature_ok": hmac.compare_digest(expect, signature),
                "signature": signature,
                "body": body,
            }) + "\n")
        payload = b'{"ok":true}' if status == 200 else b'{"error":"mock 500"}'
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(payload)

HTTPServer(("0.0.0.0", port), Handler).serve_forever()
PYEOF
python3 "$RECEIVER" "$RECEIPT" "$SECRET" "$HOOK_PORT" &
RECEIVER_PID=$!
# 探针带重试：python 冷启动 + 首次绑定可能超过 1s。
UP=0
for i in $(seq 1 10); do
  curl -s -o /dev/null -m 2 http://127.0.0.1:$HOOK_PORT/healthz && { UP=1; break; }
  sleep 1
done
[ "$UP" = "1" ] \
  && ok "mock receiver up (pid=$RECEIVER_PID, gw=$GW)" \
  || { bad "mock receiver unreachable"; exit 1; }

# 密钥文件：worker 容器以 uid 1001 运行，宿主机 credentials 目录 bind 只读挂载
SECRET_FILE="$CRED_DIR/$REF"
printf '%s' "$SECRET" | sudo tee "$SECRET_FILE" >/dev/null
sudo chown 1001:1001 "$SECRET_FILE" && sudo chmod 600 "$SECRET_FILE" \
  && ok "secret file provisioned ($REF)" || { bad "secret file provisioning"; exit 1; }

# ---------- 2. 三个夹具站（各带 canonical 域名 + webhook 配置） ----------
mk_site() { # name domain webhook_url
  local S
  S=$(PSQL "INSERT INTO geo_foundry.sites (name, tenant_id, locale, timezone, status)
    VALUES ('$1', $TENANT, 'en-US', 'UTC', 'active') RETURNING id")
  [ -n "$S" ] || { bad "fixture $1 insert"; exit 1; }
  PSQL "INSERT INTO geo_foundry.domains (hostname, site_id, tenant_id, role, status)
    VALUES ('$2', $S, $TENANT, 'canonical', 'active')" >/dev/null
  PSQL "UPDATE geo_foundry.sites SET webhook_url='$3', webhook_secret_reference='$REF' WHERE id=$S" >/dev/null
  echo "$S"
}
SITE_A=$(mk_site 'E2E B3 HookOk' "e2e-b3-ok-$TS.test" "http://$GW:$HOOK_PORT/hook/ok")
SITE_B=$(mk_site 'E2E B3 HookRetry' "e2e-b3-retry-$TS.test" "http://$GW:$HOOK_PORT/hook/retry")
SITE_D=$(mk_site 'E2E B3 HookDown' "e2e-b3-down-$TS.test" "http://$GW:$DEAD_PORT/nothing")
ok "fixture sites created (A=$SITE_A B=$SITE_B D=$SITE_D)"
DOMAIN_A=$(Q "hostname FROM geo_foundry.domains WHERE site_id=$SITE_A")
DOMAIN_B=$(Q "hostname FROM geo_foundry.domains WHERE site_id=$SITE_B")
DOMAIN_D=$(Q "hostname FROM geo_foundry.domains WHERE site_id=$SITE_D")

# ---------- 3. 文章到 approved + passed 评估（真实发布链前置） ----------
make_approved() { # title body site -> edition id（stdout）
  local TITLE="$1" BODY="$2" SITEID="$3"
  local C ED R A IH AS RESP
  C=$(python3 -c 'import json,sys;print(json.dumps({"title":sys.argv[1],"bodyMarkdown":sys.argv[2],"site":int(sys.argv[3])},ensure_ascii=False))' \
    "$TITLE" "$BODY" "$SITEID" | \
    curl -s -X POST "$BASE/api/content-editions?draft=true&depth=0" -b /tmp/se-e.jar \
      -H 'Content-Type: application/json' -d @-)
  ED=$(echo "$C" | python3 -c 'import json,sys;print(json.load(sys.stdin)["doc"]["id"])')
  [ -n "$ED" ] || { echo "CREATE_FAILED $C"; return 1; }
  curl -s -o /dev/null -X POST "$BASE/api/editions/$ED/workflow-transitions" -b /tmp/se-e.jar \
    -H 'Content-Type: application/json' -d '{"target":"review"}'
  R=$(rev_of "$(draft "$ED")")
  A=$(curl -s -X POST "$BASE/api/workspaces/reviewer/editions/$ED/approve" -b /tmp/se-r.jar \
    -H 'Content-Type: application/json' -H "x-request-id: se-a-$TS-$ED" \
    -H "idempotency-key: se-approve-$TS-$ED" -d "{\"expectedRevision\":$R}")
  [ "$(st_of "$A")" = "approved" ] || { echo "APPROVE_FAILED $A"; return 1; }
  IH=$(curl -s -H "$(auth)" "$BASE/api/internal/editions/$ED/input" | python3 -c 'import json,sys;print(json.load(sys.stdin)["inputHash"])')
  AS=$(curl -s -X POST "$BASE/api/internal/editions/$ED/assessments" -H "$(auth)" \
    -H 'Content-Type: application/json' -H "x-request-id: se-as-$TS-$ED" \
    -d "{\"siteId\":$SITEID,\"inputHash\":\"$IH\",\"issues\":[],\"modelId\":\"e2e-site-events\",\"overall\":90,\"dimensions\":{\"content\":90,\"seo\":90,\"structure\":90},\"promptVersion\":\"e2e-1\",\"provider\":\"e2e\",\"state\":\"passed\",\"thresholdsHash\":\"$(python3 -c "import hashlib;print(hashlib.sha256(b'e2e-site-events-defaults').hexdigest())")\"}")
  echo "$AS" | python3 -c 'import json,sys;d=json.load(sys.stdin);exit(0 if d.get("assessmentId",0)>0 else 1)' \
    || { echo "ASSESS_FAILED $AS"; return 1; }
  echo "$ED"
}
publish_and_wait() { # edition -> "opId relId state"（stdout）
  local ED="$1" RESP OP REL STATE
  RESP=$(curl -s -X POST "$BASE/api/editions/$ED/publish-operations" -b /tmp/se-p.jar \
    -H 'Content-Type: application/json' -d '{}')
  OP=$(echo "$RESP" | python3 -c 'import json,sys;print(json.load(sys.stdin)["operation"]["operationId"])')
  REL=$(echo "$RESP" | python3 -c 'import json,sys;print(json.load(sys.stdin)["operation"]["releaseId"])')
  [ -n "$OP" ] || { echo "OP_FAILED $RESP"; return 1; }
  STATE=""
  for i in $(seq 1 40); do
    STATE=$(Q "state FROM geo_foundry.operations WHERE operation_id='$OP'")
    { [ "$STATE" = "succeeded" ] || [ "$STATE" = "failed" ]; } && break
    sleep 3
  done
  echo "$OP $REL $STATE"
}
event_id_of() { # siteId releaseId type -> evt-*
  python3 -c 'import hashlib,sys;print("evt-"+hashlib.sha256(
    ("%s|%s|%s" % tuple(sys.argv[1:4])).encode()).hexdigest()[:24])' "$1" "$2" "$3"
}
wait_delivery() { # eventId -> "state attempt last_status last_error"（stdout，最长 90s）
  local EV="$1" ROW
  for i in $(seq 1 30); do
    ROW=$(Q "state||' '||attempt_count::text||' '||coalesce(last_status_code::text,'null')||' '||coalesce(last_error,'')
      FROM geo_foundry.site_event_deliveries WHERE event_id='$EV'")
    [ -n "$ROW" ] && break
    sleep 3
  done
  echo "${ROW:-MISSING 0 null }"
}

# ---------- 4. A 站首篇：published 事件 ----------
ED_A1=$(make_approved "E2E B3 事件 A1 $TS" "B3 站点事件 webhook 验证正文 A1。" "$SITE_A")
[ -n "$ED_A1" ] && ok "A1 approved (edition=$ED_A1)" || { bad "A1 prep: $ED_A1"; exit 1; }
read -r OP1 REL1 ST1 <<<"$(publish_and_wait "$ED_A1")"
[ "$ST1" = "succeeded" ] && ok "A1 publish op succeeded (op=$OP1 rel=$REL1)" \
  || bad "A1 publish op=$OP1 state=$ST1"
EV_PUB=$(event_id_of "$SITE_A" "$REL1" published)
JOB=$(Q "count(*) FROM pgboss.job WHERE singleton_key='$EV_PUB'")
[ "$JOB" -ge 1 ] && ok "pgboss job same-tx enqueued (singleton=$EV_PUB)" || bad "pgboss job=$JOB"
ROW_A1=$(wait_delivery "$EV_PUB")
read -r DSTATE ATRY DCODE DERR <<<"$ROW_A1"
if [ "$DSTATE" = "delivered" ] && [ "$ATRY" = "1" ] && [ "$DCODE" = "200" ]; then
  ok "A1 published event delivered ($ROW_A1)"
else
  bad "A1 delivery row: $ROW_A1 (want delivered 1 200)"
fi
# 接收端回执：验签 + 请求体字段（无内部字段）+ 事件 id 头
tail -1 "$RECEIPT" | python3 -c '
import json,sys
r=json.loads(sys.stdin.read())
b=r["body"]
assert r["signature_ok"] is True, "signature mismatch"
assert b["eventId"]==sys.argv[1], "event id"
assert b["eventType"]=="published", "event type"
assert b["releaseId"]==sys.argv[2], "release id"
assert b["siteId"]==int(sys.argv[3]), "site id"
assert b["hostname"]==sys.argv[4], "hostname"
for k in ("tenantId","webhookSecretReference","webhookUrl"):
    assert k not in b, f"internal field leaked: {k}"
assert r["event_id_header"]==b["eventId"], "event id header"
' "$EV_PUB" "$REL1" "$SITE_A" "$DOMAIN_A" \
  && ok "receiver receipt verified (HMAC + body + header)" \
  || bad "receiver receipt mismatch: $(tail -1 "$RECEIPT")"
# canonical 台账：无 locale 前缀
UCAN=$(Q "coalesce(canonical_url,'')||'|'||coalesce(pathname,'') FROM geo_foundry.url_records
  WHERE edition_id=$ED_A1 AND site_id=$SITE_A")
CAN=${UCAN%%|*}; PATHN=${UCAN#*|}
[ "$CAN" = "https://$DOMAIN_A$PATHN" ] && ok "canonical no-locale ($CAN)" \
  || bad "canonical=$CAN want=https://$DOMAIN_A$PATHN"
case "$CAN" in "https://$DOMAIN_A/en-US"*) bad "canonical still has locale prefix";; esac

# ---------- 5. A 站第二篇：updated 事件 ----------
ED_A2=$(make_approved "E2E B3 事件 A2 $TS" "B3 站点事件 webhook 验证正文 A2（updated）。" "$SITE_A")
[ -n "$ED_A2" ] && ok "A2 approved (edition=$ED_A2)" || { bad "A2 prep: $ED_A2"; exit 1; }
read -r OP2 REL2 ST2 <<<"$(publish_and_wait "$ED_A2")"
[ "$ST2" = "succeeded" ] && ok "A2 publish op succeeded (op=$OP2 rel=$REL2)" \
  || bad "A2 publish op=$OP2 state=$ST2"
EV_UPD=$(event_id_of "$SITE_A" "$REL2" updated)
ROW_A2=$(wait_delivery "$EV_UPD")
read -r DSTATE2 ATRY2 DCODE2 DERR2 <<<"$ROW_A2"
if [ "$DSTATE2" = "delivered" ] && [ "$DCODE2" = "200" ]; then
  ok "A2 updated event delivered ($ROW_A2)"
else
  bad "A2 delivery row: $ROW_A2 (want delivered * 200)"
fi
tail -1 "$RECEIPT" | python3 -c '
import json,sys
r=json.loads(sys.stdin.read())
b=r["body"]
assert b["eventType"]=="updated", "event type"
assert b["releaseId"]==sys.argv[1], "release id"
assert r["signature_ok"] is True, "signature"
' "$REL2" && ok "A2 receipt eventType=updated verified" || bad "A2 receipt mismatch"

# ---------- 6. B 站：前 2 次 500、第 3 次成功（进程内重试） ----------
ED_B=$(make_approved "E2E B3 事件 B $TS" "B3 站点事件 webhook 验证正文 B（retry）。" "$SITE_B")
[ -n "$ED_B" ] && ok "B approved (edition=$ED_B)" || { bad "B prep: $ED_B"; exit 1; }
read -r OPB RELB STB <<<"$(publish_and_wait "$ED_B")"
[ "$STB" = "succeeded" ] && ok "B publish op succeeded (op=$OPB rel=$RELB)" \
  || bad "B publish op=$OPB state=$STB"
EV_B=$(event_id_of "$SITE_B" "$RELB" published)
ROW_B=$(wait_delivery "$EV_B")
read -r DSTATEB ATRYB DCODEB DERRB <<<"$ROW_B"
if [ "$DSTATEB" = "delivered" ] && [ "$ATRYB" = "3" ] && [ "$DCODEB" = "200" ]; then
  ok "B retry delivered after 3 attempts ($ROW_B)"
else
  bad "B delivery row: $ROW_B (want delivered 3 200)"
fi

# ---------- 7. D 站：不可达端口 → 死信 ----------
ED_D=$(make_approved "E2E B3 事件 D $TS" "B3 站点事件 webhook 验证正文 D（dead letter）。" "$SITE_D")
[ -n "$ED_D" ] && ok "D approved (edition=$ED_D)" || { bad "D prep: $ED_D"; exit 1; }
read -r OPD RELD STD <<<"$(publish_and_wait "$ED_D")"
[ "$STD" = "succeeded" ] && ok "D publish op succeeded (op=$OPD rel=$RELD)" \
  || bad "D publish op=$OPD state=$STD"
EV_D=$(event_id_of "$SITE_D" "$RELD" published)
ROW_D=$(wait_delivery "$EV_D")
read -r DSTATED ATRYD DCODED DERRD <<<"$ROW_D"
if [ "$DSTATED" = "failed" ] && [ "$ATRYD" = "3" ] && [ "$DCODED" = "null" ] \
  && case "$DERRD" in "fetch failed"*) true;; *) false;; esac; then
  ok "D dead-lettered after 3 attempts ($ROW_D)"
else
  bad "D delivery row: $ROW_D (want failed 3 null 'fetch failed')"
fi

# ---------- 8. 回执端点门禁与写入 ----------
GUARD_BAD=$(curl -s -w '%{http_code}' -o /tmp/se-guard-bad.json \
  -X POST "$BASE/api/internal/site-events/deliveries" -H "$(auth)" \
  -H 'Content-Type: application/json' \
  -d '{"eventId":"evt-000000000000000000000000","eventType":"published","hostname":null,"releaseId":null,"siteId":1,"tenantId":999,"webhookUrl":"http://127.0.0.1:1/noop","state":"delivered","attemptCount":1,"lastStatusCode":200,"error":null}')
[ "$GUARD_BAD" = "403" ] && ok "delivery endpoint rejects foreign tenant (403)" \
  || bad "tenant guard code=$GUARD_BAD $(cat /tmp/se-guard-bad.json)"
GUARD_EV=$(event_id_of 1 "rel-guard" published)
GUARD_OK=$(curl -s -w '%{http_code}' -o /tmp/se-guard-ok.json \
  -X POST "$BASE/api/internal/site-events/deliveries" -H "$(auth)" \
  -H 'Content-Type: application/json' \
  -d "{\"eventId\":\"$GUARD_EV\",\"eventType\":\"published\",\"hostname\":\"guard.test\",\"releaseId\":\"rel-guard\",\"siteId\":$SITE_A,\"tenantId\":$TENANT,\"webhookUrl\":\"http://127.0.0.1:1/noop\",\"state\":\"delivered\",\"attemptCount\":1,\"lastStatusCode\":200,\"error\":null}")
[ "$GUARD_OK" = "200" ] && echo "$(cat /tmp/se-guard-ok.json)" | python3 -c 'import json,sys;assert json.load(sys.stdin)=={"recorded":True}' \
  && ok "delivery endpoint records own-tenant receipt (200)" \
  || bad "guard ok code=$GUARD_OK $(cat /tmp/se-guard-ok.json)"

# ---------- 9. canonical 存量回填回归：全库无旧形态 ----------
OLD_SHAPE=$(Q "count(*) FROM geo_foundry.url_records ur
  WHERE ur.canonical_url IS NOT NULL
    AND ur.canonical_url = 'https://' || split_part(ur.canonical_url, '/', 3)
        || '/' || ur.locale || ur.pathname")
[ "$OLD_SHAPE" = "0" ] && ok "no legacy locale-prefixed canonical_url remains" \
  || bad "legacy canonical rows=$OLD_SHAPE"

# ---------- 10. 还原现场 ----------
for ED in "$ED_A1" "$ED_A2" "$ED_B" "$ED_D"; do
  D=$(curl -s -X POST "$BASE/api/editions/$ED/draft-from-published" -b /tmp/se-e.jar \
    -H 'Content-Type: application/json' -d '{"reason":"E2E site events cleanup"}')
  [ "$(st_of "$D")" = "draft" ] || bad "dfp $ED failed: $D"
  S=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/editions/$ED/workflow-transitions" -b /tmp/se-e.jar \
    -H 'Content-Type: application/json' -d '{"target":"archived","reason":"E2E site events cleanup"}')
  [ "$(echo "$S" | tail -1)" = "200" ] || bad "archive $ED code=$(echo "$S" | tail -1)"
done
echo "cleanup: articles archived, fixtures purged by trap"

echo
echo "==== RESULT: ${#PASS[@]} passed, ${#FAIL[@]} failed ===="
[ ${#FAIL[@]} -gt 0 ] && printf 'FAILED: %s\n' "${FAIL[@]}" && exit 1
rm -f /tmp/se-e.jar /tmp/se-r.jar /tmp/se-p.jar /tmp/se-guard-bad.json /tmp/se-guard-ok.json
exit 0
