#!/usr/bin/env bash
# A4 追加/撤下站点 E2E（真实 worker，不经模拟；只动一次性夹具站，不碰业务站）：
#  夹具：租户 413 四个一次性站 A/B/C/D（各带 active canonical 域名 + webhook
#       指向宿主 mock 接收端 /hook/ok，共享一个密钥文件）；
#  文章：X（A 主站 + B）、Y（仅 B）、Z（仅 D）、W（draft，只做负例与权限门禁）。
# 场景：
#  0. 前提（端口/网关/旧夹具）+ 接收端 + 密钥 + 四夹具站。
#  1. X 两站（A+B）真实发布扇出：两站 release current、行 published、URL active、
#     A 站 published 事件 delivered（HMAC 验签）。
#  2. Y 单站（B）发布：B 站 updated 事件。
#  3. Z 单站（D）发布：D 站 published 事件。
#  4. 负例/权限：未认证 401、editor 403 PUBLISHER_REQUIRED、机器身份 403
#     ACTOR_INVALID、draft 追加 409 ADD_NOT_PUBLISHED、draft 撤下 409
#     REMOVE_NOT_PUBLISHED、未分配站撤下 404 REMOVE_NOT_ASSIGNED、
#     不存在的站 404 ADD_SITE_NOT_FOUND、published 文章 assignment sites[]
#     锁 400 EDITION_ASSIGNMENT_SITE_LOCKED。
#  5. 追加 C 到 X：POST /sites → 202（行 pending、URL reserved、版本行
#     sites 扩为 [A,B,C]、幂等键 add-site-…-url-rev-N、pgboss 同任务入队）；
#     重复追加 409 ALREADY_ASSIGNED；真实 worker 评估（LLM 链）→ passed、
#     quality_state passed；publish-operations {siteId:C} 单站发布 → 行
#     published、URL active、C 站 release manifest 含 X 文档、published 事件；
#     再追加 409 ALREADY_PUBLISHED。
#  6. 撤下 B（完整撤下）：DELETE /sites → 202（行 unpublished/releaseId 清空、
#     同一 URL 行转 gone 410 且 revision+1、版本行 sites 缩为 [A,C]、文章级
#     仍 published）；unpublished 事件同事务入队并 delivered（HMAC、
#     releaseId=被撤下的 release）；重发操作（同事务入队）worker 消费 →
#     B 站新 release current（不含 X 文档、含 Y 文档）、旧 release superseded、
#     updated 事件；A/C 站 delivery 不受影响。
#  7. 再追加 B：行复位 pending、同一 URL 行 gone→reserved（revision 再+1）、
#     新幂等键；真实评估 → passed；单站发布 → 行 published、同一 URL 行
#     active、manifest 重新含 X 文档、updated 事件。
#  8. 简单解除分配：追加 D 到 X（从未发布）→ 真实评估 passed → DELETE 直接
#     删行 + 删 reserved URL（publishState=removed、operation=null）。
#  9. 空站撤下：DELETE Z 的 D → D 站空 release 构建成功、指针推进、
#     updated 事件、D 站 delivery 列表 200 totalDocs=0（站点仍可路由）、
#     /api/internal/published-sites 仍含 D（空站不落路由）。
# 收尾：W/X/Y/Z 归档，四夹具站按 id+name 双校验清除，接收端与密钥删除。
# 在 mk-dev 宿主机运行；需要 GF_E2E_EDITOR_PASSWORD / GF_E2E_ROOT_PASSWORD /
# GF_E2E_PUBLISHER_PASSWORD。
set -uo pipefail
BASE=http://127.0.0.1:3090
TENANT=413
HOOK_PORT=18110
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
login gf-editor-test@geo-foundry.dev "$EDPW" /tmp/ar-e.jar
login gf-root-test@geo-foundry.dev "$RTPW" /tmp/ar-r.jar
login e2e-scheduled-publisher@geo-foundry.test "$PBPW" /tmp/ar-p.jar
echo "logins ok"
SKEY=$(sudo python3 -c 'import json;print(json.load(open("/opt/geo-foundry/credentials/content-service-keyring.json"))["tenants"]["413"])')
auth() { echo "Authorization: users API-Key $SKEY"; }

