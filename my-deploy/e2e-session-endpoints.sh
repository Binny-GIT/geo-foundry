#!/usr/bin/env bash
# 会话端点大批次 E2E：context/duplicate/assignment/intake 全链/评估幂等/
# 发布计划建+取消/回滚负例/delivery 负例。凭据经环境变量注入。
set -uo pipefail
BASE=http://127.0.0.1:3090
TS=$(date +%s)
PASS=(); FAIL=()
ok() { PASS+=("$1"); echo "PASS: $1"; }
bad() { FAIL+=("$1"); echo "FAIL: $1"; }
EDPW="${GF_E2E_EDITOR_PASSWORD:?}"
RTPW="${GF_E2E_ROOT_PASSWORD:?}"
PSQL() { sudo docker exec pg-server psql -U gpucloud -d geo_foundry -At -c "$1"; }

login() {
  curl -s -X POST $BASE/api/users/login -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" -c "$3" -o /dev/null
}
login gf-editor-test@geo-foundry.dev "$EDPW" /tmp/s-e.jar
login gf-root-test@geo-foundry.dev "$RTPW" /tmp/s-r.jar
echo "logins ok"

# 1. workspace-context
CTX=$(curl -s -w '\n%{http_code}' -b /tmp/s-e.jar "$BASE/api/workspaces/editions/586/context")
[ "$(echo "$CTX" | tail -1)" = "200" ] && echo "$CTX" | head -1 | python3 -c '
import json,sys
d=json.load(sys.stdin)
assert "workflowRevision" in d["edition"] and isinstance(d["sources"], list) and isinstance(d["comments"], list), d' \
  && ok "workspace-context 200 shape" || bad "context $(echo "$CTX"|tail -2)"

# 2. duplicate 586 -> 新草稿，并记录 id 用于后续 assignment
DUP=$(curl -s -X POST "$BASE/api/editions/586/duplicate" -b /tmp/s-e.jar)
NEW_ED=$(echo "$DUP" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("editionId",""))')
[ -n "$NEW_ED" ] && ok "duplicate -> edition $NEW_ED" || bad "duplicate $DUP"

# 3. assignment：owner=editor(1115) + sites=[374]
AS=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/editions/$NEW_ED/assignment" -b /tmp/s-e.jar \
  -H 'Content-Type: application/json' -d '{"owner":1115,"sites":[374]}')
[ "$(echo "$AS" | tail -1)" = "200" ] && echo "$AS" | head -1 | python3 -c '
import json,sys
d=json.load(sys.stdin)
assert d["owner"]==1115 and d["site"]==374 and d["sites"]==[374], d' \
  && ok "assignment owner+sites" || bad "assignment $(echo "$AS"|tail -2)"

# 4. intake 全链：create 唯一 -> create 重复 -> ignore -> merge -> adopt
TA="E2E 会话端点批次 $TS"
C1=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/intake-operations" -b /tmp/s-e.jar \
  -H 'Content-Type: application/json' -d "{\"channel\":\"manual\",\"summary\":\"e2e batch\",\"title\":\"$TA\"}")
[ "$(echo "$C1" | tail -1)" = "201" ] && ok "intake create unique 201" || bad "create1 $(echo "$C1"|tail -2)"
ID1=$(echo "$C1" | head -1 | python3 -c 'import json,sys;print(json.load(sys.stdin)["intakeItem"]["id"])')

C2=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/intake-operations" -b /tmp/s-e.jar \
  -H 'Content-Type: application/json' -d "{\"channel\":\"manual\",\"title\":\"$TA\"}")
[ "$(echo "$C2" | tail -1)" = "200" ] && echo "$C2" | head -1 | python3 -c '
import json,sys
d=json.load(sys.stdin)
assert d["duplicateIds"] and d["intakeItem"]["status"]=="duplicate", d' \
  && ok "intake duplicate detected" || bad "create2 $(echo "$C2"|tail -2)"
ID2=$(echo "$C2" | head -1 | python3 -c 'import json,sys;print(json.load(sys.stdin)["intakeItem"]["id"])')

IG=$(curl -s -X POST "$BASE/api/intake-operations/$ID1/ignore" -b /tmp/s-e.jar)
echo "$IG" | python3 -c '
import json,sys
assert json.load(sys.stdin)["intakeItem"]["status"]=="ignored"' && ok "intake ignore" || bad "ignore $IG"

