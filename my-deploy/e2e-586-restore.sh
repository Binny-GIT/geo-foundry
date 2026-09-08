#!/usr/bin/env bash
# 586 版本历史/恢复 Drizzle 路由 E2E：双向恢复 + 幂等重放 + 冲突 + DB 对账
set -uo pipefail
BASE=http://127.0.0.1:3090
ED=586
TS=$(date +%s)
K1="e2e-restore-k1-$TS"
K2="e2e-restore-k2-$TS"
PASS=(); FAIL=()
ok() { PASS+=("$1"); echo "PASS: $1"; }
bad() { FAIL+=("$1"); echo "FAIL: $1"; }

PSQL() {
  sudo docker exec "$PGC" psql -U "$PGU" -d "$PGD" -At -c "$1"
}

# --- 定位 PostgreSQL 容器（geo-foundry 走 pg_default 网络的 pg-server 别名）---
PGC=$(sudo docker network inspect pg_default --format '{{range .Containers}}{{.Name}} {{end}}' | tr ' ' '\n' | head -1)
if [ -z "$PGC" ]; then echo "no container on pg_default network"; exit 1; fi
PGU=$(sudo docker exec "$PGC" env | sed -n 's/^POSTGRES_USER=//p')
PGD=$(sudo docker exec "$PGC" env | sed -n 's/^POSTGRES_DB=//p')
[ -z "$PGU" ] && PGU=postgres
[ -z "$PGD" ] && PGD=postgres
echo "pg container=$PGC user=$PGU db=$PGD"
PGD=$(PSQL "SELECT datname FROM pg_database WHERE datname='geo_foundry'")
[ -z "$PGD" ] && PGD=geo_foundry
echo "business db=$PGD"

# --- editor 登录（凭据经环境变量注入，不落仓库）---
EDITOR_PASSWORD="${GF_E2E_EDITOR_PASSWORD:?set GF_E2E_EDITOR_PASSWORD (fixture 见 .test/accounts.md)}"
LOGIN=$(curl -s -X POST $BASE/api/users/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"gf-editor-test@geo-foundry.dev\",\"password\":\"$EDITOR_PASSWORD\"}" -c /tmp/gf-e2e-editor.jar)
echo "$LOGIN" | grep -q '"message"' && echo "editor login ok" || { echo "editor login FAILED: $LOGIN"; exit 1; }

# --- 基线 ---
DRAFT_PRE=$(curl -s -b /tmp/gf-e2e-editor.jar "$BASE/api/content-editions/$ED?draft=true&depth=0")
read -r REV_PRE UAT_PRE BODYMD5_PRE <<<"$(echo "$DRAFT_PRE" | python3 -c '
import json,sys,hashlib
d=json.load(sys.stdin)
print(d["workflowRevision"], d["updatedAt"], hashlib.md5((d.get("bodyMarkdown") or "").encode()).hexdigest())')"
echo "pre: revision=$REV_PRE updatedAt=$UAT_PRE md5=$BODYMD5_PRE"

HIST_PRE=$(curl -s -b /tmp/gf-e2e-editor.jar "$BASE/api/workspaces/editions/$ED/version-history")
read -r CNT_PRE TOP_ID <<<"$(echo "$HIST_PRE" | python3 -c '
import json,sys
d=json.load(sys.stdin)
vs=d["versions"]
print(len(vs), vs[0]["id"])')"
echo "history pre: count=$CNT_PRE latestVersionId=$TOP_ID"
[ "${CNT_PRE:-0}" -ge 12 ] && ok "history >=12 items ($CNT_PRE)" || bad "history count $CNT_PRE"

