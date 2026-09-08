#!/usr/bin/env bash
# 内部端点批次 E2E（worker 调用面）：intake fetch 链 / RSS 子项 / compile-snapshot /
# dispatch-due / release receipt / rollback consume。在 mk-dev 宿主机运行。
# 只写测试数据：SQL 直插的 intake 行、租户 413 的过期发布计划（文章 586 为归档测试文章）。
set -uo pipefail
BASE=http://127.0.0.1:3090
TS=$(date +%s)
PASS=(); FAIL=()
ok() { PASS+=("$1"); echo "PASS: $1"; }
bad() { FAIL+=("$1"); echo "FAIL: $1"; }
PSQL() { sudo docker exec pg-server psql -U gpucloud -d geo_foundry -qAt -c "$1"; }
KEY=$(sudo python3 -c 'import json;print(json.load(open("/opt/geo-foundry/credentials/content-service-keyring.json"))["tenants"]["413"])')
[ -n "$KEY" ] || { echo "keyring missing"; exit 1; }
H=(-H "Authorization: users API-Key $KEY" -H "Content-Type: application/json" -H "x-request-id: e2e-internal-$TS")
call() { # method path [body] -> prints body\nstatus
  if [ -n "${3:-}" ]; then curl -s -w '\n%{http_code}' -X "$1" "$BASE/api$2" "${H[@]}" -d "$3"
  else curl -s -w '\n%{http_code}' -X "$1" "$BASE/api$2" "${H[@]}"; fi
}
status() { echo "$1" | tail -1; }
body() { echo "$1" | head -1; }
jget() { python3 -c "import json,sys;d=json.load(sys.stdin);print(eval('d'+sys.argv[1]))" "$1"; }

# ---------- 1. URL intake fetch 链 ----------
IT=$(PSQL "INSERT INTO geo_foundry.intake_items (tenant_id, channel, title, source_url, normalized_url, status, duplicate_status) VALUES (413,'url','E2E internal $TS','https://example.com/e2e-$TS','https://example.com/e2e-$TS','new','unique') RETURNING id")
[ -n "$IT" ] && ok "intake fixture $IT" || { bad "intake fixture"; exit 1; }

R=$(call POST "/internal/intake-items/$IT/fetch-start")
[ "$(status "$R")" = 200 ] && [ "$(PSQL "SELECT status FROM geo_foundry.intake_items WHERE id=$IT")" = fetching ] \
  && ok "fetch-start -> fetching" || bad "fetch-start $R"
R=$(call POST "/internal/intake-items/$IT/fetch-start")
[ "$(status "$R")" = 200 ] && ok "fetch-start replay 200" || bad "fetch-start replay $R"

R=$(call GET "/internal/intake-items/$IT/fetch-input")
[ "$(status "$R")" = 200 ] && [ "$(body "$R" | jget '["channel"]')" = url ] \
  && [ "$(body "$R" | jget '["sourceUrl"]')" = "https://example.com/e2e-$TS" ] \
  && ok "fetch-input url shape" || bad "fetch-input $R"

H1=$(printf 'a%.0s' {1..64}); H2=$(printf 'b%.0s' {1..64}); H3=$(printf 'c%.0s' {1..64})
COMPLETE="{\"raw\":{\"contentHash\":\"$H1\",\"contentLength\":1200,\"contentType\":\"text/html\",\"storageKey\":\"e2e/$TS/raw.html\"},\"extracted\":{\"contentHash\":\"$H2\",\"contentLength\":300,\"contentType\":\"text/plain\",\"storageKey\":\"e2e/$TS/extracted.txt\"},\"summary\":\"E2E summary $TS\",\"title\":\"E2E fetched $TS\",\"contentBlocks\":[{\"blockType\":\"paragraph\",\"text\":\"hello $TS\"}]}"
R=$(call POST "/internal/intake-items/$IT/fetch-complete" "$COMPLETE")
SNAP=$(body "$R" | jget '["snapshotId"]' 2>/dev/null)
[ "$(status "$R")" = 200 ] && [ -n "$SNAP" ] \
  && [ "$(PSQL "SELECT status||'|'||title||'|'||snapshot_id||'|'||content_hash FROM geo_foundry.intake_items WHERE id=$IT")" = "ready|E2E fetched $TS|$SNAP|$H2" ] \
  && [ "$(PSQL "SELECT count(*) FROM geo_foundry.source_snapshots WHERE intake_item_id=$IT")" = 2 ] \
  && ok "fetch-complete -> ready + 2 snapshots" || bad "fetch-complete $R"
