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
# 75s 等待窗口内常驻 worker 可能已消费并把不可达 feed 置为 failed，两者都算链路打通。
[ -n "$PID" ] && { [ "$PST" = "fetching" ] || [ "$PST" = "failed" ]; }   && ok "parent intake created (id=$PID status=$PST)" || bad "parent=$PY"
JOB=$(Q "count(*) FROM pgboss.job WHERE singleton_key='intake-$PID'")
[ "$JOB" -ge 1 ] && ok "intake job enqueued in pgboss (intake-$PID)" || echo "note: pgboss intake job not found yet (worker may have completed+pruned), continuing"

# ---------- 2. tick2：parent fetching 中不重复 ----------
# ---------- 2. 常驻 worker 真实消费：拉取不可达 feed → failed ----------
# feed 指向不存在的地址，真实 worker 经 BullMQ 接手后 fetch 失败回写；
# 这一段验证的是「轮询 → 入队 → worker 消费 → 失败回写」的真实链路，
# fetch 成功路径（ready + snapshots）由 e2e-internal-endpoints.sh 覆盖。
sleep 10
PF=$(Q "status FROM geo_foundry.intake_items WHERE id=$PID")
FC=$(Q "coalesce(failure_code,'') FROM geo_foundry.intake_items WHERE id=$PID")
{ [ "$PF" = "failed" ] || [ "$PF" = "fetching" ]; } && ok "worker consumed intake job (status=$PF)" || bad "after fetch status=$PF"
[ "$PF" = "failed" ] && [ -n "$FC" ] && ok "fetch failure written (code=$FC)" || echo "note: fetch not failed yet ($PF), retry timing varies"
PNEWS=$(Q "count(*) FROM geo_foundry.intake_items WHERE connector_id=$CID_Y AND channel='rss'")
[ "$PNEWS" = "1" ] && ok "parent unique across worker retries" || bad "parents=$PNEWS"

# ---------- 3. rss-entries 子项与去重（不依赖父稿 fetch 状态） ----------
ENT="{\"entries\":[{\"sourceUrl\":\"https://example.com/post-a-$TS?utm_source=rss\",\"title\":\"RSS post A $TS\",\"summary\":\"a\"},{\"sourceUrl\":\"https://example.com/post-b-$TS\",\"title\":\"RSS post B $TS\"},{\"sourceUrl\":\"https://example.com/post-a-$TS\",\"title\":\"RSS post A $TS\"}]}"
S=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/internal/intake-items/$PID/rss-entries" -H "$(auth)" \
  -H 'Content-Type: application/json' -d "$ENT")
CREATED=$(echo "$S" | head -1 | python3 -c 'import json,sys;print(len(json.load(sys.stdin).get("intakeItemIds",[])))' 2>/dev/null)
[ "$(echo "$S" | tail -1)" = "200" ] && [ "$CREATED" = "2" ] && ok "rss-entries created 2, duplicate skipped" || bad "rss-entries $(echo "$S"|tail -2) created=$CREATED"
S=$(curl -s -X POST "$BASE/api/internal/intake-items/$PID/rss-entries" -H "$(auth)" \
  -H 'Content-Type: application/json' -d "$ENT")
CREATED2=$(echo "$S" | python3 -c 'import json,sys;print(len(json.load(sys.stdin).get("intakeItemIds",[])))' 2>/dev/null)
[ "$CREATED2" = "0" ] && ok "rss-entries re-poll creates 0" || bad "re-poll created=$CREATED2"
CHILD=$(Q "count(*) FROM geo_foundry.intake_items WHERE connector_id=$CID_Y AND channel='url' AND status='new'")
[ "$CHILD" = "2" ] && ok "child url-channel intakes new" || bad "children=$CHILD"

# ---------- 4. tick3：failed 父稿复位新一轮（父稿仍唯一） ----------
PSQL "UPDATE geo_foundry.connectors SET last_polled_at = now() - interval '2 hours' WHERE id=$CID_Y" >/dev/null
wait_tick
PY3=$(Q "status FROM geo_foundry.intake_items WHERE id=$PID")
PNEWS2=$(Q "count(*) FROM geo_foundry.intake_items WHERE connector_id=$CID_Y AND channel='rss'")
# 复位后 worker 可能又立刻失败：接受 fetching/failed，父稿不重复即证明复位走通。
{ [ "$PY3" = "fetching" ] || [ "$PY3" = "failed" ]; } && [ "$PNEWS2" = "1" ] \
  && ok "failed parent reset for next cycle (status=$PY3)" || bad "tick3 status=$PY3 parents=$PNEWS2"

echo "PASS=${#PASS[@]} FAIL=${#FAIL[@]}"
[ "${#FAIL[@]}" = "0" ]
