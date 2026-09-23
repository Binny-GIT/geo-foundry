#!/usr/bin/env bash
# 一次性探针：建 disposable 文章 → review → approve → 记 passed 评估
# → 直接调编译快照端点，打印该文章的快照条目（排查 ASSESSMENT_NOT_PASSED）。
# 用法：在 mk-dev 宿主机 bash probe-compile-snapshot.sh；结束输出 PROBE_ED。
set -uo pipefail
BASE=http://127.0.0.1:3090
SITE=375
TS=$(date +%s)
EDPW="${GF_E2E_EDITOR_PASSWORD:?}"
RTPW="${GF_E2E_ROOT_PASSWORD:?}"
SKEY=$(sudo python3 -c 'import json;print(json.load(open("/opt/geo-foundry/credentials/content-service-keyring.json"))["tenants"]["413"])')
login() {
  curl -s -X POST "$BASE/api/users/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" -c "$3" -o /dev/null
}
login gf-editor-test@geo-foundry.dev "$EDPW" /tmp/probe-e.jar
login gf-root-test@geo-foundry.dev "$RTPW" /tmp/probe-r.jar

C=$(curl -s -X POST "$BASE/api/content-editions?draft=true&depth=0" -b /tmp/probe-e.jar \
  -H 'Content-Type: application/json' -d "{\"title\":\"probe $TS\",\"bodyMarkdown\":\"# x\",\"site\":$SITE}")
ED=$(echo "$C" | python3 -c 'import json,sys;print(json.load(sys.stdin)["doc"]["id"])')
echo "ED=$ED"

curl -s -o /dev/null -X POST "$BASE/api/editions/$ED/workflow-transitions" -b /tmp/probe-e.jar \
  -H 'Content-Type: application/json' -d '{"target":"review"}'
R1=$(curl -s -b /tmp/probe-e.jar "$BASE/api/content-editions/$ED?draft=true&depth=0" \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["workflowRevision"])')
A1=$(curl -s -X POST "$BASE/api/workspaces/reviewer/editions/$ED/approve" -b /tmp/probe-r.jar \
  -H 'Content-Type: application/json' -H "x-request-id: probe-$TS" -H "idempotency-key: probe-ap-$TS" \
  -d "{\"expectedRevision\":$R1}")
echo "approve: $(echo "$A1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["workflowStatus"])')"

IH=$(curl -s -H "Authorization: users API-Key $SKEY" "$BASE/api/internal/editions/$ED/input" \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["inputHash"])')
TH=$(python3 -c 'import hashlib;print(hashlib.sha256(b"probe").hexdigest())')
AS=$(curl -s -X POST "$BASE/api/internal/editions/$ED/assessments" \
  -H "Authorization: users API-Key $SKEY" -H 'Content-Type: application/json' \
  -d "{\"inputHash\":\"$IH\",\"issues\":[],\"modelId\":\"probe\",\"overall\":90,\"promptVersion\":\"p1\",\"provider\":\"e2e\",\"state\":\"passed\",\"thresholdsHash\":\"$TH\"}")
echo "assessment: $AS"

curl -s -H "Authorization: users API-Key $SKEY" "$BASE/api/internal/sites/$SITE/compile-snapshot" \
  | python3 -c '
import json, sys
snap = json.load(sys.stdin)
target = int(sys.argv[1])
hits = [e for e in snap["editions"] if e.get("editionId") == target]
if not hits:
    print("NOT_IN_SNAPSHOT (editions=%d)" % len(snap["editions"]))
else:
    e = hits[0]
    print(json.dumps({k: e.get(k) for k in
          ("editionId", "status", "assessmentState", "assessmentInputHash", "urlPathname", "urlStatus", "title")},
          ensure_ascii=False))
' "$ED"

rm -f /tmp/probe-e.jar /tmp/probe-r.jar
echo "PROBE_ED=$ED"