st_of() { echo "$1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["workflowStatus"])'; }
rev_of() { echo "$1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["workflowRevision"])'; }
draft() { curl -s -b /tmp/ar-e.jar "$BASE/api/content-editions/$1?draft=true&depth=0"; }

# ---------- 0. 前提：端口空闲、worker 网关、旧夹具必须为空 ----------
python3 -c 'import socket,sys
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    s.bind(("0.0.0.0", int(sys.argv[1]))); s.close()
except OSError:
    sys.exit(1)' "$HOOK_PORT" \
  && ok "port $HOOK_PORT free" || { bad "port $HOOK_PORT busy"; exit 1; }
GW=$(sudo docker inspect -f '{{range .NetworkSettings.Networks}}{{.Gateway}} {{end}}' \
  geo-foundry-worker-mk-dev 2>/dev/null | awk '{print $1}')
[ -n "$GW" ] && ok "worker gateway=$GW" || { bad "worker container gateway not found"; exit 1; }

OLD_FIXTURES=$(PSQL "SELECT id||': '||name FROM geo_foundry.sites
  WHERE name IN ('E2E A4 SiteA','E2E A4 SiteB','E2E A4 SiteC','E2E A4 SiteD')")
[ -z "$OLD_FIXTURES" ] || { bad "old fixture sites need manual review: $OLD_FIXTURES"; exit 1; }

# ---------- 1. mock 接收端 + 密钥 + 四夹具站 ----------
SECRET="e2e-a4-webhook-secret-$TS"
REF="e2e-a4-secret-$TS"
RECEIPT=/tmp/ar-receipts-$TS.jsonl
RECEIVER=/tmp/ar-receiver-$TS.py
CRED_DIR=$(sudo grep '^GEO_FOUNDRY_CREDENTIALS_DIR=' /opt/geo-foundry/mk-dev.env | cut -d= -f2)
RECEIVER_PID=""
SECRET_FILE=""
SITE_A="" SITE_B="" SITE_C="" SITE_D=""
ED_X="" ED_Y="" ED_Z="" ED_W=""
cleanup() {
  [ -n "$RECEIVER_PID" ] && kill "$RECEIVER_PID" 2>/dev/null
  [ -n "$SECRET_FILE" ] && sudo rm -f "$SECRET_FILE"
}
# 夹具站删除：sites 被 quality_assessments/embeddings/site_event_deliveries/
# url_records/edition_sites/operations/releases/domains 外键引用，必须先删
# 依赖表行（仅按夹具站 id 精确删除）。quality_assessments 的 site_id 是
# NOT NULL + ON DELETE SET NULL——不先删评估行，站点删除必炸。
purge_fixture_site() { # id name
  local S="$1" N="$2"
  [ -n "$S" ] || return 0
  PSQL "DELETE FROM geo_foundry.quality_assessments WHERE site_id=$S" >/dev/null
  PSQL "DELETE FROM geo_foundry.embeddings WHERE site_id=$S" >/dev/null
  PSQL "DELETE FROM geo_foundry.site_event_deliveries WHERE site_id=$S" >/dev/null
  PSQL "DELETE FROM geo_foundry.url_records WHERE site_id=$S" >/dev/null
  PSQL "DELETE FROM geo_foundry.edition_sites WHERE site_id=$S" >/dev/null
  PSQL "DELETE FROM geo_foundry.operations WHERE site_id=$S" >/dev/null
  PSQL "DELETE FROM geo_foundry.releases WHERE site_id=$S" >/dev/null
  PSQL "DELETE FROM geo_foundry.domains WHERE site_id=$S" >/dev/null
  PSQL "DELETE FROM geo_foundry.sites WHERE id=$S AND name='$N'" >/dev/null
}
cleanup_sites() {
  # edition_revisions.site_id 有指向 sites 的硬外键（payload 时代遗留）：
  # 夹具站是文章主站时，删站前必须把夹具文章的版本行 site_id 置空
  # （文章均已归档，置空无副作用；若外键本身是 SET NULL 则此步幂等）。
  local IDS="" E
  for E in "$ED_X" "$ED_Y" "$ED_Z" "$ED_W"; do
    [ -n "$E" ] && IDS="${IDS:+$IDS,}$E"
  done
  [ -n "$IDS" ] && PSQL "UPDATE geo_foundry.edition_revisions SET site_id = NULL WHERE parent_id IN ($IDS)" >/dev/null
  purge_fixture_site "$SITE_A" 'E2E A4 SiteA'
  purge_fixture_site "$SITE_B" 'E2E A4 SiteB'
  purge_fixture_site "$SITE_C" 'E2E A4 SiteC'
  purge_fixture_site "$SITE_D" 'E2E A4 SiteD'
}
trap 'cleanup_sites; cleanup' EXIT

cat > "$RECEIVER" <<'PYEOF'
import hmac, hashlib, json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

receipt, secret, port = sys.argv[1], sys.argv[2], int(sys.argv[3])

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path == "/healthz":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')

    def do_POST(self):
        if self.path == "/healthz":
            self.do_GET()
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
        with open(receipt, "a") as f:
            f.write(json.dumps({
                "event_id_header": self.headers.get("x-geo-foundry-event-id"),
                "signature_ok": hmac.compare_digest(expect, signature),
                "body": body,
            }) + "\n")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

HTTPServer(("0.0.0.0", port), Handler).serve_forever()
PYEOF
python3 "$RECEIVER" "$RECEIPT" "$SECRET" "$HOOK_PORT" &
RECEIVER_PID=$!
UP=0
for i in $(seq 1 10); do
  curl -s -o /dev/null -m 2 http://127.0.0.1:$HOOK_PORT/healthz && { UP=1; break; }
  sleep 1
done
[ "$UP" = "1" ] && ok "mock receiver up (pid=$RECEIVER_PID)" \
  || { bad "mock receiver unreachable"; exit 1; }

SECRET_FILE="$CRED_DIR/$REF"
printf '%s' "$SECRET" | sudo tee "$SECRET_FILE" >/dev/null
sudo chown 1001:1001 "$SECRET_FILE" && sudo chmod 600 "$SECRET_FILE" \
  && ok "secret file provisioned ($REF)" || { bad "secret file provisioning"; exit 1; }

mk_site() { # name domain
  local S
  S=$(PSQL "INSERT INTO geo_foundry.sites (name, tenant_id, locale, timezone, status)
    VALUES ('$1', $TENANT, 'en-US', 'UTC', 'active') RETURNING id")
  [ -n "$S" ] || { bad "fixture $1 insert"; exit 1; }
  PSQL "INSERT INTO geo_foundry.domains (hostname, site_id, tenant_id, role, status)
    VALUES ('$2', $S, $TENANT, 'canonical', 'active')" >/dev/null
  PSQL "UPDATE geo_foundry.sites SET webhook_url='http://$GW:$HOOK_PORT/hook/ok',
    webhook_secret_reference='$REF' WHERE id=$S" >/dev/null
  echo "$S"
}
SITE_A=$(mk_site 'E2E A4 SiteA' "e2e-a4-a-$TS.test")
SITE_B=$(mk_site 'E2E A4 SiteB' "e2e-a4-b-$TS.test")
SITE_C=$(mk_site 'E2E A4 SiteC' "e2e-a4-c-$TS.test")
SITE_D=$(mk_site 'E2E A4 SiteD' "e2e-a4-d-$TS.test")
ok "fixture sites created (A=$SITE_A B=$SITE_B C=$SITE_C D=$SITE_D)"
DOMAIN_A=$(Q "hostname FROM geo_foundry.domains WHERE site_id=$SITE_A")
DOMAIN_B=$(Q "hostname FROM geo_foundry.domains WHERE site_id=$SITE_B")
DOMAIN_C=$(Q "hostname FROM geo_foundry.domains WHERE site_id=$SITE_C")
DOMAIN_D=$(Q "hostname FROM geo_foundry.domains WHERE site_id=$SITE_D")

# ---------- 公共助手 ----------
PREFIX=$(grep '^GEO_FOUNDRY_S3_KEY_PREFIX=' /opt/geo-foundry/mk-dev.env 2>/dev/null | cut -d= -f2)
BUCKET=$(grep '^GEO_FOUNDRY_S3_BUCKET=' /opt/geo-foundry/mk-dev.env 2>/dev/null | cut -d= -f2)
[ -n "$BUCKET" ] || BUCKET=geo-foundry
[ -n "$PREFIX" ] || PREFIX=objects
S3CRED_DIR=$(sudo grep '^GEO_FOUNDRY_CREDENTIALS_DIR=' /opt/geo-foundry/mk-dev.env 2>/dev/null | cut -d= -f2)
s3_get() { # key out-file
  if command -v aws >/dev/null 2>&1; then
    aws s3api get-object --endpoint-url http://127.0.0.1:9000 \
      --bucket "$BUCKET" --key "$1" "$2" >/dev/null 2>&1
  elif [ -n "$S3CRED_DIR" ] && [ -r "/tmp/rp-s3get.py" ]; then
    sudo python3 /tmp/rp-s3get.py "$S3CRED_DIR/s3-access-key" "$S3CRED_DIR/s3-secret-key" \
      "$BUCKET" "$1" > "$2" 2>/dev/null
  else
    return 1
  fi
}

THRESH_HASH=$(python3 -c "import hashlib;print(hashlib.sha256(b'e2e-add-remove-defaults').hexdigest())")
input_hash_of() { curl -s -H "$(auth)" "$BASE/api/internal/editions/$1/input" | python3 -c 'import json,sys;print(json.load(sys.stdin)["inputHash"])'; }
post_assessment() { # $1=edition $2=siteId $3=request-id-tag $4=inputHash
  curl -s -X POST "$BASE/api/internal/editions/$1/assessments" -H "$(auth)" \
    -H 'Content-Type: application/json' -H "x-request-id: $3-$TS" \
    -d "{\"siteId\":$2,\"inputHash\":\"$4\",\"issues\":[],\"modelId\":\"e2e-add-remove\",\"overall\":90,\"dimensions\":{\"content\":90,\"seo\":90,\"structure\":90},\"promptVersion\":\"e2e-1\",\"provider\":\"e2e\",\"state\":\"passed\",\"thresholdsHash\":\"$THRESH_HASH\"}"
}
assess_ok() { [ "$(echo "$1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["assessmentId"]>0)')" = "True" ]; }

# 审批 + 逐站回填 passed 评估（初始发布用回填；A4 新链路的真实 worker 评估
# 只发生在"追加/再追加"触发的 evaluate 操作上）。
make_approved() { # title body summary site [extraSite ...] -> edition id（stdout）
  local TITLE="$1" BODY="$2" SUM="$3" SITEID="$4"; shift 4
  local SITES_JSON="[]"
  if [ $# -gt 0 ]; then
    SITES_JSON=$(printf '%s\n' "$@" | python3 -c 'import sys,json;print(json.dumps([int(x) for x in sys.stdin.read().split() if x]))')
  fi
  local C ED R A IH AS
  C=$(python3 -c 'import json,sys;print(json.dumps({"title":sys.argv[1],"bodyMarkdown":sys.argv[2],"summary":sys.argv[3],"site":int(sys.argv[4]),"sites":json.loads(sys.argv[5])},ensure_ascii=False))' \
    "$TITLE" "$BODY" "$SUM" "$SITEID" "$SITES_JSON" | \
    curl -s -X POST "$BASE/api/content-editions?draft=true&depth=0" -b /tmp/ar-e.jar \
      -H 'Content-Type: application/json' -d @-)
  ED=$(echo "$C" | python3 -c 'import json,sys;print(json.load(sys.stdin)["doc"]["id"])')
  [ -n "$ED" ] || { echo "CREATE_FAILED $C"; return 1; }
  curl -s -o /dev/null -X POST "$BASE/api/editions/$ED/workflow-transitions" -b /tmp/ar-e.jar \
    -H 'Content-Type: application/json' -d '{"target":"review"}'
  R=$(rev_of "$(draft "$ED")")
  A=$(curl -s -X POST "$BASE/api/workspaces/reviewer/editions/$ED/approve" -b /tmp/ar-r.jar \
    -H 'Content-Type: application/json' -H "x-request-id: ar-a-$TS-$ED" \
    -H "idempotency-key: ar-approve-$TS-$ED" -d "{\"expectedRevision\":$R}")
  [ "$(st_of "$A")" = "approved" ] || { echo "APPROVE_FAILED $A"; return 1; }
  IH=$(input_hash_of "$ED")
  for S in "$SITEID" "$@"; do
    AS=$(post_assessment "$ED" "$S" "ar-as-$ED" "$IH")
    assess_ok "$AS" || { echo "ASSESS_FAILED $AS (site $S)"; return 1; }
  done
  echo "$ED"
}

publish_and_wait() { # edition [siteId] -> "opId relId state"（stdout；单站响应形态）
  local ED="$1" BODY="{}"
  [ "${2:-}" != "" ] && BODY="{\"siteId\":$2}"
  local RESP OP REL STATE
  RESP=$(curl -s -X POST "$BASE/api/editions/$ED/publish-operations" -b /tmp/ar-p.jar \
    -H 'Content-Type: application/json' -d "$BODY")
  OP=$(echo "$RESP" | python3 -c '
import json,sys
d=json.load(sys.stdin)
o=d.get("operation") or (d.get("operations") or [{}])[0]
print(o.get("operationId",""))')
  REL=$(echo "$RESP" | python3 -c '
import json,sys
d=json.load(sys.stdin)
o=d.get("operation") or (d.get("operations") or [{}])[0]
print(o.get("releaseId",""))')
  [ -n "$OP" ] || { echo "OP_FAILED $RESP"; return 1; }
  STATE=""
  for i in $(seq 1 40); do
    STATE=$(Q "state FROM geo_foundry.operations WHERE operation_id='$OP'")
    { [ "$STATE" = "succeeded" ] || [ "$STATE" = "failed" ]; } && break
    sleep 3
  done
  echo "$OP $REL $STATE"
}
wait_op() { # opId -> 终态（最长 120s）
  local STATE=""
  for i in $(seq 1 40); do
    STATE=$(Q "state FROM geo_foundry.operations WHERE operation_id='$1'")
    { [ "$STATE" = "succeeded" ] || [ "$STATE" = "failed" ]; } && break
    sleep 3
  done
  echo "$STATE"
}
wait_eval_op() { # opId -> 终态（真实 worker 评估含 LLM，最长 240s）
  local STATE=""
  for i in $(seq 1 80); do
    STATE=$(Q "state FROM geo_foundry.operations WHERE operation_id='$1'")
    { [ "$STATE" = "succeeded" ] || [ "$STATE" = "failed" ]; } && break
    sleep 3
  done
  echo "$STATE"
}
op_err() { Q "coalesce(error->>'code','') FROM geo_foundry.operations WHERE operation_id='$1'"; }

event_id_of() { # siteId releaseId type -> evt-*
  python3 -c 'import hashlib,sys;print("evt-"+hashlib.sha256(
    ("%s|%s|%s" % tuple(sys.argv[1:4])).encode()).hexdigest()[:24])' "$1" "$2" "$3"
}
wait_delivery() { # eventId -> "state attempt last_status last_error"（最长 90s）
  local EV="$1" ROW
  for i in $(seq 1 30); do
    ROW=$(Q "state||' '||attempt_count::text||' '||coalesce(last_status_code::text,'null')||' '||coalesce(last_error,'')
      FROM geo_foundry.site_event_deliveries WHERE event_id='$EV'")
    [ -n "$ROW" ] && break
    sleep 3
  done
  echo "${ROW:-MISSING 0 null }"
}
receipt_of() { # eventId -> 接收端回执 JSON 行
  python3 - "$RECEIPT" "$1" <<'PY'
import json, sys
want = sys.argv[2]
line = ""
for l in open(sys.argv[1]):
    r = json.loads(l)
    if r.get("event_id_header") == want:
        line = l
print(line)
PY
}
verify_receipt() { # eventId releaseId siteId hostname [eventType]
  local R
  R=$(receipt_of "$1")
  [ -n "$R" ] || return 1
  echo "$R" | python3 -c '
import json, sys
r = json.loads(sys.stdin.read())
b = r["body"]
assert r["signature_ok"] is True, "signature mismatch"
assert b["eventId"] == sys.argv[1], "event id"
assert b["releaseId"] == sys.argv[2], "release id"
assert b["siteId"] == int(sys.argv[3]), "site id"
assert b["hostname"] == sys.argv[4], "hostname"
et = sys.argv[5]
if et:
    assert b["eventType"] == et, f"eventType got={b.get(\"eventType\")} want={et}"
for k in ("tenantId","webhookSecretReference","webhookUrl"):
    assert k not in b, f"internal field leaked: {k}"
assert r["event_id_header"] == b["eventId"], "event id header"
' "$1" "$2" "$3" "$4" "${5:-}"
}
delivery_ids() { # domain -> 已发布文章 id 集合（逗号分隔，升序）
  curl -s "$BASE/api/delivery/sites/$1/articles?limit=50" | python3 -c '
import json,sys
d=json.load(sys.stdin)
print(",".join(str(x["id"]) for x in sorted(d.get("docs",[]),key=lambda x:x["id"])))'
}
manifest_check() { # manifest-file pathname has|absent -> ok/FAIL
  python3 - "$1" "$2" "$3" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
paths = {o["path"] for o in d["objects"]}
for req in ("sitemap.xml", "routes.json"):
    assert req in paths, "missing structural %s" % req
want = "pages" + sys.argv[2] + ".json"
if sys.argv[3] == "has":
    assert want in paths, "missing %s" % want
else:
    assert want not in paths, "unexpected %s" % want
for o in d["objects"]:
    assert o.get("path") and o.get("sha256") and o.get("bytes") is not None and o.get("contentType"), o
print("ok")
PY
}

# ---------- 2. X：A 主站 + B，两站真实发布 ----------
ED_X=$(make_approved "E2E A4 追加撤下 X $TS" "A4 追加/撤下站点全链验证正文 X。" "A4 全链验证摘要 X。" "$SITE_A" "$SITE_B")
[ -n "$ED_X" ] && ok "X approved (edition=$ED_X, sites A+B)" || { bad "X prep: $ED_X"; exit 1; }
FX=$(curl -s -X POST "$BASE/api/editions/$ED_X/publish-operations" -b /tmp/ar-p.jar \
  -H 'Content-Type: application/json' -d '{}')
OP_XA=$(echo "$FX" | python3 -c 'import json,sys;d=json.load(sys.stdin);print([o for o in d["operations"] if o["siteId"]=='"$SITE_A"'][0]["operationId"])')
OP_XB=$(echo "$FX" | python3 -c 'import json,sys;d=json.load(sys.stdin);print([o for o in d["operations"] if o["siteId"]=='"$SITE_B"'][0]["operationId"])')
REL_XA=$(echo "$FX" | python3 -c 'import json,sys;d=json.load(sys.stdin);print([o for o in d["operations"] if o["siteId"]=='"$SITE_A"'][0]["releaseId"])')
REL_XB=$(echo "$FX" | python3 -c 'import json,sys;d=json.load(sys.stdin);print([o for o in d["operations"] if o["siteId"]=='"$SITE_B"'][0]["releaseId"])')
ST_XA=$(wait_op "$OP_XA"); ST_XB=$(wait_op "$OP_XB")
[ "$ST_XA" = "succeeded" ] && [ "$ST_XB" = "succeeded" ] \
  && ok "X fanout: both site operations succeeded" \
  || bad "X fanout A=$ST_XA ($(op_err "$OP_XA")) B=$ST_XB ($(op_err "$OP_XB"))"
ROW_XA=$(Q "publish_state||'|'||coalesce(url_record_id is not null::text,'n') FROM geo_foundry.edition_sites WHERE edition_id=$ED_X AND site_id=$SITE_A")
ROW_XB=$(Q "publish_state||'|'||coalesce(url_record_id is not null::text,'n') FROM geo_foundry.edition_sites WHERE edition_id=$ED_X AND site_id=$SITE_B")
[ "$ROW_XA" = "published|t" ] && [ "$ROW_XB" = "published|t" ] \
  && ok "X rows published with urlRecordId (A,B)" || bad "rows A=$ROW_XA B=$ROW_XB"
URL_XB_ID=$(Q "id FROM geo_foundry.url_records WHERE edition_id=$ED_X AND site_id=$SITE_B")
URL_XB_REV0=$(Q "revision FROM geo_foundry.url_records WHERE id=$URL_XB_ID")
[ -n "$URL_XB_ID" ] && ok "X URL row on B (id=$URL_XB_ID rev=$URL_XB_REV0)" || bad "X URL row B missing"
LIST_A=$(delivery_ids "$DOMAIN_A"); LIST_B=$(delivery_ids "$DOMAIN_B")
case ",$LIST_A," in *",$ED_X,"*) ok "delivery A lists X";; *) bad "delivery A=$LIST_A";; esac
case ",$LIST_B," in *",$ED_X,"*) ok "delivery B lists X";; *) bad "delivery B=$LIST_B";; esac
EV_XA=$(event_id_of "$SITE_A" "$REL_XA" published)
DROW=$(wait_delivery "$EV_XA")
case "$DROW" in delivered\ 1\ 200*) ok "X A published event delivered ($DROW)";; *) bad "X A delivery row: $DROW";; esac
verify_receipt "$EV_XA" "$REL_XA" "$SITE_A" "$DOMAIN_A" published \
  && ok "X A receipt verified (HMAC + body)" || bad "X A receipt: $(receipt_of "$EV_XA")"

# ---------- 3. Y：仅 B（撤下后 B 站新 release 必须仍含 Y） ----------
ED_Y=$(make_approved "E2E A4 B 站独占 Y $TS" "A4 撤下 X 后 B 站新 release 必须仍含 Y。" "A4 摘要 Y。" "$SITE_B")
[ -n "$ED_Y" ] && ok "Y approved (edition=$ED_Y, site B)" || { bad "Y prep: $ED_Y"; exit 1; }
read -r OP_Y REL_Y ST_Y <<<"$(publish_and_wait "$ED_Y")"
[ "$ST_Y" = "succeeded" ] && ok "Y publish op succeeded (rel=$REL_Y)" || bad "Y op state=$ST_Y err=$(op_err "$OP_Y")"
LIST_B2=$(delivery_ids "$DOMAIN_B")
case ",$LIST_B2," in *",$ED_Y,"*) ok "delivery B lists Y";; *) bad "delivery B=$LIST_B2";; esac
EV_YB=$(event_id_of "$SITE_B" "$REL_Y" updated)
DROW_Y=$(wait_delivery "$EV_YB")
case "$DROW_Y" in delivered*) ok "Y B updated event delivered ($DROW_Y)";; *) bad "Y B delivery row: $DROW_Y";; esac

