#!/usr/bin/env bash
# 586 工作流六端点 E2E：transition/审核决策幂等/publish-op 创建+重放+取消/
# URL 预留/request-changes 评论/archived 根表发布，终态还原 draft。
set -uo pipefail
BASE=http://127.0.0.1:3090
ED=586
TS=$(date +%s)
K1="e2e-wf-approve-$TS"
K2="e2e-wf-changes-$TS"
PASS=(); FAIL=()
ok() { PASS+=("$1"); echo "PASS: $1"; }
bad() { FAIL+=("$1"); echo "FAIL: $1"; }
EDPW="${GF_E2E_EDITOR_PASSWORD:?}"
RTPW="${GF_E2E_ROOT_PASSWORD:?}"

PSQL() { sudo docker exec pg-server psql -U gpucloud -d geo_foundry -At -c "$1"; }
Q() { PSQL "SELECT $1"; }

login() { # email pass jar
  curl -s -X POST $BASE/api/users/login -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" -c "$3" -o /dev/null
}
login gf-editor-test@geo-foundry.dev "$EDPW" /tmp/wf-e.jar
login gf-root-test@geo-foundry.dev "$RTPW" /tmp/wf-r.jar
echo "logins ok"

draft() { curl -s -b /tmp/wf-e.jar "$BASE/api/content-editions/$ED?draft=true&depth=0"; }
rev_of() { echo "$1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["workflowRevision"])'; }

D0=$(draft); R0=$(rev_of "$D0")
V0=$(Q "count(*) FROM geo_foundry._content_editions_v WHERE parent_id=$ED")
O0=$(Q "count(*) FROM geo_foundry.outbox_events WHERE aggregate_id='$ED'")
U0=$(Q "count(*) FROM geo_foundry.url_records WHERE content_id=619")
C0=$(Q "count(*) FROM geo_foundry.review_comments WHERE edition_id=$ED")
I0=$(Q "count(*) FROM geo_foundry.reviewer_edition_decision_idempotency WHERE edition_id=$ED")
echo "pre: rev=$R0 versions=$V0 outbox=$O0 urls=$U0 comments=$C0 idem=$I0"

# 1. editor: draft -> review
S=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/editions/$ED/workflow-transitions" -b /tmp/wf-e.jar \
  -H 'Content-Type: application/json' -d '{"target":"review"}')
[ "$(echo "$S" | tail -1)" = "200" ] && ok "editor transition draft->review 200" || bad "transition1 $(echo "$S"|tail -2)"
R1=$(rev_of "$(draft)"); [ "$R1" = "$((R0+1))" ] && ok "revision $R0->$R1" || bad "rev after review: $R1"

# 2. root(super-admin) reviewer approve, idempotent
A1=$(curl -s -X POST "$BASE/api/workspaces/reviewer/editions/$ED/approve" -b /tmp/wf-r.jar \
  -H 'Content-Type: application/json' -H "x-request-id: wf-a1-$TS" -H "idempotency-key: $K1" \
  -d "{\"expectedRevision\":$R1}")
echo "approve: $A1"
echo "$A1" | python3 -c '
import json,sys
d=json.load(sys.stdin)
assert d["workflowStatus"]=="approved" and d["workflowRevision"]=='"$((R1+1))"', d' \
  && ok "reviewer approve -> approved rev $((R1+1))" || bad "approve $A1"
R2=$(rev_of "$(draft)"); [ "$R2" = "$((R1+1))" ] && ok "draft revision now $R2" || bad "rev after approve $R2"
U1=$(Q "count(*) FROM geo_foundry.url_records WHERE content_id=619")
[ "$U1" = "$((U0+1))" ] && ok "URL reserved for content 619" || bad "urls $U0->$U1"

# 3. replay same key same body
A2=$(curl -s -X POST "$BASE/api/workspaces/reviewer/editions/$ED/approve" -b /tmp/wf-r.jar \
  -H 'Content-Type: application/json' -H "x-request-id: wf-a2-$TS" -H "idempotency-key: $K1" \
  -d "{\"expectedRevision\":$R1}")
[ "$A2" = "$A1" ] && ok "approve replay identical response" || bad "replay differs: $A2"
V_NOW=$(Q "count(*) FROM geo_foundry._content_editions_v WHERE parent_id=$ED")
RP1=$(Q "replay_count FROM geo_foundry.reviewer_edition_decision_idempotency WHERE idempotency_key='$K1'")
[ "$RP1" = "1" ] && ok "reviewer replayCount=1" || bad "replayCount=$RP1"

# 4. same key different body -> 409
S=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/workspaces/reviewer/editions/$ED/approve" -b /tmp/wf-r.jar \
  -H 'Content-Type: application/json' -H "x-request-id: wf-a3-$TS" -H "idempotency-key: $K1" \
  -d "{\"expectedRevision\":$((R1+5))}")
[ "$(echo "$S" | tail -1)" = "409" ] && echo "$S" | head -1 | grep -q IDEMPOTENCY_KEY_REUSED \
  && ok "approve key reuse -> 409" || bad "reuse $(echo "$S"|tail -2)"

# 5. editor cannot submit publish; root can; replay 200
S=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/editions/$ED/publish-operations" -b /tmp/wf-e.jar \
  -H 'Content-Type: application/json' -d '{}')
[ "$(echo "$S" | tail -1)" = "403" ] && ok "editor publish-op -> 403 PUBLISHER_REQUIRED" || bad "ed pub $(echo "$S"|tail -2)"

P1=$(curl -s -X POST "$BASE/api/editions/$ED/publish-operations" -b /tmp/wf-r.jar \
  -H 'Content-Type: application/json' -d '{}')
echo "publish-op: $P1"
OP=$(echo "$P1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["operation"]["operationId"])')
echo "$P1" | python3 -c '
import json,sys
o=json.load(sys.stdin)["operation"]
assert o["created"] is True and o["state"]=="queued" and o["releaseId"].startswith("rel-"), o' \
  && ok "publish-op created (op=$OP)" || bad "publish-op $P1"

# 立即终结 operation，避免 worker reconcile 执行真实发布。
# 台账不允许 queued→cancelled（既有策略），用 worker 同款 stage 端点置 failed。
SKEY=$(sudo python3 -c 'import json;print(json.load(open("/opt/geo-foundry/credentials/content-service-keyring.json"))["tenants"]["413"])')
P2=$(curl -s -X POST "$BASE/api/editions/$ED/publish-operations" -b /tmp/wf-r.jar \
  -H 'Content-Type: application/json' -d '{}')
echo "$P2" | python3 -c '
import json,sys
o=json.load(sys.stdin)["operation"]
assert o["created"] is False and o["operationId"]=="'"$OP"'", o' \
  && ok "publish-op replay 200 same operation" || bad "replay $P2"
curl -s -o /dev/null -X POST "$BASE/api/internal/operations/$OP/stages/start" \
  -H "Authorization: users API-Key $SKEY" -H 'Content-Type: application/json' \
  -H "x-request-id: wf-term-start-$TS" -H "x-operation-id: $OP" \
  -d '{"attempt":1,"stage":"publish-gate"}'
curl -s -o /dev/null -X POST "$BASE/api/internal/operations/$OP/stages/complete" \
  -H "Authorization: users API-Key $SKEY" -H 'Content-Type: application/json' \
  -H "x-request-id: wf-term-done-$TS" -H "x-operation-id: $OP" \
  -d '{"attempt":1,"error":{"code":"E2E_WORKFLOW_BATCH_CANCELLED"},"outcome":"failed","stage":"publish-gate"}'
OST=$(Q "state FROM geo_foundry.operations WHERE operation_id='$OP'")
[ "$OST" = "failed" ] && ok "publish op terminated failed (E2E)" || bad "op state=$OST"
POB=$(Q "count(*) FROM geo_foundry.outbox_events WHERE type='publish.requested' AND aggregate_id='$ED'")
[ "$POB" -ge 1 ] && ok "publish.requested outbox written" || bad "publish outbox=$POB"

# 6. approved -> draft (editor retreat), then review again
curl -s -o /dev/null -X POST "$BASE/api/editions/$ED/workflow-transitions" -b /tmp/wf-e.jar \
  -H 'Content-Type: application/json' -d '{"target":"draft","reason":"E2E retreat"}'
R3=$(rev_of "$(draft)")
curl -s -o /dev/null -X POST "$BASE/api/editions/$ED/workflow-transitions" -b /tmp/wf-e.jar \
  -H 'Content-Type: application/json' -d '{"target":"review"}'
R4=$(rev_of "$(draft)")
[ "$R4" = "$((R3+1))" ] && ok "retreat + re-review revisions ok ($R3->$R4)" || bad "rev chain $R3->$R4"

# 7. request-changes with comment
CH1=$(curl -s -X POST "$BASE/api/workspaces/reviewer/editions/$ED/request-changes" -b /tmp/wf-r.jar \
  -H 'Content-Type: application/json' -H "x-request-id: wf-c1-$TS" -H "idempotency-key: $K2" \
  -d "{\"expectedRevision\":$R4,\"reason\":\"E2E request changes: tighten intro\"}")
echo "$CH1" | python3 -c '
import json,sys
d=json.load(sys.stdin)
assert d["workflowStatus"]=="draft" and d["workflowRevision"]=='"$((R4+1))"', d' \
  && ok "request-changes -> draft rev $((R4+1))" || bad "changes $CH1"
C1=$(Q "count(*) FROM geo_foundry.review_comments WHERE edition_id=$ED AND kind='request-changes'")
[ "$C1" = "$((C0+1))" ] && ok "request-changes comment created" || bad "comments $C0->$C1"
CH2=$(curl -s -X POST "$BASE/api/workspaces/reviewer/editions/$ED/request-changes" -b /tmp/wf-r.jar \
  -H 'Content-Type: application/json' -H "x-request-id: wf-c2-$TS" -H "idempotency-key: $K2" \
  -d "{\"expectedRevision\":$R4,\"reason\":\"E2E request changes: tighten intro\"}")
[ "$CH2" = "$CH1" ] && ok "request-changes replay identical, no second comment" || bad "changes replay $CH2"
C2=$(Q "count(*) FROM geo_foundry.review_comments WHERE edition_id=$ED AND kind='request-changes'")
[ "$C2" = "$C1" ] && ok "comment count stable after replay" || bad "comments $C1->$C2"

# 8. plain comment endpoint
S=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/editions/$ED/review-comments" -b /tmp/wf-e.jar \
  -H 'Content-Type: application/json' -d '{"body":"E2E 普通评论"}')
[ "$(echo "$S" | tail -1)" = "201" ] && ok "review comment 201" || bad "comment $(echo "$S"|tail -2)"

# 9. draft-from-published guard on non-published
S=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/editions/$ED/draft-from-published" -b /tmp/wf-e.jar \
  -H 'Content-Type: application/json' -d '{}')
[ "$(echo "$S" | tail -1)" = "409" ] && ok "draft-from-published guard 409" || bad "dfp $(echo "$S"|tail -2)"

# 10. archived: draft 泳道 -> 终态，根表必须收到 draft 内容
S=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/editions/$ED/workflow-transitions" -b /tmp/wf-e.jar \
  -H 'Content-Type: application/json' -d '{"target":"archived","reason":"E2E archive root publish"}')
[ "$(echo "$S" | tail -1)" = "200" ] && ok "transition -> archived 200" || bad "archive $(echo "$S"|tail -2)"
ROOT_ST=$(Q "workflow_status FROM geo_foundry.content_editions WHERE id=$ED")
ROOT_MD=$(Q "length(coalesce(body_markdown,'')) FROM geo_foundry.content_editions WHERE id=$ED")
ROOT_AUD=$(Q "(audit_log::jsonb -> -1 ->> 'action') FROM geo_foundry.content_editions WHERE id=$ED")
[ "$ROOT_ST" = "archived" ] && ok "live root workflow_status=archived" || bad "root status=$ROOT_ST"
[ "$ROOT_MD" -gt 0 ] && ok "live root body_markdown published (len=$ROOT_MD)" || bad "root md len=$ROOT_MD"
echo "$ROOT_AUD" | grep -q "content-edition.draft.archived" && ok "root audit action correct" || bad "root audit=$ROOT_AUD"

# 11. 还原现场：archived -> draft
S=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/editions/$ED/workflow-transitions" -b /tmp/wf-e.jar \
  -H 'Content-Type: application/json' -d '{"target":"draft","reason":"E2E restore baseline"}')
[ "$(echo "$S" | tail -1)" = "200" ] && ok "restore -> draft 200" || bad "restore $(echo "$S"|tail -2)"
FIN=$(rev_of "$(draft)"); [ "$FIN" -gt "$R4" ] && ok "final revision=$FIN (draft)" || bad "final rev=$FIN"

# 12. 总对账
VF=$(Q "count(*) FROM geo_foundry._content_editions_v WHERE parent_id=$ED")
OF=$(Q "count(*) FROM geo_foundry.outbox_events WHERE aggregate_id='$ED'")
IF=$(Q "count(*) FROM geo_foundry.reviewer_edition_decision_idempotency WHERE edition_id=$ED")
echo "final: versions=$V0->$VF outbox=$O0->$OF idem=$I0->$IF pending_outbox=$(Q "count(*) FROM geo_foundry.outbox_events WHERE aggregate_id='$ED' AND status='pending'")"
[ "$IF" = "$((I0+2))" ] && ok "2 reviewer idempotency rows" || bad "idem $I0->$IF"

echo
echo "==== RESULT: ${#PASS[@]} passed, ${#FAIL[@]} failed ===="
[ ${#FAIL[@]} -gt 0 ] && printf 'FAILED: %s\n' "${FAIL[@]}" && exit 1
rm -f /tmp/wf-e.jar /tmp/wf-r.jar
exit 0
