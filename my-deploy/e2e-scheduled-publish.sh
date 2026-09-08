#!/usr/bin/env bash
# 定时发布全链路 E2E（Drizzle 版，替代已删除的 verify-scheduled-publish.mjs）：
# 一次性文章 draft→review→approved → 建计划(past) → dispatch-due 认领并提交
# publish operation → 模拟 worker（start/compile-results/published receipt/complete）
# → settle 后计划 succeeded、release current、文章 published、URL active。
# 附：取消路径 + 计划幂等 + 角色门禁。在 mk-dev 宿主机运行。
set -uo pipefail
BASE=http://127.0.0.1:3090
SITE=375
TS=$(date +%s)
NOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
PASS=(); FAIL=()
ok() { PASS+=("$1"); echo "PASS: $1"; }
bad() { FAIL+=("$1"); echo "FAIL: $1"; }
EDPW="${GF_E2E_EDITOR_PASSWORD:?}"
RTPW="${GF_E2E_ROOT_PASSWORD:?}"
PBPW="${GF_E2E_PUBLISHER_PASSWORD:?}"

PSQL() { sudo docker exec pg-server psql -U gpucloud -d geo_foundry -qAt -c "$1"; }
Q() { PSQL "SELECT $1"; }

login() { # email pass jar
  curl -s -X POST $BASE/api/users/login -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" -c "$3" -o /dev/null
}
login gf-editor-test@geo-foundry.dev "$EDPW" /tmp/sp-e.jar
login gf-root-test@geo-foundry.dev "$RTPW" /tmp/sp-r.jar
login e2e-scheduled-publisher@geo-foundry.test "$PBPW" /tmp/sp-p.jar
SKEY=$(sudo python3 -c 'import json;print(json.load(open("/opt/geo-foundry/credentials/content-service-keyring.json"))["tenants"]["413"])')
TZ_=$(Q "timezone FROM geo_foundry.sites WHERE id=$SITE")
echo "logins ok; site $SITE timezone=$TZ_"