# ---------- 4. Z：仅 D（空站撤下用） ----------
ED_Z=$(make_approved "E2E A4 空站撤下 Z $TS" "A4 空站撤下验证正文 Z（D 站唯一文章）。" "A4 摘要 Z。" "$SITE_D")
[ -n "$ED_Z" ] && ok "Z approved (edition=$ED_Z, site D)" || { bad "Z prep: $ED_Z"; exit 1; }
read -r OP_Z REL_Z ST_Z <<<"$(publish_and_wait "$ED_Z")"
[ "$ST_Z" = "succeeded" ] && ok "Z publish op succeeded (rel=$REL_Z)" || bad "Z op state=$ST_Z err=$(op_err "$OP_Z")"
EV_ZD=$(event_id_of "$SITE_D" "$REL_Z" published)
DROW_Z=$(wait_delivery "$EV_ZD")
case "$DROW_Z" in delivered*) ok "Z D published event delivered ($DROW_Z)";; *) bad "Z D delivery row: $DROW_Z";; esac
SLUG_Z=$(Q "pathname FROM geo_foundry.url_records WHERE edition_id=$ED_Z AND site_id=$SITE_D")
[ -n "$SLUG_Z" ] && ok "Z slug on D ($SLUG_Z)" || bad "Z slug missing"