# 目标旧版本：倒数第 3 条（足够旧、非当前）
TARGET=$(echo "$HIST_PRE" | python3 -c '
import json,sys
vs=json.load(sys.stdin)["versions"]
print(vs[min(5,len(vs)-1)]["id"])')
echo "restore target version=$TARGET"

VDB_PRE=$(PSQL "SELECT count(*) FROM geo_foundry._content_editions_v WHERE parent_id=$ED")
OBDB_PRE=$(PSQL "SELECT count(*) FROM geo_foundry.outbox_events WHERE aggregate_id='$ED'")
IDEM_PRE=$(PSQL "SELECT count(*) FROM geo_foundry.edition_draft_restore_idempotency WHERE edition_id=$ED")
echo "db pre: versions=$VDB_PRE outbox586=$OBDB_PRE idem=$IDEM_PRE"

# --- 恢复 1：回到旧版本 ---
R1=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/workspaces/editions/$ED/restore-draft" \
  -b /tmp/gf-e2e-editor.jar \
  -H 'Content-Type: application/json' -H "x-request-id: e2e-req-k1-$TS" -H "idempotency-key: $K1" \
  -d "{\"expectedRevision\":$REV_PRE,\"expectedUpdatedAt\":\"$UAT_PRE\",\"reason\":\"E2E Drizzle restore verify\",\"versionId\":$TARGET}")
R1_CODE=$(echo "$R1" | tail -1); R1_BODY=$(echo "$R1" | head -n -1)
echo "restore1 code=$R1_CODE body=$R1_BODY"
[ "$R1_CODE" = "200" ] && ok "restore old version -> 200" || bad "restore old version code=$R1_CODE"

# --- 重放：同 key 同 body，响应一致，不新增版本 ---
R2=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/workspaces/editions/$ED/restore-draft" \
  -b /tmp/gf-e2e-editor.jar \
  -H 'Content-Type: application/json' -H "x-request-id: e2e-req-k1r-$TS" -H "idempotency-key: $K1" \
  -d "{\"expectedRevision\":$REV_PRE,\"expectedUpdatedAt\":\"$UAT_PRE\",\"reason\":\"E2E Drizzle restore verify\",\"versionId\":$TARGET}")
R2_CODE=$(echo "$R2" | tail -1); R2_BODY=$(echo "$R2" | head -n -1)
[ "$R2_CODE" = "200" ] && [ "$R2_BODY" = "$R1_BODY" ] && ok "replay same key -> identical response" || bad "replay code=$R2_CODE body=$R2_BODY"

VDB_MID=$(PSQL "SELECT count(*) FROM geo_foundry._content_editions_v WHERE parent_id=$ED")
[ "$VDB_MID" = "$((VDB_PRE+1))" ] && ok "replay added no version ($VDB_PRE->$VDB_MID)" || bad "version count after replay: $VDB_PRE->$VDB_MID"

RPC=$(PSQL "SELECT replay_count FROM geo_foundry.edition_draft_restore_idempotency WHERE idempotency_key='$K1'")
[ "$RPC" = "1" ] && ok "replayCount=1 after replay" || bad "replayCount=$RPC"

# --- 同 key 不同 body -> 409 ---
R3=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/workspaces/editions/$ED/restore-draft" \
  -b /tmp/gf-e2e-editor.jar \
  -H 'Content-Type: application/json' -H "x-request-id: e2e-req-k1c-$TS" -H "idempotency-key: $K1" \
  -d "{\"expectedRevision\":$REV_PRE,\"expectedUpdatedAt\":\"$UAT_PRE\",\"reason\":\"E2E DIFFERENT body\",\"versionId\":$TARGET}")
R3_CODE=$(echo "$R3" | tail -1); R3_BODY=$(echo "$R3" | head -n -1)
[ "$R3_CODE" = "409" ] && echo "$R3_BODY" | grep -q IDEMPOTENCY_KEY_REUSED && ok "same key diff body -> 409 IDEMPOTENCY_KEY_REUSED" || bad "conflict code=$R3_CODE body=$R3_BODY"

# --- 正文确认：当前草稿 Markdown 已变为目标旧版本内容 ---
TARGET_MD=$(echo "$HIST_PRE" | python3 -c "
import json,sys,hashlib
vs=json.load(sys.stdin)['versions']
m=[v for v in vs if v['id']==$TARGET][0]['snapshot']['bodyMarkdown']
print(hashlib.md5(m.encode()).hexdigest())")
DRAFT_MID=$(curl -s -b /tmp/gf-e2e-editor.jar "$BASE/api/content-editions/$ED?draft=true&depth=0")
read -r REV_MID UAT_MID MD_MID <<<"$(echo "$DRAFT_MID" | python3 -c '
import json,sys,hashlib
d=json.load(sys.stdin)
print(d["workflowRevision"], d["updatedAt"], hashlib.md5((d.get("bodyMarkdown") or "").encode()).hexdigest())')"
[ "$MD_MID" = "$TARGET_MD" ] && ok "draft markdown now equals restored version" || bad "markdown mismatch after restore"
[ "$REV_MID" = "$((REV_PRE+1))" ] && ok "revision incremented ($REV_PRE->$REV_MID)" || bad "revision $REV_PRE->$REV_MID"

# --- 恢复 2：回到 E2E 前的最新版本（现场还原） ---
R4=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/workspaces/editions/$ED/restore-draft" \
  -b /tmp/gf-e2e-editor.jar \
  -H 'Content-Type: application/json' -H "x-request-id: e2e-req-k2-$TS" -H "idempotency-key: $K2" \
  -d "{\"expectedRevision\":$REV_MID,\"expectedUpdatedAt\":\"$UAT_MID\",\"reason\":\"E2E restore back to baseline\",\"versionId\":$TOP_ID}")
R4_CODE=$(echo "$R4" | tail -1)
[ "$R4_CODE" = "200" ] && ok "restore back -> 200" || bad "restore back code=$R4_CODE"

DRAFT_POST=$(curl -s -b /tmp/gf-e2e-editor.jar "$BASE/api/content-editions/$ED?draft=true&depth=0")
MD_POST=$(echo "$DRAFT_POST" | python3 -c '
import json,sys,hashlib
d=json.load(sys.stdin)
print(hashlib.md5((d.get("bodyMarkdown") or "").encode()).hexdigest())')
[ "$MD_POST" = "$BODYMD5_PRE" ] && ok "final markdown equals baseline" || bad "final markdown differs from baseline"

# --- 终态对账 ---
VDB_POST=$(PSQL "SELECT count(*) FROM geo_foundry._content_editions_v WHERE parent_id=$ED")
OBDB_POST=$(PSQL "SELECT count(*) FROM geo_foundry.outbox_events WHERE aggregate_id='$ED'")
PENDING=$(PSQL "SELECT count(*) FROM geo_foundry.outbox_events WHERE aggregate_id='$ED' AND status='pending'")
LATEST_AUDIT=$(PSQL "SELECT version_audit_log::jsonb -> -1 ->> 'action' FROM geo_foundry._content_editions_v WHERE parent_id=$ED AND latest LIMIT 1")
IDEM_POST=$(PSQL "SELECT count(*) FROM geo_foundry.edition_draft_restore_idempotency WHERE edition_id=$ED")

[ "$VDB_POST" = "$((VDB_PRE+2))" ] && ok "exactly 2 new versions ($VDB_PRE->$VDB_POST)" || bad "versions $VDB_PRE->$VDB_POST"
[ "$OBDB_POST" = "$((OBDB_PRE+2))" ] && ok "exactly 2 new outbox events" || bad "outbox $OBDB_PRE->$OBDB_POST"
echo "$LATEST_AUDIT" | grep -q "content-edition.history.draft" && ok "latest audit entry is restore action" || bad "audit=$LATEST_AUDIT"
[ "$IDEM_POST" = "$((IDEM_PRE+2))" ] && ok "2 new idempotency rows" || bad "idem $IDEM_PRE->$IDEM_POST"

HIST_POST=$(curl -s -b /tmp/gf-e2e-editor.jar "$BASE/api/workspaces/editions/$ED/version-history")
HIST_TOP_MD=$(echo "$HIST_POST" | python3 -c '
import json,sys,hashlib
v=json.load(sys.stdin)["versions"][0]
print(hashlib.md5(v["snapshot"]["bodyMarkdown"].encode()).hexdigest())')
[ "$HIST_TOP_MD" = "$BODYMD5_PRE" ] && ok "history top entry equals baseline content" || bad "history top differs"
echo "pending_outbox_586=$PENDING (dispatcher 每秒投递后应归零)"

echo
echo "==== RESULT: ${#PASS[@]} passed, ${#FAIL[@]} failed ===="
[ ${#FAIL[@]} -gt 0 ] && printf 'FAILED: %s\n' "${FAIL[@]}" && exit 1
exit 0