MG=$(curl -s -X POST "$BASE/api/intake-operations/$ID2/merge" -b /tmp/s-e.jar \
  -H 'Content-Type: application/json' -d "{\"targetIntakeItemId\":$ID1}")
echo "$MG" | python3 -c '
import json,sys
assert json.load(sys.stdin)["intakeItem"]["status"]=="merged"' && ok "intake merge" || bad "merge $MG"

TB="E2E adopt 稿源 $TS"
C3=$(curl -s -X POST "$BASE/api/intake-operations" -b /tmp/s-e.jar \
  -H 'Content-Type: application/json' -d "{\"channel\":\"manual\",\"title\":\"$TB\"}")
ID3=$(echo "$C3" | python3 -c 'import json,sys;print(json.load(sys.stdin)["intakeItem"]["id"])')
AD=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/intake-operations/$ID3/adopt" -b /tmp/s-e.jar \
  -H 'Content-Type: application/json' -d '{"siteId":374}')
[ "$(echo "$AD" | tail -1)" = "200" ] && echo "$AD" | head -1 | python3 -c '
import json,sys
d=json.load(sys.stdin)
assert d["sourceLinked"] is True and d["editionId"]>0 and "contentId" not in d, d' \
  && ok "intake adopt -> edition+content+source" || bad "adopt $(echo "$AD"|tail -2)"
ADOPT_ED=$(echo "$AD" | head -1 | python3 -c 'import json,sys;print(json.load(sys.stdin)["editionId"])')

# 5. 评估操作：202 + 同 key 重放 200 同 operation
EK="e2e-eval-$TS"
E1=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/workspaces/editor/editions/586/evaluation-operations" \
  -b /tmp/s-e.jar -H 'Content-Type: application/json' -H "x-request-id: ev1-$TS" -H "idempotency-key: $EK" -d '{}')
[ "$(echo "$E1" | tail -1)" = "202" ] && ok "evaluation 202" || bad "eval $(echo "$E1"|tail -2)"
E2=$(curl -s -X POST "$BASE/api/workspaces/editor/editions/586/evaluation-operations" \
  -b /tmp/s-e.jar -H 'Content-Type: application/json' -H "x-request-id: ev2-$TS" -H "idempotency-key: $EK" -d '{}')
echo "$E1" | head -1 > /tmp/e1.json; echo "$E2" > /tmp/e2.json
python3 -c '
import json
a=json.load(open("/tmp/e1.json")); b=json.load(open("/tmp/e2.json"))
assert b["created"] is False and b["operation"]["operationId"]==a["operation"]["operationId"], (a,b)' \
  && ok "evaluation replay same operation" || bad "eval replay differs"

# 6. 发布计划：586 推到 approved，create 计划，cancel 计划，退回 draft
curl -s -o /dev/null -X POST "$BASE/api/editions/586/workflow-transitions" -b /tmp/s-e.jar \
  -H 'Content-Type: application/json' -d '{"target":"review"}'
curl -s -o /dev/null -X POST "$BASE/api/editions/586/workflow-transitions" -b /tmp/s-e.jar   -H 'Content-Type: application/json' -d '{"target":"approved"}'
TZ=$(PSQL "SELECT timezone FROM geo_foundry.sites WHERE id=374")
WHEN=$(python3 -c "from datetime import datetime,timedelta,timezone;print((datetime.now(timezone.utc)+timedelta(days=1)).strftime('%Y-%m-%dT%H:00:00.000Z'))")
PC=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/publication-plan-operations" -b /tmp/s-r.jar \
  -H 'Content-Type: application/json' -d "{\"editionId\":586,\"scheduledFor\":\"$WHEN\",\"timezone\":\"$TZ\"}")
[ "$(echo "$PC" | tail -1)" = "201" ] && ok "publication plan created (tz=$TZ)" || bad "plan $(echo "$PC"|tail -2)"
PLAN=$(echo "$PC" | head -1 | python3 -c 'import json,sys;print(json.load(sys.stdin)["plan"]["planId"])')
CN=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/publication-plan-operations/$PLAN/cancel" -b /tmp/s-r.jar)
[ "$(echo "$CN" | tail -1)" = "200" ] && ok "publication plan cancelled" || bad "cancel $(echo "$CN"|tail -2)"
curl -s -o /dev/null -X POST "$BASE/api/editions/586/workflow-transitions" -b /tmp/s-e.jar \
  -H 'Content-Type: application/json' -d '{"target":"draft"}'