# ---------- 5. W：draft 负例 ----------
W=$(python3 -c 'import json,sys;print(json.dumps({"title":sys.argv[1],"bodyMarkdown":sys.argv[2],"summary":sys.argv[3],"site":int(sys.argv[4])},ensure_ascii=False))' \
  "E2E A4 draft 负例 W $TS" "A4 负例文章 W（保持 draft）。" "A4 摘要 W。" "$SITE_A" | \
  curl -s -X POST "$BASE/api/content-editions?draft=true&depth=0" -b /tmp/ar-e.jar \
    -H 'Content-Type: application/json' -d @-)
ED_W=$(echo "$W" | python3 -c 'import json,sys;print(json.load(sys.stdin)["doc"]["id"])')
[ -n "$ED_W" ] && ok "W draft created (edition=$ED_W)" || { bad "W create $W"; exit 1; }

add_post() { # edition siteId cookie-file [extra-args...] -> "code body"
  local ED="$1" SID="$2" JAR="$3"; shift 3
  curl -s -w '\n%{http_code}' -X POST "$BASE/api/editions/$ED/sites" \
    ${JAR:+-b "$JAR"} -H 'Content-Type: application/json' -d "{\"siteId\":$SID,\"reason\":\"E2E A4 add\"}" "$@"
}
add_code() { echo "$1" | tail -1; }
add_body() { echo "$1" | sed '$d'; }
code_of() { echo "$1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["error"]["code"])'; }

R1=$(add_post "$ED_X" "$SITE_C" "")
[ "$(add_code "$R1")" = "401" ] && [ "$(code_of "$(add_body "$R1")")" = "EDITION_SITE_UNAUTHENTICATED" ] \
  && ok "add unauthenticated -> 401" || bad "add unauth: $R1"
R2=$(add_post "$ED_X" "$SITE_C" /tmp/ar-e.jar)
[ "$(add_code "$R2")" = "403" ] && [ "$(code_of "$(add_body "$R2")")" = "EDITION_WORKFLOW_PUBLISHER_REQUIRED" ] \
  && ok "add as editor -> 403 PUBLISHER_REQUIRED" || bad "add editor: $R2"
R3=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/editions/$ED_X/sites" \
  -H "$(auth)" -H 'Content-Type: application/json' -d "{\"siteId\":$SITE_C}")
[ "$(add_code "$R3")" = "403" ] && [ "$(code_of "$(add_body "$R3")")" = "EDITION_SITE_ACTOR_INVALID" ] \
  && ok "add with machine identity -> 403 ACTOR_INVALID" || bad "add machine: $R3"
R4=$(curl -s -w '\n%{http_code}' -X DELETE "$BASE/api/editions/$ED_X/sites/$SITE_C")
[ "$(add_code "$R4")" = "401" ] \
  && ok "remove unauthenticated -> 401" || bad "remove unauth: $R4"
R5=$(add_post "$ED_W" "$SITE_A" /tmp/ar-p.jar)
[ "$(add_code "$R5")" = "409" ] && [ "$(code_of "$(add_body "$R5")")" = "EDITION_SITE_ADD_NOT_PUBLISHED" ] \
  && ok "add on draft -> 409 ADD_NOT_PUBLISHED" || bad "add draft: $R5"
R6=$(curl -s -w '\n%{http_code}' -X DELETE "$BASE/api/editions/$ED_W/sites/$SITE_A" \
  -b /tmp/ar-p.jar -H 'Content-Type: application/json' -d '{"reason":"E2E A4"}')
[ "$(add_code "$R6")" = "409" ] && [ "$(code_of "$(add_body "$R6")")" = "EDITION_SITE_REMOVE_NOT_PUBLISHED" ] \
  && ok "remove on draft -> 409 REMOVE_NOT_PUBLISHED" || bad "remove draft: $R6"
R7=$(curl -s -w '\n%{http_code}' -X DELETE "$BASE/api/editions/$ED_X/sites/$SITE_C" \
  -b /tmp/ar-p.jar -H 'Content-Type: application/json' -d '{"reason":"E2E A4"}')
[ "$(add_code "$R7")" = "404" ] && [ "$(code_of "$(add_body "$R7")")" = "EDITION_SITE_REMOVE_NOT_ASSIGNED" ] \
  && ok "remove unassigned site -> 404 REMOVE_NOT_ASSIGNED" || bad "remove unassigned: $R7"
R8=$(add_post "$ED_X" 999999 /tmp/ar-p.jar)
[ "$(add_code "$R8")" = "404" ] && [ "$(code_of "$(add_body "$R8")")" = "EDITION_SITE_ADD_SITE_NOT_FOUND" ] \
  && ok "add nonexistent site -> 404 ADD_SITE_NOT_FOUND" || bad "add missing site: $R8"
R9=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/editions/$ED_X/assignment" \
  -b /tmp/ar-e.jar -H 'Content-Type: application/json' -d "{\"sites\":[$SITE_A]}")
[ "$(add_code "$R9")" = "400" ] && [ "$(code_of "$(add_body "$R9")")" = "EDITION_ASSIGNMENT_SITE_LOCKED" ] \
  && ok "assignment sites[] on published -> 400 SITE_LOCKED" || bad "assignment lock: $R9"

# ---------- 6. 追加 C 到 X（真实 worker 评估 + 单站发布） ----------
ADDC=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/editions/$ED_X/sites" \
  -b /tmp/ar-p.jar -H 'Content-Type: application/json' \
  -d "{\"siteId\":$SITE_C,\"reason\":\"E2E A4 add C\"}")
ADDC_CODE=$(add_code "$ADDC"); ADDC_BODY=$(add_body "$ADDC")
[ "$ADDC_CODE" = "202" ] && echo "$ADDC_BODY" | python3 -c '
import json, sys
d = json.load(sys.stdin)
assert d["created"] is True and d["siteId"] == '"$SITE_C"', d
assert d["operation"]["operationType"] == "evaluate" and d["operation"]["state"] == "queued", d
' && ok "add C -> 202 queued evaluate op" || bad "add C: $ADDC"
OP_ADD_C=$(echo "$ADDC_BODY" | python3 -c 'import json,sys;print(json.load(sys.stdin)["operation"]["operationId"])')
ROW_C=$(Q "publish_state||'|'||quality_state FROM geo_foundry.edition_sites WHERE edition_id=$ED_X AND site_id=$SITE_C")
[ "$ROW_C" = "pending|pending" ] && ok "row (X,C) pending/pending" || bad "rowC=$ROW_C"
RESV_C=$(Q "count(*) FROM geo_foundry.url_records WHERE edition_id=$ED_X AND site_id=$SITE_C AND state='reserved'")
[ "$RESV_C" = "1" ] && ok "URL reserved for C" || bad "reserved C=$RESV_C"
VER_SITES=$(Q "array_to_string(sites, ',') FROM geo_foundry.edition_revisions WHERE parent_id=$ED_X AND latest=true")
[ "$VER_SITES" = "$SITE_A,$SITE_B,$SITE_C" ] \
  && ok "version sites expanded to A,B,C ($VER_SITES)" || bad "version sites=$VER_SITES"
URL_C_REV=$(Q "revision FROM geo_foundry.url_records WHERE edition_id=$ED_X AND site_id=$SITE_C")
KEY_ADD_C=$(Q "idempotency_key FROM geo_foundry.idempotency_records WHERE operation_id='$OP_ADD_C'")
[ "$KEY_ADD_C" = "add-site-$ED_X-$SITE_C-url-rev-$URL_C_REV" ] \
  && ok "idempotency key URL-revision scoped ($KEY_ADD_C)" || bad "key=$KEY_ADD_C want=add-site-$ED_X-$SITE_C-url-rev-$URL_C_REV"
JOB_ADD=$(Q "count(*) FROM pgboss.job WHERE singleton_key='$OP_ADD_C'")
[ "$JOB_ADD" -ge 1 ] && ok "evaluate job enqueued (pgboss)" || bad "evaluate job=$JOB_ADD"
R10=$(add_post "$ED_X" "$SITE_C" /tmp/ar-p.jar)
[ "$(add_code "$R10")" = "409" ] && [ "$(code_of "$(add_body "$R10")")" = "EDITION_SITE_ADD_ALREADY_ASSIGNED" ] \
  && ok "duplicate add while pending -> 409 ALREADY_ASSIGNED" || bad "dup add: $R10"

ST_EVAL_C=$(wait_eval_op "$OP_ADD_C")
if [ "$ST_EVAL_C" = "succeeded" ]; then ok "C real-worker evaluation succeeded"
else ERR=$(op_err "$OP_ADD_C"); bad "C eval state=$ST_EVAL_C error=$ERR"; fi
QA_C=$(Q "count(*) FROM geo_foundry.quality_assessments WHERE edition_id=$ED_X AND site_id=$SITE_C AND state='passed'")
QC_C=$(Q "quality_state FROM geo_foundry.edition_sites WHERE edition_id=$ED_X AND site_id=$SITE_C")
[ "$QA_C" -ge 1 ] && [ "$QC_C" = "passed" ] \
  && ok "C assessment row + quality_state=passed" || bad "C assessment qa=$QA_C qs=$QC_C"

read -r OP_PUB_C REL_PC ST_PC <<<"$(publish_and_wait "$ED_X" "$SITE_C")"
[ "$ST_PC" = "succeeded" ] && ok "C single-site publish succeeded (rel=$REL_PC)" \
  || bad "C publish state=$ST_PC err=$(op_err "$OP_PUB_C")"
ROW_PC=$(Q "publish_state||'|'||coalesce(release_id,'')||'|'||coalesce(url_record_id is not null::text,'n') FROM geo_foundry.edition_sites WHERE edition_id=$ED_X AND site_id=$SITE_C")
[ "$ROW_PC" = "published|$REL_PC|t" ] && ok "row (X,C) published with release+url" || bad "rowC=$ROW_PC"
URL_C_ST=$(Q "state FROM geo_foundry.url_records WHERE edition_id=$ED_X AND site_id=$SITE_C")
[ "$URL_C_ST" = "active" ] && ok "URL C active" || bad "urlC=$URL_C_ST"
SLUG_X=$(Q "pathname FROM geo_foundry.url_records WHERE edition_id=$ED_X AND site_id=$SITE_C")
if s3_get "$PREFIX/sites/site-$SITE_C/releases/$REL_PC/manifest.json" /tmp/ar-man-c.json; then
  MC=$(manifest_check /tmp/ar-man-c.json "$SLUG_X" has)
  [ "$MC" = "ok" ] && ok "C manifest contains X doc ($SLUG_X)" || bad "C manifest check: $MC"
else
  bad "C manifest fetch failed (S3 reader)"
fi
EV_PC=$(event_id_of "$SITE_C" "$REL_PC" published)
DROW_PC=$(wait_delivery "$EV_PC")
case "$DROW_PC" in delivered*) ok "C published event delivered ($DROW_PC)";; *) bad "C delivery row: $DROW_PC";; esac
verify_receipt "$EV_PC" "$REL_PC" "$SITE_C" "$DOMAIN_C" published \
  && ok "C receipt verified (HMAC + body)" || bad "C receipt: $(receipt_of "$EV_PC")"
