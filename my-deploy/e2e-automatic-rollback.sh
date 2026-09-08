#!/usr/bin/env bash
# 自动回滚全链路 E2E（Drizzle 版，替代已删除的 verify-automatic-rollback.mjs）：
# 站点级构造 current/superseded 两个 release → publisher 建 rollback intent
# （含 403/404/409 错误路径）→ 模拟 worker（consume/start/receipt/complete）
# → releases 状态翻转、intent consumed。在 mk-dev 宿主机运行。
set -uo pipefail
BASE=http://127.0.0.1:3090
SITE=375
TS=$(date +%s)
NOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
PASS=(); FAIL=()
ok() { PASS+=("$1"); echo "PASS: $1"; }
bad() { FAIL+=("$1"); echo "FAIL: $1"; }
RTPW="${GF_E2E_ROOT_PASSWORD:?}"
PBPW="${GF_E2E_PUBLISHER_PASSWORD:?}"

PSQL() { sudo docker exec pg-server psql -U gpucloud -d geo_foundry -qAt -c "$1"; }
Q() { PSQL "SELECT $1"; }

login() { # email pass jar
  curl -s -X POST $BASE/api/users/login -H 'Content-Type: application/json'     -d "{\"email\":\"$1\",\"password\":\"$2\"}" -c "$3" -o /dev/null
}
login gf-root-test@geo-foundry.dev "$RTPW" /tmp/rb-r.jar
login e2e-scheduled-publisher@geo-foundry.test "$PBPW" /tmp/rb-p.jar
SKEY=$(sudo python3 -c 'import json;print(json.load(open("/opt/geo-foundry/credentials/content-service-keyring.json"))["tenants"]["413"])')
auth() { echo "Authorization: users API-Key $SKEY"; }

# ---------- 1. 站点级构造 A(superseded) <- B(current) ----------
SHA_A=$(python3 -c "import hashlib;print(hashlib.sha256(b'e2e-rb-a-$TS').hexdigest())")
SHA_B=$(python3 -c "import hashlib;print(hashlib.sha256(b'e2e-rb-b-$TS').hexdigest())")
REL_A="rel-e2e-rb-a-$TS"
REL_B="rel-e2e-rb-b-$TS"
publish() { # releaseId sha
  curl -s -o /dev/null -X POST "$BASE/api/internal/sites/$SITE/releases/published" \
    -H "$(auth)" -H 'Content-Type: application/json' \
    -d "{\"operationId\":\"e2e-rb-op-$TS\",\"receipt\":{\"action\":\"publish\",\"actor\":{\"kind\":\"service\",\"actorId\":\"geo-foundry-worker\"},\"schemaVersion\":1,\"releaseId\":\"$1\",\"manifestSha256\":\"$2\",\"siteId\":\"site-$SITE\",\"recordedAt\":\"$NOW\",\"newEtag\":\"\\\"rb$TS\\\"\",\"oldEtag\":null}}"
}
publish "$REL_A" "$SHA_A"
publish "$REL_B" "$SHA_B"
ST_A=$(Q "state FROM geo_foundry.releases WHERE release_id='$REL_A'")
ST_B=$(Q "state FROM geo_foundry.releases WHERE release_id='$REL_B'")
[ "$ST_A" = "superseded" ] && [ "$ST_B" = "current" ] && ok "A superseded / B current staged" \
  || { bad "stage A=$ST_A B=$ST_B"; exit 1; }

# ---------- 2. intent 创建错误路径 ----------
S=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/rollback-operations/intents" -b /tmp/rb-r.jar \
  -H 'Content-Type: application/json' \
  -d "{\"siteId\":$SITE,\"expectedCurrentReleaseId\":\"$REL_B\",\"expectedCurrentManifestSha256\":\"$SHA_B\",\"targetReleaseId\":\"$REL_A\",\"expectedManifestSha256\":\"$SHA_A\"}")
[ "$(echo "$S" | tail -1)" = "403" ] && ok "super-admin intent -> 403 publisher only" || bad "role gate $(echo "$S"|tail -2)"
S=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/rollback-operations/intents" -b /tmp/rb-p.jar \
  -H 'Content-Type: application/json' \
  -d "{\"siteId\":$SITE,\"expectedCurrentReleaseId\":\"rel-e2e-rb-missing-$TS\",\"expectedCurrentManifestSha256\":\"$SHA_B\",\"targetReleaseId\":\"$REL_A\",\"expectedManifestSha256\":\"$SHA_A\"}")
[ "$(echo "$S" | tail -1)" = "404" ] && ok "unknown release -> 404" || bad "unknown $(echo "$S"|tail -2)"
S=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/rollback-operations/intents" -b /tmp/rb-p.jar \
  -H 'Content-Type: application/json' \
  -d "{\"siteId\":$SITE,\"expectedCurrentReleaseId\":\"$REL_B\",\"expectedCurrentManifestSha256\":\"$(python3 -c 'print("0"*64)')\",\"targetReleaseId\":\"$REL_A\",\"expectedManifestSha256\":\"$SHA_A\"}")
[ "$(echo "$S" | tail -1)" = "409" ] && ok "wrong current manifest -> 409 STATE_MISMATCH" || bad "mismatch $(echo "$S"|tail -2)"

# ---------- 3. 正确创建 intent ----------
I1=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/rollback-operations/intents" -b /tmp/rb-p.jar \
  -H 'Content-Type: application/json' \
  -d "{\"siteId\":$SITE,\"expectedCurrentReleaseId\":\"$REL_B\",\"expectedCurrentManifestSha256\":\"$SHA_B\",\"targetReleaseId\":\"$REL_A\",\"expectedManifestSha256\":\"$SHA_A\",\"reason\":\"e2e rollback $TS\"}")
