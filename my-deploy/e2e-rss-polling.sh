#!/usr/bin/env bash
# RSS connector 轮询全链路 E2E（Drizzle 版，替代已删除的 verify-rss-polling.mjs）：
# 无 endpoint 跳过退避 → 有 endpoint 建/复位父 intake + 入队 → fetching 中不重复
# → 手工模拟 worker fetch 完成（start/input/complete）→ rss-entries 子项去重
# → 下轮复位。依赖 CMS 后台每分钟的轮询定时器。在 mk-dev 宿主机运行。
set -uo pipefail
BASE=http://127.0.0.1:3090
SITE=374
TS=$(date +%s)
PASS=(); FAIL=()
ok() { PASS+=("$1"); echo "PASS: $1"; }
bad() { FAIL+=("$1"); echo "FAIL: $1"; }

PSQL() { sudo docker exec pg-server psql -U gpucloud -d geo_foundry -qAt -c "$1"; }
Q() { PSQL "SELECT $1"; }
SKEY=$(sudo python3 -c 'import json;print(json.load(open("/opt/geo-foundry/credentials/content-service-keyring.json"))["tenants"]["413"])')
auth() { echo "Authorization: users API-Key $SKEY"; }
wait_tick() { echo "… waiting 75s for poll timer"; sleep 75; }
cleanup() {
  PSQL "UPDATE geo_foundry.connectors SET status='disabled' WHERE id IN ($CID_X,$CID_Y)" >/dev/null
  PSQL "UPDATE geo_foundry.intake_items SET status='ignored' WHERE connector_id IN ($CID_X,$CID_Y)" >/dev/null
}
trap cleanup EXIT

# ---------- 0. 建 connector：X 无 endpoint，Y 有 endpoint ----------
CID_X=$(PSQL "INSERT INTO geo_foundry.connectors (name,type,status,site_id,tenant_id,source_endpoint) VALUES ('e2e-rss-none-$TS','rss','active',$SITE,413,NULL) RETURNING id")
CID_Y=$(PSQL "INSERT INTO geo_foundry.connectors (name,type,status,site_id,tenant_id,source_endpoint) VALUES ('e2e-rss-feed-$TS','rss','active',$SITE,413,'https://example.com/feed-$TS.xml') RETURNING id")
[ -n "$CID_X" ] && [ -n "$CID_Y" ] && ok "connectors created ($CID_X,$CID_Y)" || { bad "insert connectors"; exit 1; }