R11=$(add_post "$ED_X" "$SITE_C" /tmp/ar-p.jar)
[ "$(add_code "$R11")" = "409" ] && [ "$(code_of "$(add_body "$R11")")" = "EDITION_SITE_ADD_ALREADY_PUBLISHED" ] \
  && ok "add already-published site -> 409 ALREADY_PUBLISHED" || bad "add published: $R11"

# ---------- 7. 撤下 B（完整撤下 + 同事务重发 + unpublished 事件） ----------
TAKEDOWN=$(curl -s -w '\n%{http_code}' -X DELETE "$BASE/api/editions/$ED_X/sites/$SITE_B" \
  -b /tmp/ar-p.jar -H 'Content-Type: application/json' -d '{"reason":"E2E A4 takedown B"}')
TD_CODE=$(add_code "$TAKEDOWN"); TD_BODY=$(add_body "$TAKEDOWN")
[ "$TD_CODE" = "202" ] && echo "$TD_BODY" | python3 -c '
import json, sys
d = json.load(sys.stdin)
assert d["publishState"] == "unpublished", d
assert d["operation"]["operationType"] == "publish" and d["operation"]["state"] == "queued", d
assert d["releaseId"].startswith("rel-"), d
' && ok "takedown B -> 202 (unpublished + re-release queued)" || bad "takedown: $TAKEDOWN"
OP_RR=$(echo "$TD_BODY" | python3 -c 'import json,sys;print(json.load(sys.stdin)["operation"]["operationId"])')
REL_RR=$(echo "$TD_BODY" | python3 -c 'import json,sys;print(json.load(sys.stdin)["releaseId"])')