R=$(call POST "/internal/intake-items/$IT/fetch-complete" "$COMPLETE")
[ "$(status "$R")" = 200 ] && [ "$(body "$R" | jget '["snapshotId"]')" = "$SNAP" ] \
  && ok "fetch-complete replay same snapshot" || bad "fetch-complete replay $R"
CONFLICT=$(echo "$COMPLETE" | sed "s/$H2/$H3/")
R=$(call POST "/internal/intake-items/$IT/fetch-complete" "$CONFLICT")
[ "$(status "$R")" = 409 ] && [ "$(body "$R" | jget '["error"]["code"]')" = INTAKE_SNAPSHOT_CONFLICT ] \
  && ok "fetch-complete storageKey conflict 409" || bad "snapshot conflict $R"
R=$(call POST "/internal/intake-items/$IT/fetch-failed" '{"code":"E2E","reason":"should not apply"}')
[ "$(status "$R")" = 409 ] && ok "fetch-failed on ready 409" || bad "fetch-failed ready $R"

# 失败路径：新建一条 new，直接 fail
IT2=$(PSQL "INSERT INTO geo_foundry.intake_items (tenant_id, channel, title, source_url, normalized_url, status, duplicate_status) VALUES (413,'url','E2E fail $TS','https://example.com/e2e-fail-$TS','https://example.com/e2e-fail-$TS','new','unique') RETURNING id")
R=$(call POST "/internal/intake-items/$IT2/fetch-failed" '{"code":"E2E_TIMEOUT","reason":"simulated"}')
[ "$(status "$R")" = 200 ] && [ "$(PSQL "SELECT status||'|'||failure_code FROM geo_foundry.intake_items WHERE id=$IT2")" = "failed|E2E_TIMEOUT" ] \
  && ok "fetch-failed new -> failed" || bad "fetch-failed $R"
R=$(call GET "/internal/intake-items/999999999/fetch-input")
[ "$(status "$R")" = 404 ] && ok "fetch-input unknown 404" || bad "unknown intake $R"

# ---------- 2. RSS 子项 ----------
IT3=$(PSQL "INSERT INTO geo_foundry.intake_items (tenant_id, channel, connector_id, title, status, duplicate_status, suggested_site_id) VALUES (413,'rss',2,'E2E rss $TS','new','unique',375) RETURNING id")
R=$(call GET "/internal/intake-items/$IT3/fetch-input")
# connector 2 为 disabled → INTAKE_CONNECTOR_INVALID 400
[ "$(status "$R")" = 400 ] && [ "$(body "$R" | jget '["error"]["code"]')" = INTAKE_CONNECTOR_INVALID ] \
  && ok "rss fetch-input disabled connector 400" || bad "rss disabled $R"
PSQL "UPDATE geo_foundry.connectors SET status='active' WHERE id=2" >/dev/null
R=$(call GET "/internal/intake-items/$IT3/fetch-input")
[ "$(status "$R")" = 200 ] && [ "$(body "$R" | jget '["channel"]')" = rss ] && [ "$(body "$R" | jget '["connectorId"]')" = 2 ] \
  && ok "rss fetch-input active connector" || bad "rss active $R"
ENTRIES="{\"entries\":[{\"title\":\"E2E rss a $TS\",\"sourceUrl\":\"https://example.com/rss-$TS-a?utm_source=x\"},{\"title\":\"E2E rss b $TS\",\"sourceUrl\":\"https://example.com/rss-$TS-b\",\"summary\":\"s\"},{\"title\":\"E2E rss dup $TS\",\"sourceUrl\":\"https://example.com/e2e-$TS\"}]}"
R=$(call POST "/internal/intake-items/$IT3/rss-entries" "$ENTRIES")
N=$(body "$R" | python3 -c 'import json,sys;print(len(json.load(sys.stdin)["intakeItemIds"]))' 2>/dev/null)
[ "$(status "$R")" = 200 ] && [ "$N" = 2 ] \
  && [ "$(PSQL "SELECT count(*) FROM geo_foundry.intake_items WHERE connector_id=2 AND channel='url' AND normalized_url IN ('https://example.com/rss-$TS-a','https://example.com/rss-$TS-b')")" = 2 ] \
  && ok "rss-entries 2 created, known URL skipped, utm stripped" || bad "rss-entries $R n=$N"