auth() { echo "Authorization: users API-Key $SKEY"; }
draft() { curl -s -b /tmp/sp-e.jar "$BASE/api/content-editions/$1?draft=true&depth=0"; }
rev_of() { echo "$1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["workflowRevision"])'; }
st_of() { echo "$1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["workflowStatus"])'; }

# ---------- 1. 一次性文章到 approved ----------
C1=$(curl -s -X POST "$BASE/api/content-editions?draft=true&depth=0" -b /tmp/sp-e.jar \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"E2E 定时发布 $TS\",\"bodyMarkdown\":\"# 摘要\\n\\n定时发布全链路验证正文。\",\"site\":$SITE}")
ED=$(echo "$C1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["doc"]["id"])')
[ -n "$ED" ] && ok "draft created (edition=$ED)" || { bad "create $C1"; exit 1; }
curl -s -o /dev/null -X POST "$BASE/api/editions/$ED/workflow-transitions" -b /tmp/sp-e.jar \
  -H 'Content-Type: application/json' -d '{"target":"review"}'
R1=$(rev_of "$(draft "$ED")")
A1=$(curl -s -X POST "$BASE/api/workspaces/reviewer/editions/$ED/approve" -b /tmp/sp-r.jar \
  -H 'Content-Type: application/json' -H "x-request-id: sp-a1-$TS" -H "idempotency-key: sp-approve-$TS" \
  -d "{\"expectedRevision\":$R1}")
[ "$(st_of "$A1")" = "approved" ] && ok "reviewer approve -> approved" || bad "approve $A1"

# ---------- 2. 建计划（角色门禁 + 正常创建） ----------
PAST=$(date -u -d '1 minute ago' +%Y-%m-%dT%H:%M:%S.000Z)
S=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/publication-plan-operations" -b /tmp/sp-e.jar \
  -H 'Content-Type: application/json' -d "{\"editionId\":$ED,\"scheduledFor\":\"$PAST\",\"timezone\":\"$TZ_\"}")
[ "$(echo "$S" | tail -1)" = "403" ] && ok "editor plan create -> 403" || bad "editor plan $(echo "$S"|tail -2)"
P1=$(curl -s -X POST "$BASE/api/publication-plan-operations" -b /tmp/sp-p.jar \
  -H 'Content-Type: application/json' -d "{\"editionId\":$ED,\"scheduledFor\":\"$PAST\",\"timezone\":\"$TZ_\"}")
PLAN=$(echo "$P1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["plan"]["planId"])')
[ -n "$PLAN" ] && ok "plan created ($PLAN)" || { bad "plan create $P1"; exit 1; }

# ---------- 3. dispatch-due 认领并提交 publish operation ----------
D1=$(curl -s -X POST "$BASE/api/internal/publication-plans/dispatch-due" \
  -H "$(auth)" -H 'Content-Type: application/json' \
  -d "{\"now\":\"$NOW\",\"workerId\":\"e2e-sp-$TS\"}")
ROW=$(Q "status||'|'||coalesce(operation_id,'')||'|'||attempts FROM geo_foundry.publication_plans WHERE plan_id='$PLAN'")
OP=$(echo "$ROW" | cut -d'|' -f2)
[ "$ROW" = "running|$OP|1" ] && [ -n "$OP" ] && ok "dispatch-due claimed + op=$OP" || bad "plan row=$ROW"

# ---------- 4. 模拟 worker 发布（start→compile→receipt→complete） ----------
curl -s -o /dev/null -X POST "$BASE/api/internal/operations/$OP/stages/start" -H "$(auth)" \
  -H 'Content-Type: application/json' -H "x-request-id: sp-s1-$TS" -H "x-operation-id: $OP" \
  -d '{"attempt":1,"stage":"publish-gate"}'
REL="rel-e2e-sp-$TS"
SHA=$(python3 -c "import hashlib;print(hashlib.sha256(b'e2e-scheduled-publish-$TS').hexdigest())")
CR=$(curl -s -X POST "$BASE/api/internal/editions/$ED/compile-results" -H "$(auth)" \
  -H 'Content-Type: application/json' -H "x-request-id: sp-c1-$TS" -H "x-operation-id: $OP" \
  -d "{\"manifestSha256\":\"$SHA\",\"objectCount\":2,\"releaseId\":\"$REL\",\"totalBytes\":2048}")
echo "$CR" | python3 -c '
import json,sys
d=json.load(sys.stdin)
assert d["workflowStatus"]=="compiled" and d["releaseId"]=="'"$REL"'", d' \
  && ok "compile-results -> compiled ($REL)" || bad "compile $CR"
NOW2=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
REC="{\"editionId\":$ED,\"operationId\":\"$OP\",\"receipt\":{\"action\":\"publish\",\"actor\":{\"kind\":\"service\",\"actorId\":\"geo-foundry-worker\"},\"schemaVersion\":1,\"releaseId\":\"$REL\",\"manifestSha256\":\"$SHA\",\"siteId\":\"site-$SITE\",\"recordedAt\":\"$NOW2\",\"newEtag\":\"\\\"sp$TS\\\"\",\"oldEtag\":null}}"
PR=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/internal/sites/$SITE/releases/published" \
  -H "$(auth)" -H 'Content-Type: application/json' -d "$REC")
[ "$(echo "$PR" | tail -1)" = "200" ] && ok "published receipt 200" || bad "receipt $(echo "$PR"|tail -2)"
curl -s -o /dev/null -X POST "$BASE/api/internal/operations/$OP/stages/complete" -H "$(auth)" \
  -H 'Content-Type: application/json' -H "x-request-id: sp-s2-$TS" -H "x-operation-id: $OP" \
  -d "{\"attempt\":1,\"outcome\":\"succeeded\",\"stage\":\"publish-gate\",\"result\":{\"releaseId\":\"$REL\"}}"

# ---------- 5. settle：计划 succeeded，端到端状态 ----------
D2=$(curl -s -X POST "$BASE/api/internal/publication-plans/dispatch-due" \
  -H "$(auth)" -H 'Content-Type: application/json' \
  -d "{\"now\":\"$NOW2\",\"workerId\":\"e2e-sp-$TS\"}")
ROW2=$(Q "status||'|'||coalesce(release_id,'')||'|'||(published_at IS NOT NULL) FROM geo_foundry.publication_plans WHERE plan_id='$PLAN'")
[ "$ROW2" = "succeeded|$REL|true" ] && ok "plan settled succeeded + publishedAt + releaseId" || bad "settle row=$ROW2"
ST=$(Q "workflow_status FROM geo_foundry.edition_revisions WHERE parent_id=$ED AND latest")
[ "$ST" = "published" ] && ok "edition latest -> published" || bad "edition status=$ST"
RL=$(Q "state FROM geo_foundry.releases WHERE release_id='$REL'")
[ "$RL" = "current" ] && ok "release $REL current" || bad "release state=$RL"
URL=$(Q "state FROM geo_foundry.url_records WHERE edition_id=$ED AND site_id=$SITE ORDER BY id DESC LIMIT 1")
[ "$URL" = "active" ] && ok "url reserved -> active" || bad "url state=$URL"
JOB=$(Q "count(*) FROM pgboss.job WHERE singleton_key='$OP'")
[ "$JOB" -ge 1 ] && ok "publish operation job in pgboss" || bad "pgboss job=$JOB"

# ---------- 6. 幂等：重复 dispatch 不重复建 operation ----------
D3=$(curl -s -X POST "$BASE/api/internal/publication-plans/dispatch-due" \
  -H "$(auth)" -H 'Content-Type: application/json' \
  -d "{\"now\":\"$NOW2\",\"workerId\":\"e2e-sp2-$TS\"}")
OP2=$(Q "coalesce(operation_id,'') FROM geo_foundry.publication_plans WHERE plan_id='$PLAN'")
[ "$OP2" = "$OP" ] && ok "re-dispatch keeps single operation" || bad "op changed $OP->$OP2"

# ---------- 7. 取消路径（第二篇一次性文章） ----------
C2=$(curl -s -X POST "$BASE/api/content-editions?draft=true&depth=0" -b /tmp/sp-e.jar \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"E2E 定时发布 cancel $TS\",\"bodyMarkdown\":\"# 摘要\\n\\n取消路径。\",\"site\":$SITE}")
ED2=$(echo "$C2" | python3 -c 'import json,sys;print(json.load(sys.stdin)["doc"]["id"])')
curl -s -o /dev/null -X POST "$BASE/api/editions/$ED2/workflow-transitions" -b /tmp/sp-e.jar \
  -H 'Content-Type: application/json' -d '{"target":"review"}'
R2=$(rev_of "$(draft "$ED2")")
curl -s -o /dev/null -X POST "$BASE/api/workspaces/reviewer/editions/$ED2/approve" -b /tmp/sp-r.jar \
  -H 'Content-Type: application/json' -H "x-request-id: sp-a2-$TS" -H "idempotency-key: sp-approve2-$TS" \
  -d "{\"expectedRevision\":$R2}"
FUT=$(date -u -d '1 hour' +%Y-%m-%dT%H:%M:%S.000Z)
P2=$(curl -s -X POST "$BASE/api/publication-plan-operations" -b /tmp/sp-p.jar \
  -H 'Content-Type: application/json' -d "{\"editionId\":$ED2,\"scheduledFor\":\"$FUT\",\"timezone\":\"$TZ_\"}")
PLAN2=$(echo "$P2" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("plan",{}).get("planId",""))')
[ -n "$PLAN2" ] || { bad "plan2 create $P2"; exit 1; }
CX=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/publication-plan-operations/$PLAN2/cancel" -b /tmp/sp-p.jar \
  -H 'Content-Type: application/json')
[ "$(echo "$CX" | tail -1)" = "200" ] && ok "plan cancel 200" || bad "cancel $(echo "$CX"|tail -2)"
S=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/publication-plan-operations/$PLAN2/cancel" -b /tmp/sp-p.jar \
  -H 'Content-Type: application/json')
[ "$(echo "$S" | tail -1)" = "409" ] && ok "re-cancel -> 409" || bad "re-cancel $(echo "$S"|tail -2)"
curl -s -o /dev/null -X POST "$BASE/api/internal/publication-plans/dispatch-due" \
  -H "$(auth)" -H 'Content-Type: application/json' \
  -d "{\"now\":\"$FUT\",\"workerId\":\"e2e-sp-$TS\"}"
ST2=$(Q "status FROM geo_foundry.publication_plans WHERE plan_id='$PLAN2'")
[ "$ST2" = "cancelled" ] && ok "cancelled plan never claimed" || bad "plan2 status=$ST2"

echo "PASS=${#PASS[@]} FAIL=${#FAIL[@]}"
[ "${#FAIL[@]}" = "0" ]