# 同步段断言（撤下提交后立即生效，不等 worker）
ROW_B=$(Q "publish_state||'|'||coalesce(release_id,'')||'|'||coalesce(url_record_id,'')||'|'||quality_state FROM geo_foundry.edition_sites WHERE edition_id=$ED_X AND site_id=$SITE_B")
[ "$ROW_B" = "unpublished|||pending" ] \
  && ok "row (X,B) unpublished with release/url cleared" || bad "rowB=$ROW_B"
URLB=$(Q "id||'|'||state||'|'||coalesce(status_code::text,'null')||'|'||revision FROM geo_foundry.url_records WHERE id=$URL_XB_ID")
[ "$URLB" = "$URL_XB_ID|gone|410|$((URL_XB_REV0 + 1))" ] \
  && ok "X URL on B: same row -> gone 410 rev+1 ($URLB)" || bad "urlB=$URLB want=$URL_XB_ID|gone|410|$((URL_XB_REV0+1))"
VER_SITES2=$(Q "array_to_string(sites, ',') FROM geo_foundry.edition_revisions WHERE parent_id=$ED_X AND latest=true")
[ "$VER_SITES2" = "$SITE_A,$SITE_C" ] \
  && ok "version sites shrank to A,C" || bad "version sites=$VER_SITES2"
ST_X_ST=$(Q "workflow_status FROM geo_foundry.content_editions WHERE id=$ED_X")
[ "$ST_X_ST" = "published" ] && ok "article X stays published (takedown is per-site)" || bad "X status=$ST_X_ST"
LIST_A2=$(delivery_ids "$DOMAIN_A"); LIST_B3=$(delivery_ids "$DOMAIN_B"); LIST_C2=$(delivery_ids "$DOMAIN_C")
case ",$LIST_A2," in *",$ED_X,"*) ok "delivery A still lists X";; *) bad "delivery A=$LIST_A2";; esac
case ",$LIST_B3," in *",$ED_X,"*) bad "delivery B still lists X ($LIST_B3)";; *) ok "delivery B no longer lists X";; esac
case ",$LIST_B3," in *",$ED_Y,"*) ok "delivery B still lists Y";; *) bad "delivery B lost Y: $LIST_B3";; esac
case ",$LIST_C2," in *",$ED_X,"*) ok "delivery C still lists X";; *) bad "delivery C=$LIST_C2";; esac

# unpublished 事件：撤下同事务入队（提交后立即可见），worker 投递 + HMAC
EV_UNPUB=$(event_id_of "$SITE_B" "$REL_XB" unpublished)
JOB_UNPUB=$(Q "count(*) FROM pgboss.job WHERE singleton_key='$EV_UNPUB'")
[ "$JOB_UNPUB" -ge 1 ] && ok "unpublished job same-tx enqueued" || bad "unpublished job=$JOB_UNPUB"
DROW_UNPUB=$(wait_delivery "$EV_UNPUB")
case "$DROW_UNPUB" in delivered*) ok "B unpublished event delivered ($DROW_UNPUB)";; *) bad "B unpublished row: $DROW_UNPUB";; esac
verify_receipt "$EV_UNPUB" "$REL_XB" "$SITE_B" "$DOMAIN_B" unpublished \
  && ok "B unpublished receipt verified (releaseId=removed release)" \
  || bad "B unpublished receipt: $(receipt_of "$EV_UNPUB")"