R=$(call POST "/internal/intake-items/$IT3/rss-entries" "$ENTRIES")
N=$(body "$R" | python3 -c 'import json,sys;print(len(json.load(sys.stdin)["intakeItemIds"]))' 2>/dev/null)
[ "$(status "$R")" = 200 ] && [ "$N" = 0 ] && ok "rss-entries re-poll creates 0" || bad "rss re-poll $R n=$N"
PSQL "UPDATE geo_foundry.connectors SET status='disabled' WHERE id=2" >/dev/null

# ---------- 3. compile-snapshot ----------
R=$(call GET "/internal/sites/375/compile-snapshot")
EXPECT=$(PSQL "SELECT count(*) FROM geo_foundry.edition_revisions v JOIN geo_foundry.url_records u ON u.edition_id=v.parent_id AND u.site_id=375 AND u.state='active' WHERE v.latest AND v.site_id=375 AND v.workflow_status IN ('approved','compiled','published')")
GOT=$(body "$R" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(len(d["editions"]))' 2>/dev/null)
[ "$(status "$R")" = 200 ] && [ "$(body "$R" | jget '["site"]["canonicalDomain"]')" = e2e-scheduled-publish-375.test ] \
  && [ "$GOT" = "$EXPECT" ] && ok "compile-snapshot site 375 editions=$GOT" || bad "compile-snapshot $(status "$R") got=$GOT expect=$EXPECT"
body "$R" | python3 -c '
import json,sys
d=json.load(sys.stdin)
for e in d["editions"]:
    assert isinstance(e["body"], list) and e["urlPathname"].startswith("/") and e["publishedAt"].endswith("Z"), e
assert d["listings"]["articles"]["pathname"]=="/articles"
' && ok "compile-snapshot edition shape" || bad "compile-snapshot shape"
R=$(call GET "/internal/sites/376/compile-snapshot")
[ "$(status "$R")" = 404 ] && ok "compile-snapshot foreign tenant 404" || bad "compile-snapshot foreign $R"
R=$(call GET "/internal/sites/374/compile-snapshot")
[ "$(status "$R")" = 500 ] && ok "compile-snapshot no canonical domain 500 (legacy parity)" || bad "compile-snapshot 374 $R"

# ---------- 4. dispatch-due ----------
NOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
R=$(call POST "/internal/publication-plans/dispatch-due" "{\"now\":\"$NOW\",\"workerId\":\"e2e-$TS\"}")
[ "$(status "$R")" = 200 ] && body "$R" | python3 -c 'import json,sys;assert isinstance(json.load(sys.stdin)["plans"],list)' \
  && ok "dispatch-due baseline 200" || bad "dispatch-due $R"
# 过期计划指向 draft 状态的 586 → 认领后提交失败 → failed + lastError
PLAN=e2e-plan-$TS
PSQL "INSERT INTO geo_foundry.publication_plans (plan_id, tenant_id, site_id, edition_id, requested_by_id, scheduled_for, timezone, status) VALUES ('$PLAN',413,374,586,1112, now() - interval '1 hour','UTC','pending')" >/dev/null
R=$(call POST "/internal/publication-plans/dispatch-due" "{\"now\":\"$NOW\",\"workerId\":\"e2e-$TS\"}")
ROW=$(PSQL "SELECT status||'|'||coalesce(last_error,'')||'|'||attempts||'|'||coalesce(claimed_by,'') FROM geo_foundry.publication_plans WHERE plan_id='$PLAN'")
[ "$(status "$R")" = 200 ] && [ "$ROW" = "failed|EDITION_WORKFLOW_NOT_APPROVED|1|e2e-$TS" ] \
  && ok "dispatch-due claims and fails not-approved plan" || bad "dispatch-due plan row=$ROW $R"

# ---------- 5. release receipts ----------
CUR=$(PSQL "SELECT release_id||'|'||manifest_sha256 FROM geo_foundry.releases WHERE site_id=375 AND state='current' LIMIT 1")
CUR_ID=${CUR%%|*}; CUR_SHA=${CUR##*|}
ACTOR='{"kind":"service","actorId":"geo-foundry-worker"}'
REC="{\"operationId\":\"e2e-op-$TS\",\"receipt\":{\"action\":\"publish\",\"actor\":$ACTOR,\"schemaVersion\":1,\"releaseId\":\"$CUR_ID\",\"manifestSha256\":\"$CUR_SHA\",\"siteId\":\"site-375\",\"recordedAt\":\"$NOW\",\"newEtag\":\"\\\"e2e$TS\\\"\",\"oldEtag\":null}}"
R=$(call POST "/internal/sites/375/releases/published" "$REC")
[ "$(status "$R")" = 200 ] && [ "$(PSQL "SELECT state FROM geo_foundry.releases WHERE release_id='$CUR_ID'")" = current ] \
  && ok "published receipt replay keeps current" || bad "published receipt $R"
R=$(call POST "/internal/sites/374/releases/published" "$REC")
[ "$(status "$R")" = 409 ] && [ "$(body "$R" | jget '["error"]["code"]')" = RELEASE_SITE_MISMATCH ] \
  && ok "published receipt site mismatch 409" || bad "site mismatch $R"
R=$(call POST "/internal/sites/376/releases/published" "$REC")
[ "$(status "$R")" = 404 ] && ok "published receipt foreign site 404" || bad "foreign site $R"
ROLL="{\"operationId\":\"e2e-op-$TS\",\"receipt\":{\"action\":\"rollback\",\"actor\":$ACTOR,\"schemaVersion\":1,\"releaseId\":\"rel-e2emissing$TS\",\"manifestSha256\":\"$H1\",\"siteId\":\"site-375\",\"recordedAt\":\"$NOW\",\"newEtag\":\"\\\"e2e$TS\\\"\",\"oldEtag\":\"\\\"old$TS\\\"\",\"fromReleaseId\":\"$CUR_ID\",\"fromManifestSha256\":\"$CUR_SHA\"}}"
R=$(call POST "/internal/releases/rollback-receipt" "$ROLL")
[ "$(status "$R")" = 409 ] && [ "$(body "$R" | jget '["error"]["code"]')" = RELEASE_RECONCILIATION_REQUIRED ] \
  && ok "rollback receipt unknown target 409" || bad "rollback receipt $R"

# ---------- 6. rollback intent consume ----------
INT=$(PSQL "SELECT intent_id||'|'||runtime_site_id||'|'||target_release_id||'|'||expected_manifest_sha256||'|'||expected_current_release_id||'|'||expected_current_manifest_sha256||'|'||operation_id FROM geo_foundry.rollback_intents WHERE tenant_id=413 AND consumed_at IS NOT NULL AND operation_id IS NOT NULL ORDER BY id DESC LIMIT 1")
IFS='|' read -r I_ID I_SITE I_TARGET I_SHA I_CUR I_CURSHA I_OP <<<"$INT"
CONS="{\"rollbackIntentId\":\"$I_ID\",\"runtimeSiteId\":\"$I_SITE\",\"targetReleaseId\":\"$I_TARGET\",\"expectedManifestSha256\":\"$I_SHA\",\"expectedCurrentReleaseId\":\"$I_CUR\",\"expectedCurrentManifestSha256\":\"$I_CURSHA\",\"operationId\":\"$I_OP\"}"
R=$(call POST "/internal/rollback-intents/consume" "$CONS")
[ "$(status "$R")" = 200 ] && ok "consume replay by same operation 200" || bad "consume replay $R"
R=$(call POST "/internal/rollback-intents/consume" "$(echo "$CONS" | sed "s/\"operationId\":\"$I_OP\"/\"operationId\":\"other-op-$TS\"/")")
[ "$(status "$R")" = 409 ] && [ "$(body "$R" | jget '["error"]["code"]')" = ROLLBACK_INTENT_MISMATCH ] \
  && ok "consume by other operation 409" || bad "consume other $R"
R=$(call POST "/internal/rollback-intents/consume" "$(echo "$CONS" | sed "s/$I_ID/00000000-0000-4000-8000-000000000000/")")
[ "$(status "$R")" = 404 ] && ok "consume unknown intent 404" || bad "consume unknown $R"

# ---------- 7. 已删端点 ----------
for p in /internal/operations/generate /internal/operations/evaluate /internal/operations/rollback /internal/operations/submit; do
  R=$(call POST "$p" '{}')
  [ "$(status "$R")" = 404 ] && ok "removed $p 404" || bad "removed $p $(status "$R")"
done

# ---------- 清理 ----------
PSQL "DELETE FROM geo_foundry.publication_plans WHERE plan_id='$PLAN'" >/dev/null
PSQL "DELETE FROM geo_foundry.source_snapshots WHERE intake_item_id IN ($IT)" >/dev/null
PSQL "DELETE FROM geo_foundry.intake_items WHERE id IN ($IT,$IT2,$IT3) OR normalized_url IN ('https://example.com/rss-$TS-a','https://example.com/rss-$TS-b')" >/dev/null

echo; echo "PASS=${#PASS[@]} FAIL=${#FAIL[@]}"; for f in "${FAIL[@]}"; do echo "  - $f"; done