BODY=$(echo "$I1" | head -1); CODE=$(echo "$I1" | tail -1)
INTENT=$(echo "$BODY" | python3 -c 'import json,sys;print(json.load(sys.stdin)["intentId"])' 2>/dev/null)
OP=$(echo "$BODY" | python3 -c 'import json,sys;print(json.load(sys.stdin)["operationId"])' 2>/dev/null)
[ "$CODE" = "201" ] && [ -n "$INTENT" ] && ok "intent created (op=$OP)" || { bad "intent $I1"; exit 1; }
ROW=$(Q "consumed_at IS NULL FROM geo_foundry.rollback_intents WHERE intent_id='$INTENT'")
OPT=$(Q "state FROM geo_foundry.operations WHERE operation_id='$OP'")
OBT=$(Q "count(*) FROM geo_foundry.outbox_events WHERE type='rollback.requested' AND operation_id='$OP'")
[ "$ROW" = "t" ] && [ "$OPT" = "queued" ] && [ "$OBT" -ge 1 ] \
  && ok "intent+operation queued + rollback.requested outbox" || bad "intent row=$ROW op=$OPT outbox=$OBT"

# ---------- 4. consume：mismatch 拒绝 → 正确 → 重放幂等 ----------
MISM="{\"expectedCurrentManifestSha256\":\"$SHA_B\",\"expectedCurrentReleaseId\":\"rel-wrong-$TS\",\"expectedManifestSha256\":\"$SHA_A\",\"operationId\":\"$OP\",\"rollbackIntentId\":\"$INTENT\",\"runtimeSiteId\":\"site-$SITE\",\"targetReleaseId\":\"$REL_A\"}"
S=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/internal/rollback-intents/consume" -H "$(auth)" \
  -H 'Content-Type: application/json' -d "$MISM")
[ "$(echo "$S" | tail -1)" = "409" ] && ok "consume mismatch -> 409" || bad "consume mismatch $(echo "$S"|tail -2)"
GOOD="{\"expectedCurrentManifestSha256\":\"$SHA_B\",\"expectedCurrentReleaseId\":\"$REL_B\",\"expectedManifestSha256\":\"$SHA_A\",\"operationId\":\"$OP\",\"rollbackIntentId\":\"$INTENT\",\"runtimeSiteId\":\"site-$SITE\",\"targetReleaseId\":\"$REL_A\"}"
S=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/internal/rollback-intents/consume" -H "$(auth)" \
  -H 'Content-Type: application/json' -d "$GOOD")
[ "$(echo "$S" | tail -1)" = "200" ] && ok "consume ok" || bad "consume $(echo "$S"|tail -2)"
S=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/internal/rollback-intents/consume" -H "$(auth)" \
  -H 'Content-Type: application/json' -d "$GOOD")
[ "$(echo "$S" | tail -1)" = "200" ] && ok "consume replay 200 (idempotent)" || bad "replay $(echo "$S"|tail -2)"
CN=$(Q "consumed_at IS NOT NULL FROM geo_foundry.rollback_intents WHERE intent_id='$INTENT'")
[ "$CN" = "t" ] && ok "intent consumed_at written" || bad "consumed_at=$CN"

# ---------- 5. 模拟 worker 执行回滚 ----------
curl -s -o /dev/null -X POST "$BASE/api/internal/operations/$OP/stages/start" -H "$(auth)" \
  -H 'Content-Type: application/json' -H "x-request-id: rb-s1-$TS" -H "x-operation-id: $OP" \
  -d '{"attempt":1,"stage":"rollback-gate"}'
NOW2=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
RR="{\"operationId\":\"$OP\",\"receipt\":{\"action\":\"rollback\",\"actor\":{\"kind\":\"service\",\"actorId\":\"geo-foundry-worker\"},\"schemaVersion\":1,\"releaseId\":\"$REL_A\",\"manifestSha256\":\"$SHA_A\",\"siteId\":\"site-$SITE\",\"recordedAt\":\"$NOW2\",\"newEtag\":\"\\\"rb2$TS\\\"\",\"oldEtag\":\"\\\"rb$TS\\\"\",\"fromReleaseId\":\"$REL_B\",\"fromManifestSha256\":\"$SHA_B\"}}"
S=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/internal/releases/rollback-receipt" -H "$(auth)" \
  -H 'Content-Type: application/json' -d "$RR")
[ "$(echo "$S" | tail -1)" = "200" ] && ok "rollback receipt 200" || bad "receipt $(echo "$S"|tail -2)"
curl -s -o /dev/null -X POST "$BASE/api/internal/operations/$OP/stages/complete" -H "$(auth)" \
  -H 'Content-Type: application/json' -H "x-request-id: rb-s2-$TS" -H "x-operation-id: $OP" \
  -d '{"attempt":1,"outcome":"succeeded","stage":"rollback-gate","result":{}}'

# ---------- 6. 终态断言 ----------
ST_A=$(Q "state FROM geo_foundry.releases WHERE release_id='$REL_A'")
ST_B=$(Q "state FROM geo_foundry.releases WHERE release_id='$REL_B'")
[ "$ST_A" = "current" ] && [ "$ST_B" = "rolled_back" ] \
  && ok "releases flipped: target=current, source=rolled_back" || bad "final A=$ST_A B=$ST_B"
OPF=$(Q "state FROM geo_foundry.operations WHERE operation_id='$OP'")
[ "$OPF" = "succeeded" ] && ok "rollback operation succeeded" || bad "op=$OPF"

echo "PASS=${#PASS[@]} FAIL=${#FAIL[@]}"
[ "${#FAIL[@]}" = "0" ]