# 重发操作：worker 编译 B 站新快照（不含 X，含 Y）并登记新 release
ST_RR=$(wait_op "$OP_RR")
if [ "$ST_RR" = "succeeded" ]; then ok "B re-release operation succeeded"
else ERR=$(op_err "$OP_RR"); bad "B re-release state=$ST_RR error=$ERR"; fi
REL_STATE_NEW=$(Q "state FROM geo_foundry.releases WHERE release_id='$REL_RR'")
REL_STATE_OLD=$(Q "state FROM geo_foundry.releases WHERE release_id='$REL_XB'")
[ "$REL_STATE_NEW" = "current" ] && [ "$REL_STATE_OLD" = "superseded" ] \
  && ok "B release pointer advanced ($REL_RR current, $REL_XB superseded)" \
  || bad "rel states new=$REL_STATE_NEW old=$REL_STATE_OLD"
if s3_get "$PREFIX/sites/site-$SITE_B/releases/$REL_RR/manifest.json" /tmp/ar-man-b.json; then
  MB1=$(manifest_check /tmp/ar-man-b.json "$SLUG_X" absent)
  SLUG_Y=$(Q "pathname FROM geo_foundry.url_records WHERE edition_id=$ED_Y AND site_id=$SITE_B")
  MB2=$(manifest_check /tmp/ar-man-b.json "$SLUG_Y" has)
  [ "$MB1" = "ok" ] && ok "B new release excludes X doc" || bad "B manifest still has X: $MB1"
  [ "$MB2" = "ok" ] && ok "B new release still includes Y doc" || bad "B manifest lost Y: $MB2"
else
  bad "B re-release manifest fetch failed (S3 reader)"
fi
EV_UPB=$(event_id_of "$SITE_B" "$REL_RR" updated)
DROW_UPB=$(wait_delivery "$EV_UPB")
case "$DROW_UPB" in delivered*) ok "B updated event (re-release) delivered ($DROW_UPB)";; *) bad "B updated row: $DROW_UPB";; esac
verify_receipt "$EV_UPB" "$REL_RR" "$SITE_B" "$DOMAIN_B" updated \
  && ok "B re-release receipt verified" || bad "B re-release receipt: $(receipt_of "$EV_UPB")"

# ---------- 8. 再追加 B（gone URL 复用 + 新评估周期） ----------
READD=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/editions/$ED_X/sites" \
  -b /tmp/ar-p.jar -H 'Content-Type: application/json' \
  -d "{\"siteId\":$SITE_B,\"reason\":\"E2E A4 re-add B\"}")
RA_CODE=$(add_code "$READD")
[ "$RA_CODE" = "202" ] && ok "re-add B -> 202" || bad "re-add B: $READD"
OP_RADD=$(echo "$READD" | sed '$d' | python3 -c 'import json,sys;print(json.load(sys.stdin)["operation"]["operationId"])')
ROW_RB=$(Q "publish_state||'|'||coalesce(release_id,'')||'|'||quality_state FROM geo_foundry.edition_sites WHERE edition_id=$ED_X AND site_id=$SITE_B")
[ "$ROW_RB" = "pending||pending" ] && ok "row (X,B) reset to pending/pending" || bad "rowB=$ROW_RB"
URLB2=$(Q "id||'|'||state||'|'||coalesce(status_code::text,'null')||'|'||revision FROM geo_foundry.url_records WHERE id=$URL_XB_ID")
[ "$URLB2" = "$URL_XB_ID|reserved|null|$((URL_XB_REV0 + 2))" ] \
  && ok "X URL on B: same row gone->reserved rev+1" || bad "urlB2=$URLB2 want=$URL_XB_ID|reserved|null|$((URL_XB_REV0+2))"
KEY_RADD=$(Q "idempotency_key FROM geo_foundry.idempotency_records WHERE operation_id='$OP_RADD'")
[ "$KEY_RADD" = "add-site-$ED_X-$SITE_B-url-rev-$((URL_XB_REV0 + 2))" ] \
  && ok "re-add idempotency key fresh (url-rev bumped)" || bad "key=$KEY_RADD"
ST_EVAL_B=$(wait_eval_op "$OP_RADD")
if [ "$ST_EVAL_B" = "succeeded" ]; then ok "B re-add real-worker evaluation succeeded"
else ERR=$(op_err "$OP_RADD"); bad "B re-add eval state=$ST_EVAL_B error=$ERR"; fi
QC_B=$(Q "quality_state FROM geo_foundry.edition_sites WHERE edition_id=$ED_X AND site_id=$SITE_B")
[ "$QC_B" = "passed" ] && ok "B quality_state=passed after re-eval" || bad "B qs=$QC_B"
read -r OP_PUB_B REL_PB ST_PB <<<"$(publish_and_wait "$ED_X" "$SITE_B")"
[ "$ST_PB" = "succeeded" ] && ok "B republish succeeded (rel=$REL_PB)" || bad "B republish state=$ST_PB err=$(op_err "$OP_PUB_B")"
ROW_PB=$(Q "publish_state||'|'||coalesce(release_id,'') FROM geo_foundry.edition_sites WHERE edition_id=$ED_X AND site_id=$SITE_B")
[ "$ROW_PB" = "published|$REL_PB" ] && ok "row (X,B) published again" || bad "rowB=$ROW_PB"
URLB3=$(Q "id||'|'||state||'|'||revision FROM geo_foundry.url_records WHERE id=$URL_XB_ID")
[ "$URLB3" = "$URL_XB_ID|active|$((URL_XB_REV0 + 3))" ] \
  && ok "X URL on B: same row back to active (rev+3 total)" || bad "urlB3=$URLB3"
if s3_get "$PREFIX/sites/site-$SITE_B/releases/$REL_PB/manifest.json" /tmp/ar-man-b2.json; then
  MB3=$(manifest_check /tmp/ar-man-b2.json "$SLUG_X" has)
  [ "$MB3" = "ok" ] && ok "B manifest contains X doc again after re-add" || bad "B re-add manifest: $MB3"
else
  bad "B re-add manifest fetch failed (S3 reader)"
fi
EV_UPB2=$(event_id_of "$SITE_B" "$REL_PB" updated)
DROW_UPB2=$(wait_delivery "$EV_UPB2")
case "$DROW_UPB2" in delivered*) ok "B updated event (re-add publish) delivered ($DROW_UPB2)";; *) bad "B updated2 row: $DROW_UPB2";; esac

# ---------- 9. 简单解除分配（从未发布的行直接删） ----------
ADDD=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/editions/$ED_X/sites" \
  -b /tmp/ar-p.jar -H 'Content-Type: application/json' \
  -d "{\"siteId\":$SITE_D,\"reason\":\"E2E A4 add D (will unassign)\"}")
[ "$(add_code "$ADDD")" = "202" ] && ok "add D to X -> 202" || bad "add D: $ADDD"
OP_ADD_D=$(echo "$ADDD" | sed '$d' | python3 -c 'import json,sys;print(json.load(sys.stdin)["operation"]["operationId"])')
ST_EVAL_D=$(wait_eval_op "$OP_ADD_D")
if [ "$ST_EVAL_D" = "succeeded" ]; then ok "D real-worker evaluation succeeded"
else ERR=$(op_err "$OP_ADD_D"); bad "D eval state=$ST_EVAL_D error=$ERR"; fi
UNASSIGN=$(curl -s -w '\n%{http_code}' -X DELETE "$BASE/api/editions/$ED_X/sites/$SITE_D" \
  -b /tmp/ar-p.jar -H 'Content-Type: application/json' -d '{"reason":"E2E A4 unassign D"}')