# 7. delivery 真实公开读：已发布详情与站点列表均为 200
DELIVERY_ED=$(PSQL "SELECT id FROM geo_foundry.content_editions WHERE workflow_status='published' AND site_id=375 ORDER BY id DESC LIMIT 1")
DELIVERY_DOMAIN=$(PSQL "SELECT hostname FROM geo_foundry.domains WHERE site_id=375 AND role='canonical' AND status='active' LIMIT 1")
DL_DETAIL=$(curl -s -w '\n%{http_code}' "$BASE/api/delivery/articles/$DELIVERY_ED")
[ -n "$DELIVERY_ED" ] && [ "$(echo "$DL_DETAIL" | tail -1)" = "200" ] && echo "$DL_DETAIL" | head -1 | python3 -c '
import json,sys
d=json.load(sys.stdin)
assert d["id"] > 0 and isinstance(d["body"], list), d
' && ok "delivery published detail 200" || bad "delivery detail $(echo "$DL_DETAIL"|tail -2)"
DL_LIST=$(curl -s -w '\n%{http_code}' "$BASE/api/delivery/sites/$DELIVERY_DOMAIN/articles?limit=1")
[ -n "$DELIVERY_DOMAIN" ] && [ "$(echo "$DL_LIST" | tail -1)" = "200" ] && echo "$DL_LIST" | head -1 | python3 -c '
import json,sys
d=json.load(sys.stdin)
assert isinstance(d["docs"], list) and d["page"] == 1, d
' && ok "delivery site list 200" || bad "delivery list $(echo "$DL_LIST"|tail -2)"

# 8. 回滚意图负例：374 无 release（用一次性 e2e publisher，root 重置密码）
curl -s -o /dev/null -X PATCH "$BASE/api/users/1112" -b /tmp/s-r.jar   -H 'Content-Type: application/json' -d '{"password":"gf-pub-e2e-001"}'
login e2e-scheduled-publisher@geo-foundry.test gf-pub-e2e-001 /tmp/s-p.jar
RB=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/rollback-operations/intents" -b /tmp/s-p.jar \
  -H 'Content-Type: application/json' -d '{"expectedCurrentManifestSha256":"'"$(printf 'a%.0s' {1..64})"'","expectedCurrentReleaseId":"rel-none","expectedManifestSha256":"'"$(printf 'b%.0s' {1..64})"'","siteId":374,"targetReleaseId":"rel-none2"}')
[ "$(echo "$RB" | tail -1)" = "404" ] && ok "rollback intent no-release 404" || bad "rollback $(echo "$RB"|tail -2)"

# 9. delivery 负例：无 canonical 域名
DL=$(curl -s -w '\n%{http_code}' "$BASE/api/delivery/sites/no-such-domain.test/articles")
[ "$(echo "$DL" | tail -1)" = "404" ] && echo "$DL" | head -1 | grep -q DELIVERY_SITE_NOT_FOUND \
  && ok "delivery unknown domain 404" || bad "delivery $(echo "$DL"|tail -2)"

# 9. 现场清理：重复稿与采用稿归档
for E in "$NEW_ED" "$ADOPT_ED"; do
  curl -s -o /dev/null -X POST "$BASE/api/editions/$E/workflow-transitions" -b /tmp/s-e.jar \
    -H 'Content-Type: application/json' -d '{"target":"archived","reason":"E2E session batch cleanup"}'
done
FIN=$(PSQL "SELECT workflow_status FROM geo_foundry.edition_revisions WHERE parent_id=586 AND latest")
[ "$FIN" = "draft" ] && ok "586 restored to draft" || bad "586 status=$FIN"

echo
echo "==== RESULT: ${#PASS[@]} passed, ${#FAIL[@]} failed ===="
rm -f /tmp/s-e.jar /tmp/s-r.jar /tmp/s-p.jar /tmp/e1.json /tmp/e2.json
[ ${#FAIL[@]} -gt 0 ] && printf 'FAILED: %s\n' "${FAIL[@]}" && exit 1
exit 0