# ---------- 1. tick1：X 跳过并退避，Y 建父稿并入队 ----------
wait_tick
LX=$(Q "(last_polled_at IS NOT NULL) FROM geo_foundry.connectors WHERE id=$CID_X")
PX=$(Q "count(*) FROM geo_foundry.intake_items WHERE connector_id=$CID_X")
[ "$LX" = "t" ] && [ "$PX" = "0" ] && ok "no-endpoint connector skipped + backed off" || bad "X polled=$LX parent=$PX"
PY=$(Q "id||'|'||status FROM geo_foundry.intake_items WHERE connector_id=$CID_Y AND channel='rss' ORDER BY id DESC LIMIT 1")
PID=${PY%%|*}; PST=${PY##*|}
[ -n "$PID" ] && [ "$PST" = "fetching" ] && ok "parent intake created -> fetching (id=$PID)" || bad "parent=$PY"
JOB=$(sudo docker exec redis-server redis-cli --no-auth-warning EXISTS "geo-foundry:content-intake:intake-$PID" 2>/dev/null || echo na)
[ "$JOB" = "1" ] && ok "intake job enqueued (jobId intake-$PID)" || echo "note: intake job key not found ($JOB), continuing"

# ---------- 2. tick2：parent fetching 中不重复 ----------
PSQL "UPDATE geo_foundry.connectors SET last_polled_at = now() - interval '2 hours' WHERE id=$CID_Y" >/dev/null
wait_tick
PY2=$(Q "status FROM geo_foundry.intake_items WHERE id=$PID")
PNEWS=$(Q "count(*) FROM geo_foundry.intake_items WHERE connector_id=$CID_Y AND channel='rss'")
[ "$PY2" = "fetching" ] && [ "$PNEWS" = "1" ] && ok "in-flight parent not duplicated" || bad "tick2 status=$PY2 parents=$PNEWS"

# ---------- 3. 模拟 worker 完成 fetch ----------
S=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/internal/intake-items/$PID/fetch-start" -H "$(auth)" \
  -H 'Content-Type: application/json' -d '{}')
[ "$(echo "$S" | tail -1)" = "200" ] && ok "fetch-start idempotent 200" || bad "fetch-start $(echo "$S"|tail -2)"
IN=$(curl -s -H "$(auth)" "$BASE/api/internal/intake-items/$PID/fetch-input")
echo "$IN" | python3 -c '
import json,sys
d=json.load(sys.stdin)
assert d["channel"]=="rss" and d["sourceUrl"]=="https://example.com/feed-'"$TS"'.xml", d' \
  && ok "fetch-input returns connector endpoint" || bad "fetch-input $IN"
CMP="{\"extracted\":{\"contentHash\":\"$(python3 -c 'import hashlib;print(hashlib.sha256(b"e2e-rss-'"$TS"'").hexdigest())')\",\"contentLength\":120,\"contentType\":\"application/rss+xml\",\"storageKey\":\"objects/e2e/rss-extracted-$TS\"},\"intakeItemId\":$PID,\"raw\":{\"contentHash\":\"$(python3 -c 'import hashlib;print(hashlib.sha256(b"e2e-rss-raw-'"$TS"'").hexdigest())')\",\"contentLength\":600,\"contentType\":\"application/xml\",\"storageKey\":\"objects/e2e/rss-raw-$TS\"},\"summary\":\"E2E RSS feed summary\",\"title\":\"RSS: e2e-rss-feed-$TS\"}"
S=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/internal/intake-items/$PID/fetch-complete" -H "$(auth)" \
  -H 'Content-Type: application/json' -d "$CMP")
PST2=$(Q "status FROM geo_foundry.intake_items WHERE id=$PID")
SNAP=$(Q "count(*) FROM geo_foundry.source_snapshots WHERE intake_item_id=$PID")
[ "$(echo "$S" | tail -1)" = "200" ] && [ "$PST2" = "ready" ] && [ "$SNAP" = "2" ] \
  && ok "fetch-complete -> ready + 2 snapshots" || bad "complete $(echo "$S"|tail -2) status=$PST2 snaps=$SNAP"

# ---------- 4. rss-entries 子项与去重 ----------
ENT="{\"entries\":[{\"sourceUrl\":\"https://example.com/post-a-$TS?utm_source=rss\",\"title\":\"RSS post A $TS\",\"summary\":\"a\"},{\"sourceUrl\":\"https://example.com/post-b-$TS\",\"title\":\"RSS post B $TS\"},{\"sourceUrl\":\"https://example.com/post-a-$TS\",\"title\":\"RSS post A $TS\"}]}"
S=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/internal/intake-items/$PID/rss-entries" -H "$(auth)" \
  -H 'Content-Type: application/json' -d "$ENT")
CREATED=$(echo "$S" | head -1 | python3 -c 'import json,sys;print(len(json.load(sys.stdin)["created"]))' 2>/dev/null)
[ "$(echo "$S" | tail -1)" = "200" ] && [ "$CREATED" = "2" ] && ok "rss-entries created 2, duplicate skipped" || bad "rss-entries $(echo "$S"|tail -2) created=$CREATED"
CHILD=$(Q "count(*) FROM geo_foundry.intake_items WHERE connector_id=$CID_Y AND channel='url' AND status='new'")
[ "$CHILD" = "2" ] && ok "child url-channel intakes new" || bad "children=$CHILD"

# ---------- 5. tick3：已完成父稿复位新一轮 ----------
PSQL "UPDATE geo_foundry.connectors SET last_polled_at = now() - interval '2 hours' WHERE id=$CID_Y" >/dev/null
wait_tick
PY3=$(Q "status FROM geo_foundry.intake_items WHERE id=$PID")
PNEWS2=$(Q "count(*) FROM geo_foundry.intake_items WHERE connector_id=$CID_Y AND channel='rss'")
[ "$PY3" = "fetching" ] && [ "$PNEWS2" = "1" ] && ok "completed parent reset for next cycle" || bad "tick3 status=$PY3 parents=$PNEWS2"

echo "PASS=${#PASS[@]} FAIL=${#FAIL[@]}"
[ "${#FAIL[@]}" = "0" ]