UA_CODE=$(add_code "$UNASSIGN"); UA_BODY=$(add_body "$UNASSIGN")
[ "$UA_CODE" = "200" ] && echo "$UA_BODY" | python3 -c '
import json, sys
d = json.load(sys.stdin)
assert d["publishState"] == "removed" and d["operation"] is None and d["releaseId"] is None, d
' && ok "unassign D -> 200 removed (no re-release)" || bad "unassign: $UNASSIGN"
ROW_D=$(Q "count(*) FROM geo_foundry.edition_sites WHERE edition_id=$ED_X AND site_id=$SITE_D")
URLD=$(Q "count(*) FROM geo_foundry.url_records WHERE edition_id=$ED_X AND site_id=$SITE_D")
[ "$ROW_D" = "0" ] && [ "$URLD" = "0" ] \
  && ok "row (X,D) + reserved URL removed" || bad "rowD=$ROW_D urlD=$URLD"
VER_SITES3=$(Q "array_to_string(sites, ',') FROM geo_foundry.edition_revisions WHERE parent_id=$ED_X AND latest=true")
[ "$VER_SITES3" = "$SITE_A,$SITE_C,$SITE_B" ] \
  && ok "version sites back to A,C,B" || bad "version sites=$VER_SITES3"

# ---------- 10. 空站撤下（D 站唯一文章 Z 撤下 → 空 release） ----------
TD2=$(curl -s -w '\n%{http_code}' -X DELETE "$BASE/api/editions/$ED_Z/sites/$SITE_D" \
  -b /tmp/ar-p.jar -H 'Content-Type: application/json' -d '{"reason":"E2E A4 takedown D (empty site)"}')
[ "$(add_code "$TD2")" = "202" ] && ok "takedown D -> 202" || bad "takedown D: $TD2"
OP_RR2=$(echo "$TD2" | sed '$d' | python3 -c 'import json,sys;print(json.load(sys.stdin)["operation"]["operationId"])')
REL_RR2=$(echo "$TD2" | sed '$d' | python3 -c 'import json,sys;print(json.load(sys.stdin)["releaseId"])')
ROW_ZD=$(Q "publish_state||'|'||coalesce(release_id,'') FROM geo_foundry.edition_sites WHERE edition_id=$ED_Z AND site_id=$SITE_D")
[ "$ROW_ZD" = "unpublished|" ] && ok "row (Z,D) unpublished" || bad "rowZD=$ROW_ZD"
URL_ZD=$(Q "state||'|'||coalesce(status_code::text,'null') FROM geo_foundry.url_records WHERE edition_id=$ED_Z AND site_id=$SITE_D")
[ "$URL_ZD" = "gone|410" ] && ok "Z URL on D gone 410" || bad "urlZD=$URL_ZD"
ST_Z_ST=$(Q "workflow_status FROM geo_foundry.content_editions WHERE id=$ED_Z")
[ "$ST_Z_ST" = "published" ] && ok "article Z stays published (site-level takedown)" || bad "Z status=$ST_Z_ST"
ST_RR2=$(wait_op "$OP_RR2")
if [ "$ST_RR2" = "succeeded" ]; then ok "D empty re-release operation succeeded"
else ERR=$(op_err "$OP_RR2"); bad "D re-release state=$ST_RR2 error=$ERR"; fi
REL_STATE_D2=$(Q "state FROM geo_foundry.releases WHERE release_id='$REL_RR2'")
REL_STATE_DOLD=$(Q "state FROM geo_foundry.releases WHERE release_id='$REL_Z'")
[ "$REL_STATE_D2" = "current" ] && [ "$REL_STATE_DOLD" = "superseded" ] \
  && ok "D empty release current, old superseded" || bad "D rel states new=$REL_STATE_D2 old=$REL_STATE_DOLD"
if s3_get "$PREFIX/sites/site-$SITE_D/releases/$REL_RR2/manifest.json" /tmp/ar-man-d.json; then
  MD=$(manifest_check /tmp/ar-man-d.json "$SLUG_Z" absent)
  [ "$MD" = "ok" ] && ok "D empty release: Z doc absent, structural objects intact" || bad "D manifest: $MD"
else
  bad "D empty release manifest fetch failed (S3 reader)"
fi
EV_UPD=$(event_id_of "$SITE_D" "$REL_RR2" updated)
DROW_UPD=$(wait_delivery "$EV_UPD")
case "$DROW_UPD" in delivered*) ok "D updated event (empty re-release) delivered ($DROW_UPD)";; *) bad "D updated row: $DROW_UPD";; esac
DL_D=$(curl -s -w '\n%{http_code}' "$BASE/api/delivery/sites/$DOMAIN_D/articles?limit=50")
DL_D_CODE=$(add_code "$DL_D")
[ "$DL_D_CODE" = "200" ] && echo "$(add_body "$DL_D")" | python3 -c '
import json, sys
d = json.load(sys.stdin)
assert d["totalDocs"] == 0 and d["docs"] == [], d
' && ok "empty site D still routable: delivery list 200 totalDocs=0" \
  || bad "D delivery code=$DL_D_CODE body=$(add_body "$DL_D")"
DL_Z=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/delivery/articles/$ED_Z")
[ "$DL_Z" = "404" ] && ok "delivery detail for Z -> 404 (no published site row)" || bad "Z delivery code=$DL_Z"
PUB_SITES=$(curl -s -H "$(auth)" "$BASE/api/internal/published-sites" | python3 -c '
import json, sys
d = json.load(sys.stdin)
print(",".join(sorted(s["canonicalDomain"] for s in d["sites"])))')
case ",$PUB_SITES," in
  *",$DOMAIN_D,"*) ok "internal published-sites still lists empty site D" ;;
  *) bad "published-sites missing D: $PUB_SITES";;
esac
case ",$PUB_SITES," in
  *",$DOMAIN_A,"*) ok "internal published-sites lists A" ;;
  *) bad "published-sites missing A: $PUB_SITES";;
esac

# ---------- 11. 还原现场 ----------
S_W=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/editions/$ED_W/workflow-transitions" -b /tmp/ar-e.jar \
  -H 'Content-Type: application/json' -d '{"target":"archived","reason":"E2E A4 cleanup"}')
[ "$(add_code "$S_W")" = "200" ] && ok "W -> archived" || bad "W archive $(echo "$S_W"|tail -1)"
for ED in "$ED_X" "$ED_Y" "$ED_Z"; do
  D=$(curl -s -X POST "$BASE/api/editions/$ED/draft-from-published" -b /tmp/ar-e.jar \
    -H 'Content-Type: application/json' -d '{"reason":"E2E A4 cleanup"}')
  [ "$(st_of "$D")" = "draft" ] || { bad "dfp $ED failed: $D"; continue; }
  S=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/editions/$ED/workflow-transitions" -b /tmp/ar-e.jar \
    -H 'Content-Type: application/json' -d '{"target":"archived","reason":"E2E A4 cleanup"}')
  [ "$(add_code "$S")" = "200" ] && ok "$ED -> archived" || bad "archive $ED code=$(add_code "$S")"
done
cleanup_sites
FINAL=$(Q "count(*) FROM geo_foundry.sites WHERE id IN ($SITE_A,$SITE_B,$SITE_C,$SITE_D)")
[ "$FINAL" = "0" ] && ok "fixture sites removed" || bad "fixture sites remain: $FINAL"

rm -f /tmp/ar-e.jar /tmp/ar-r.jar /tmp/ar-p.jar /tmp/ar-man-*.json
echo
echo "==== RESULT: ${#PASS[@]} passed, ${#FAIL[@]} failed ===="
[ ${#FAIL[@]} -gt 0 ] && printf 'FAILED: %s\n' "${FAIL[@]}" && exit 1
exit 0
