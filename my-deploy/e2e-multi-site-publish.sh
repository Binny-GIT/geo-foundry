#!/usr/bin/env bash
# A2 多站发布 E2E：
#  1. 两站文章（site 375 + 一次性无域名站 C，locale sv-SE）审批 → 两站各预留 URL；
#     publish-operations 扇出两条操作（operations 数组响应），操作行按站落
#     site_id、幂等键逐站不同；
#     375 成功、C 因无 canonical 域名编译失败（重试耗尽终态 failed）；
#     文章级 published 由首站成功推进，edition_sites 行按站更新。
#  2. 给 C 补 canonical 域名后单站重试（显式 siteId，published 门禁放行），
#     C 站 release 成功、URL active、行 published；非成员站重试被拒。
#  3. 单站文章走完整链路，与 A1 部署后（mk-dev-746a3ab）录制的基线
#     /tmp/a2-baseline-*.json 按字段对照（id/时间戳/站点内容漂移豁免；
#     edition_sites 行 A2 首次回填 published/release/urlRecordId；
#     request_payload.body 新增 siteId 为预期差异）。
# 收尾：两篇文章 draft-from-published → archived，删除 C 站与其域名行。
# 在 mk-dev 宿主机运行；需要 GF_E2E_EDITOR_PASSWORD / GF_E2E_ROOT_PASSWORD /
# GF_E2E_PUBLISHER_PASSWORD；基线文件须已在 /tmp/a2-baseline-*.json。
set -uo pipefail
BASE=http://127.0.0.1:3090
SITE=375
TENANT=413
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
login gf-editor-test@geo-foundry.dev "$EDPW" /tmp/ms-e.jar
login gf-root-test@geo-foundry.dev "$RTPW" /tmp/ms-r.jar
login e2e-scheduled-publisher@geo-foundry.test "$PBPW" /tmp/ms-p.jar
echo "logins ok"
SKEY=$(sudo python3 -c 'import json;print(json.load(open("/opt/geo-foundry/credentials/content-service-keyring.json"))["tenants"]["413"])')
auth() { echo "Authorization: users API-Key $SKEY"; }

st_of() { echo "$1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["workflowStatus"])'; }
rev_of() { echo "$1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["workflowRevision"])'; }
draft() { curl -s -b /tmp/ms-e.jar "$BASE/api/content-editions/$1?draft=true&depth=0"; }

# A3 质量检查按站：评估结论按 (文章 × 站点) 回填，每个成员站一行。
THRESH_HASH=$(python3 -c "import hashlib;print(hashlib.sha256(b'e2e-multi-site-defaults').hexdigest())")
input_hash_of() { curl -s -H "$(auth)" "$BASE/api/internal/editions/$1/input" | python3 -c 'import json,sys;print(json.load(sys.stdin)["inputHash"])'; }
post_assessment() { # $1=edition $2=siteId $3=request-id-tag $4=inputHash
  curl -s -X POST "$BASE/api/internal/editions/$1/assessments" -H "$(auth)" \
    -H 'Content-Type: application/json' -H "x-request-id: $3-$TS" \
    -d "{\"siteId\":$2,\"inputHash\":\"$4\",\"issues\":[],\"modelId\":\"e2e-multi-site\",\"overall\":90,\"dimensions\":{\"content\":90,\"seo\":90,\"structure\":90},\"promptVersion\":\"e2e-1\",\"provider\":\"e2e\",\"state\":\"passed\",\"thresholdsHash\":\"$THRESH_HASH\"}"
}
assess_ok() { [ "$(echo "$1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["assessmentId"]>0)')" = "True" ]; }

SITE_C=""
# 夹具站删除：sites 被 domains/url_records/releases/operations 外键引用，
# 必须先删依赖表行（仅按夹具站 id 精确删除，不碰业务行）。
purge_fixture_site() {
  PSQL "DELETE FROM geo_foundry.url_records WHERE site_id=$1" >/dev/null
  PSQL "DELETE FROM geo_foundry.edition_sites WHERE site_id=$1" >/dev/null
  PSQL "DELETE FROM geo_foundry.operations WHERE site_id=$1" >/dev/null
  PSQL "DELETE FROM geo_foundry.releases WHERE site_id=$1" >/dev/null
  PSQL "DELETE FROM geo_foundry.domains WHERE site_id=$1" >/dev/null
  PSQL "DELETE FROM geo_foundry.sites WHERE id=$1 AND name='E2E A2 NoDomain'" >/dev/null
}
cleanup_site_c() {
  [ -n "$SITE_C" ] && purge_fixture_site "$SITE_C"
}
trap cleanup_site_c EXIT

# ---------- 0. 前提、幂等预清理与夹具站 ----------
DOMAIN=$(Q "hostname FROM geo_foundry.domains WHERE site_id=$SITE AND role='canonical' AND status='active' LIMIT 1")
[ -n "$DOMAIN" ] && ok "site $SITE canonical domain=$DOMAIN" || { bad "site $SITE 无 canonical 域名"; exit 1; }

# 仅清理本次创建的站点；历史夹具无法证明归属时必须中止。
OLD_FIXTURES=$(PSQL "SELECT id FROM geo_foundry.sites WHERE name='E2E A2 NoDomain'")
[ -z "$OLD_FIXTURES" ] || { bad "old fixture sites need manual review: $OLD_FIXTURES"; exit 1; }

# 站点内其他未评估文章会阻断整站编译；只报错，不替用户改动其工作流。
# A3：门禁按 (文章 × 本站) 取最新评估，其他站的 passed 不能替本站背书。
STALE=$(Q "ce.id FROM geo_foundry.content_editions ce
  JOIN geo_foundry.edition_revisions ev ON ev.parent_id = ce.id AND ev.latest
  WHERE ev.site_id = $SITE AND ev.workflow_status IN ('approved','compiled','published')
    AND NOT EXISTS (SELECT 1 FROM geo_foundry.quality_assessments qa
      WHERE qa.edition_id = ce.id AND qa.site_id = $SITE AND qa.state = 'passed')
  ORDER BY ce.id")
[ -z "$STALE" ] || { bad "site $SITE has unassessed editions: $STALE"; exit 1; }

SITE_C=$(PSQL "INSERT INTO geo_foundry.sites (name, tenant_id, locale, timezone, status)
  VALUES ('E2E A2 NoDomain', $TENANT, 'sv-SE', 'UTC', 'active') RETURNING id")
[ -n "$SITE_C" ] && ok "fixture site C created (id=$SITE_C, no domain)" || { bad "site C create"; exit 1; }

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

# ---------- 1. 两站文章到 approved ----------
C1=$(python3 -c 'import json,sys;print(json.dumps({"title":sys.argv[1],"bodyMarkdown":sys.argv[2],"site":int(sys.argv[3]),"sites":[int(sys.argv[4])]},ensure_ascii=False))' \
  "E2E A2 多站发布 MS $TS" "A2 多站扇出验证正文：两站各一条发布操作。" "$SITE" "$SITE_C" | \
  curl -s -X POST "$BASE/api/content-editions?draft=true&depth=0" -b /tmp/ms-e.jar \
    -H 'Content-Type: application/json' -d @-)
ED=$(echo "$C1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["doc"]["id"])')
[ -n "$ED" ] && ok "two-site draft created (edition=$ED, sites=$SITE,$SITE_C)" || { bad "create $C1"; exit 1; }
curl -s -o /dev/null -X POST "$BASE/api/editions/$ED/workflow-transitions" -b /tmp/ms-e.jar \
  -H 'Content-Type: application/json' -d '{"target":"review"}'
R1=$(rev_of "$(draft "$ED")")
A1=$(curl -s -X POST "$BASE/api/workspaces/reviewer/editions/$ED/approve" -b /tmp/ms-r.jar \
  -H 'Content-Type: application/json' -H "x-request-id: ms-a1-$TS" -H "idempotency-key: ms-approve-$TS" \
  -d "{\"expectedRevision\":$R1}")
[ "$(st_of "$A1")" = "approved" ] && ok "approve -> approved" || bad "approve $A1"

RESV=$(Q "count(*) FROM geo_foundry.url_records WHERE edition_id=$ED AND state='reserved'")
[ "$RESV" = "2" ] && ok "URL reserved for both member sites (2 rows)" || bad "reserved urls=$RESV"
for S in "$SITE" "$SITE_C"; do
  R=$(Q "count(*) FROM geo_foundry.url_records WHERE edition_id=$ED AND site_id=$S AND state='reserved'")
  [ "$R" = "1" ] && ok "URL reserved site $S" || bad "url reserved site $S rows=$R"
done

# A3：每个成员站各回填一条 passed 评估（按站门禁只认本站的行）。
INPUT_HASH=$(input_hash_of "$ED")
AS_A=$(post_assessment "$ED" "$SITE" "ms-as-a" "$INPUT_HASH")
AS_C=$(post_assessment "$ED" "$SITE_C" "ms-as-c" "$INPUT_HASH")
assess_ok "$AS_A" && assess_ok "$AS_C" \
  && ok "quality assessments passed per member site (2 rows)" || bad "assessment A=$AS_A C=$AS_C"
NA=$(Q "count(*) FROM geo_foundry.quality_assessments WHERE edition_id=$ED AND site_id=$SITE AND state='passed'")
NC=$(Q "count(*) FROM geo_foundry.quality_assessments WHERE edition_id=$ED AND site_id=$SITE_C AND state='passed'")
[ "$NA" -ge 1 ] && [ "$NC" -ge 1 ] && ok "assessment rows landed per site" || bad "assessment rows A=$NA C=$NC"
QSA=$(Q "quality_state FROM geo_foundry.edition_sites WHERE edition_id=$ED AND site_id=$SITE")
QSC=$(Q "quality_state FROM geo_foundry.edition_sites WHERE edition_id=$ED AND site_id=$SITE_C")
[ "$QSA" = "passed" ] && [ "$QSC" = "passed" ] \
  && ok "edition_sites.quality_state written per site (passed)" || bad "quality_state A=$QSA C=$QSC"

# ---------- 2. 扇出：两条操作（一站一条） ----------
P1=$(curl -s -X POST "$BASE/api/editions/$ED/publish-operations" -b /tmp/ms-p.jar \
  -H 'Content-Type: application/json' -d '{}')
echo "publish-op(fanout): $P1"
OP375=$(echo "$P1" | python3 -c 'import json,sys;d=json.load(sys.stdin);print([o for o in d["operations"] if o["siteId"]=='"$SITE"'][0]["operationId"])')
OPC=$(echo "$P1" | python3 -c 'import json,sys;d=json.load(sys.stdin);print([o for o in d["operations"] if o["siteId"]=='"$SITE_C"'][0]["operationId"])')
REL375=$(echo "$P1" | python3 -c 'import json,sys;d=json.load(sys.stdin);print([o for o in d["operations"] if o["siteId"]=='"$SITE"'][0]["releaseId"])')
echo "$P1" | MS_A="$SITE" MS_B="$SITE_C" python3 -c '
import json,sys,os
d=json.load(sys.stdin)
want={int(os.environ["MS_A"]), int(os.environ["MS_B"])}
assert "operation" not in d and len(d["operations"])==2, d
assert all(o["created"] is True and o["state"]=="queued" for o in d["operations"]), d
assert {o["siteId"] for o in d["operations"]} == want, d
assert all(o["releaseId"].startswith("rel-") for o in d["operations"]), d' \
  && ok "fanout response: 2 operations, per-site ids" || bad "fanout $P1"

JOB375=$(Q "count(*) FROM pgboss.job WHERE singleton_key='$OP375'")
JOB_C=$(Q "count(*) FROM pgboss.job WHERE singleton_key='$OPC'")
[ "$JOB375" -ge 1 ] && [ "$JOB_C" -ge 1 ] && ok "both pgboss jobs enqueued" || bad "jobs 375=$JOB375 C=$JOB_C"

OPSITE375=$(Q "site_id FROM geo_foundry.operations WHERE operation_id='$OP375'")
OPSITE_C=$(Q "site_id FROM geo_foundry.operations WHERE operation_id='$OPC'")
[ "$OPSITE375" = "$SITE" ] && [ "$OPSITE_C" = "$SITE_C" ] \
  && ok "operation rows carry per-site site_id" || bad "op rows 375=$OPSITE375 C=$OPSITE_C"
K375=$(Q "idempotency_key_hash FROM geo_foundry.operations WHERE operation_id='$OP375'")
K_C=$(Q "idempotency_key_hash FROM geo_foundry.operations WHERE operation_id='$OPC'")
[ -n "$K375" ] && [ -n "$K_C" ] && [ "$K375" != "$K_C" ] \
  && ok "per-site idempotency keys distinct" || bad "idempotency keys 375=$K375 C=$K_C"

# ---------- 3. 等 worker：375 成功、C 失败（无 canonical 域名） ----------
S375=""; SC=""
for i in $(seq 1 40); do
  S375=$(Q "state FROM geo_foundry.operations WHERE operation_id='$OP375'")
  SC=$(Q "state FROM geo_foundry.operations WHERE operation_id='$OPC'")
  { [ "$S375" = "succeeded" ] || [ "$S375" = "failed" ]; } && { [ "$SC" = "succeeded" ] || [ "$SC" = "failed" ]; } && break
  sleep 3
done
echo "worker wait: polls=$i 375=$S375 C=$SC"
if [ "$S375" = "succeeded" ]; then ok "site 375 operation succeeded"
else ERR=$(Q "coalesce(error->>'code','') FROM geo_foundry.operations WHERE operation_id='$OP375'"); bad "site 375 state=$S375 error=$ERR"; fi
if [ "$SC" = "failed" ]; then ok "site C operation failed as expected (no canonical domain)"
else ERR=$(Q "coalesce(error->>'code','') FROM geo_foundry.operations WHERE operation_id='$OPC'"); bad "site C state=$SC error=$ERR (expected failed)"; fi

# ---------- 4. 发布后按站状态 ----------
REL_ST=$(Q "state FROM geo_foundry.releases WHERE release_id='$REL375'")
[ "$REL_ST" = "current" ] && ok "site 375 release $REL375 current" || bad "rel375 state=$REL_ST"

ROOT_ST=$(Q "workflow_status FROM geo_foundry.content_editions WHERE id=$ED")
[ "$ROOT_ST" = "published" ] && ok "article published by first successful site" || bad "root status=$ROOT_ST"

ROW375=$(Q "publish_state||'|'||coalesce(release_id,'')||'|'||coalesce(url_record_id::text,'') FROM geo_foundry.edition_sites WHERE edition_id=$ED AND site_id=$SITE")
ROW_C=$(Q "publish_state||'|'||coalesce(release_id,'')||'|'||coalesce(url_record_id::text,'') FROM geo_foundry.edition_sites WHERE edition_id=$ED AND site_id=$SITE_C")
P375=${ROW375%%|*}; REL_ROW375=$(echo "$ROW375" | cut -d'|' -f2); URLROW375=$(echo "$ROW375" | cut -d'|' -f3)
[ "$P375" = "published" ] && [ "$REL_ROW375" = "$REL375" ] && [ -n "$URLROW375" ] \
  && ok "edition_sites 375: published + release + urlRecordId backfilled" || bad "row375=$ROW375"
PC=${ROW_C%%|*}
[ "$PC" = "pending" ] && ok "edition_sites C stays pending after failed op" || bad "rowC=$ROW_C"

URL375=$(Q "state FROM geo_foundry.url_records WHERE edition_id=$ED AND site_id=$SITE")
URLC=$(Q "state FROM geo_foundry.url_records WHERE edition_id=$ED AND site_id=$SITE_C")
[ "$URL375" = "active" ] && ok "URL 375 active" || bad "url375=$URL375"
[ "$URLC" = "reserved" ] && ok "URL C still reserved" || bad "urlC=$URLC"

# S3 manifest（375）：对象完整 + 含本文档 + 字节 sha 与 releases 行一致
REL375_SHA=$(Q "manifest_sha256 FROM geo_foundry.releases WHERE release_id='$REL375'")
SLUG375=$(Q "pathname FROM geo_foundry.url_records WHERE edition_id=$ED AND site_id=$SITE")
if s3_get "$PREFIX/sites/site-$SITE/releases/$REL375/manifest.json" /tmp/ms-manifest-375.json; then
  MAN_SHA=$(sha256sum /tmp/ms-manifest-375.json | cut -d' ' -f1)
  [ "$MAN_SHA" = "$REL375_SHA" ] && ok "375 manifest bytes sha matches releases row" \
    || bad "manifest sha mismatch got=$MAN_SHA want=$REL375_SHA"
  DOC_OK=$(python3 -c '
import json,sys
d=json.load(open("/tmp/ms-manifest-375.json"))
want="pages"+sys.argv[1]+".json"
assert any(o["path"]==want for o in d["objects"]), "missing %s"%want
for o in d["objects"]:
    assert o.get("path") and o.get("sha256") and o.get("bytes") is not None and o.get("contentType"), o
print("ok")' "$SLUG375" 2>/dev/null)
  [ "$DOC_OK" = "ok" ] && ok "375 manifest: article doc present + objects well-formed ($SLUG375)" \
    || bad "manifest doc/structure check failed for $SLUG375"
else
  bad "object store manifest unavailable (check S3 reader and credentials)"
fi

# ---------- 5. 修复 C 站 canonical 域名 → 单站重试 ----------
PSQL "INSERT INTO geo_foundry.domains (hostname, site_id, tenant_id, role, status)
  VALUES ('e2e-a2-nodomain-$TS.test', $SITE_C, $TENANT, 'canonical', 'active')" >/dev/null
ok "canonical domain added for site C"

# 非成员站重试必须被拒
PR=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/editions/$ED/publish-operations" -b /tmp/ms-p.jar \
  -H 'Content-Type: application/json' -d '{"siteId":999999}')
[ "$(echo "$PR" | tail -1)" = "409" ] && echo "$PR" | sed '$d' | \
  python3 -c 'import json,sys;assert json.load(sys.stdin)["error"]["code"]=="EDITION_WORKFLOW_SITE_NOT_ASSIGNED"' \
  && ok "retry to non-member site rejected (409)" || bad "non-member $PR"

P2=$(curl -s -X POST "$BASE/api/editions/$ED/publish-operations" -b /tmp/ms-p.jar \
  -H 'Content-Type: application/json' -d "{\"siteId\":$SITE_C}")
echo "publish-op(retry C): $P2"
OP_C2=$(echo "$P2" | python3 -c 'import json,sys;print(json.load(sys.stdin)["operation"]["operationId"])')
REL_C2=$(echo "$P2" | python3 -c 'import json,sys;print(json.load(sys.stdin)["operation"]["releaseId"])')
echo "$P2" | python3 -c '
import json,sys
d=json.load(sys.stdin)
o=d["operation"]
assert "operations" not in d, d
assert o["created"] is True and o["state"]=="queued" and o["siteId"]=='"$SITE_C"', o' \
  && ok "single-site retry accepted on published article (op=$OP_C2)" || bad "retry $P2"

SC2=""
for i in $(seq 1 40); do
  SC2=$(Q "state FROM geo_foundry.operations WHERE operation_id='$OP_C2'")
  { [ "$SC2" = "succeeded" ] || [ "$SC2" = "failed" ]; } && break
  sleep 3
done
if [ "$SC2" = "succeeded" ]; then ok "site C retry operation succeeded"
else ERR=$(Q "coalesce(error->>'code','') FROM geo_foundry.operations WHERE operation_id='$OP_C2'"); bad "retry state=$SC2 error=$ERR"; fi

ROW_C2=$(Q "publish_state||'|'||coalesce(release_id,'')||'|'||coalesce(url_record_id::text,'') FROM geo_foundry.edition_sites WHERE edition_id=$ED AND site_id=$SITE_C")
PC2=${ROW_C2%%|*}; REL_ROW_C2=$(echo "$ROW_C2" | cut -d'|' -f2); URLROW_C2=$(echo "$ROW_C2" | cut -d'|' -f3)
[ "$PC2" = "published" ] && [ "$REL_ROW_C2" = "$REL_C2" ] && [ -n "$URLROW_C2" ] \
  && ok "edition_sites C: published after retry" || bad "rowC2=$ROW_C2"
URLC2=$(Q "state FROM geo_foundry.url_records WHERE edition_id=$ED AND site_id=$SITE_C")
[ "$URLC2" = "active" ] && ok "URL C active after retry" || bad "urlC2=$URLC2"
REL_C2_ST=$(Q "state FROM geo_foundry.releases WHERE release_id='$REL_C2'")
[ "$REL_C2_ST" = "current" ] && ok "site C release $REL_C2 current" || bad "relC2 state=$REL_C2_ST"
REL_C2_SHA=$(Q "manifest_sha256 FROM geo_foundry.releases WHERE release_id='$REL_C2'")
OP_C2_SHA=$(Q "coalesce(result->>'manifestSha256','') FROM geo_foundry.operations WHERE operation_id='$OP_C2'")
[ -n "$OP_C2_SHA" ] && [ "$OP_C2_SHA" = "$REL_C2_SHA" ] \
  && ok "C manifest sha consistent" || bad "sha mismatch C op=$OP_C2_SHA rel=$REL_C2_SHA"
ROOT_ST2=$(Q "workflow_status FROM geo_foundry.content_editions WHERE id=$ED")
[ "$ROOT_ST2" = "published" ] && ok "article stays published (second site did not re-transition)" || bad "root2=$ROOT_ST2"

# ---------- 5.5. 两站重发布：后续站点也必须复位旧 published 行 ----------
OLD_A_TIME=$(Q "extract(epoch from published_at) FROM geo_foundry.edition_sites WHERE edition_id=$ED AND site_id=$SITE")
OLD_C_TIME=$(Q "extract(epoch from published_at) FROM geo_foundry.edition_sites WHERE edition_id=$ED AND site_id=$SITE_C")
DM=$(curl -s -X POST "$BASE/api/editions/$ED/draft-from-published" -b /tmp/ms-e.jar \
  -H 'Content-Type: application/json' -d '{"reason":"E2E multi-site republish"}')
[ "$(st_of "$DM")" = "draft" ] && ok "two-site republish: draft created" || bad "two-site dfp $DM"
curl -s -o /dev/null -X POST "$BASE/api/editions/$ED/workflow-transitions" -b /tmp/ms-e.jar \
  -H 'Content-Type: application/json' -d '{"target":"review"}'
RM=$(rev_of "$(draft "$ED")")
AM=$(curl -s -X POST "$BASE/api/workspaces/reviewer/editions/$ED/approve" -b /tmp/ms-r.jar \
  -H 'Content-Type: application/json' -H "x-request-id: ms-am-$TS" -H "idempotency-key: ms-approve-m-$TS" \
  -d "{\"expectedRevision\":$RM}")
[ "$(st_of "$AM")" = "approved" ] && ok "two-site republish: first approval" || bad "two-site approve $AM"
# dfp 复位 revision 后仍会撞首条发布键；回弹一次使新周期的键不同。
curl -s -o /dev/null -X POST "$BASE/api/editions/$ED/workflow-transitions" -b /tmp/ms-e.jar \
  -H 'Content-Type: application/json' -d '{"target":"review"}'
RM2=$(rev_of "$(draft "$ED")")
AM2=$(curl -s -X POST "$BASE/api/workspaces/reviewer/editions/$ED/approve" -b /tmp/ms-r.jar \
  -H 'Content-Type: application/json' -H "x-request-id: ms-am2-$TS" -H "idempotency-key: ms-approve-m2-$TS" \
  -d "{\"expectedRevision\":$RM2}")
[ "$(st_of "$AM2")" = "approved" ] && ok "two-site republish: revision bumped" || bad "two-site reapprove $AM2"
# A3：重发布周期两站各需新的 passed 评估（按站门禁）。
IM=$(input_hash_of "$ED")
ASM_A=$(post_assessment "$ED" "$SITE" "ms-asm-a" "$IM")
ASM_C=$(post_assessment "$ED" "$SITE_C" "ms-asm-c" "$IM")
assess_ok "$ASM_A" && assess_ok "$ASM_C" \
  && ok "two-site republish: per-site assessments passed" || bad "two-site assessment A=$ASM_A C=$ASM_C"
PM=$(curl -s -X POST "$BASE/api/editions/$ED/publish-operations" -b /tmp/ms-p.jar \
  -H 'Content-Type: application/json' -d '{}')
echo "publish-op(two-site republish): $PM"
OP_AM=$(echo "$PM" | python3 -c 'import json,sys;d=json.load(sys.stdin);print([o for o in d["operations"] if o["siteId"]=='"$SITE"'][0]["operationId"])')
OP_CM=$(echo "$PM" | python3 -c 'import json,sys;d=json.load(sys.stdin);print([o for o in d["operations"] if o["siteId"]=='"$SITE_C"'][0]["operationId"])')
REL_AM=$(echo "$PM" | python3 -c 'import json,sys;d=json.load(sys.stdin);print([o for o in d["operations"] if o["siteId"]=='"$SITE"'][0]["releaseId"])')
REL_CM=$(echo "$PM" | python3 -c 'import json,sys;d=json.load(sys.stdin);print([o for o in d["operations"] if o["siteId"]=='"$SITE_C"'][0]["releaseId"])')
[ "$REL_AM" != "$REL375" ] && [ "$REL_CM" != "$REL_C2" ] \
  && ok "two-site republish: both releases fresh" || bad "two-site releases $REL_AM $REL_CM"
SM_A=""; SM_C=""
for i in $(seq 1 40); do
  SM_A=$(Q "state FROM geo_foundry.operations WHERE operation_id='$OP_AM'")
  SM_C=$(Q "state FROM geo_foundry.operations WHERE operation_id='$OP_CM'")
  { [ "$SM_A" = "succeeded" ] || [ "$SM_A" = "failed" ]; } && { [ "$SM_C" = "succeeded" ] || [ "$SM_C" = "failed" ]; } && break
  sleep 3
done
[ "$SM_A" = "succeeded" ] && [ "$SM_C" = "succeeded" ] \
  && ok "two-site republish: both operations succeeded" || bad "two-site states $SM_A $SM_C"
for PAIR in "$SITE:$REL_AM:$OLD_A_TIME" "$SITE_C:$REL_CM:$OLD_C_TIME"; do
  IFS=: read -r S R T <<< "$PAIR"
  ROW=$(Q "publish_state||'|'||coalesce(release_id,'')||'|'||(extract(epoch from published_at) > $T)::text FROM geo_foundry.edition_sites WHERE edition_id=$ED AND site_id=$S")
  [ "$ROW" = "published|$R|true" ] \
    && ok "two-site republish: site $S status, release and time refreshed" || bad "two-site row $S=$ROW"
done
ST_M=$(Q "workflow_status FROM geo_foundry.edition_revisions WHERE parent_id=$ED AND latest=true")
[ "$ST_M" = "published" ] && ok "two-site republish: latest article published" || bad "two-site latest=$ST_M"

# ---------- 6. 单站文章 × 基线对照 ----------
C2=$(python3 -c 'import json,sys;print(json.dumps({"title":sys.argv[1],"bodyMarkdown":sys.argv[2],"site":int(sys.argv[3])},ensure_ascii=False))' \
  "E2E A2 单站基线对照 SS $TS" "A2 单站行为必须与基线一致。" "$SITE" | \
  curl -s -X POST "$BASE/api/content-editions?draft=true&depth=0" -b /tmp/ms-e.jar \
    -H 'Content-Type: application/json' -d @-)
ED2=$(echo "$C2" | python3 -c 'import json,sys;print(json.load(sys.stdin)["doc"]["id"])')
[ -n "$ED2" ] && ok "single-site draft created (edition=$ED2)" || { bad "create2 $C2"; exit 1; }
curl -s -o /dev/null -X POST "$BASE/api/editions/$ED2/workflow-transitions" -b /tmp/ms-e.jar \
  -H 'Content-Type: application/json' -d '{"target":"review"}'
R2=$(rev_of "$(draft "$ED2")")
A2=$(curl -s -X POST "$BASE/api/workspaces/reviewer/editions/$ED2/approve" -b /tmp/ms-r.jar \
  -H 'Content-Type: application/json' -H "x-request-id: ms-a2-$TS" -H "idempotency-key: ms-approve2-$TS" \
  -d "{\"expectedRevision\":$R2}")
[ "$(st_of "$A2")" = "approved" ] && ok "single approve -> approved" || bad "approve2 $A2"
IH2=$(input_hash_of "$ED2")
AS2=$(post_assessment "$ED2" "$SITE" "ms-as2" "$IH2")
assess_ok "$AS2" && ok "single assessment passed" || bad "assessment2 $AS2"

P3=$(curl -s -X POST "$BASE/api/editions/$ED2/publish-operations" -b /tmp/ms-p.jar \
  -H 'Content-Type: application/json' -d '{}')
echo "publish-op(single): $P3"
OP3=$(echo "$P3" | python3 -c 'import json,sys;print(json.load(sys.stdin)["operation"]["operationId"])')
REL3=$(echo "$P3" | python3 -c 'import json,sys;print(json.load(sys.stdin)["operation"]["releaseId"])')
echo "$P3" | python3 -c '
import json,sys
d=json.load(sys.stdin)
assert "operations" not in d and d["operation"]["created"] is True, d
assert d["operation"]["siteId"] == '"$SITE"', d' \
  && ok "single-site response keeps legacy singular shape (+siteId)" || bad "single $P3"

S3ST=""
for i in $(seq 1 40); do
  S3ST=$(Q "state FROM geo_foundry.operations WHERE operation_id='$OP3'")
  { [ "$S3ST" = "succeeded" ] || [ "$S3ST" = "failed" ]; } && break
  sleep 3
done
if [ "$S3ST" = "succeeded" ]; then ok "single-site operation succeeded"
else ERR=$(Q "coalesce(error->>'code','') FROM geo_foundry.operations WHERE operation_id='$OP3'"); bad "single state=$S3ST error=$ERR"; fi

# 抓单站发布后的 DB 快照（row_to_json，键名与基线 fixture 一致）
BUNDLE=$(Q "json_build_object(
  'release', (SELECT row_to_json(r) FROM (SELECT * FROM geo_foundry.releases WHERE release_id='$REL3') r),
  'operation', (SELECT row_to_json(r) FROM (SELECT * FROM geo_foundry.operations WHERE operation_id='$OP3') r),
  'url', (SELECT row_to_json(r) FROM (SELECT * FROM geo_foundry.url_records WHERE edition_id=$ED2 AND site_id=$SITE LIMIT 1) r),
  'edition_site', (SELECT row_to_json(r) FROM (SELECT * FROM geo_foundry.edition_sites WHERE edition_id=$ED2 AND site_id=$SITE) r),
  'edition', (SELECT row_to_json(r) FROM (SELECT * FROM geo_foundry.content_editions WHERE id=$ED2) r),
  'revision', (SELECT row_to_json(r) FROM (SELECT * FROM geo_foundry.edition_revisions WHERE parent_id=$ED2 AND latest=true) r)
)")
[ -n "$BUNDLE" ] && ok "single-site DB bundle captured" || { bad "DB bundle capture"; exit 1; }
echo "$BUNDLE" > /tmp/ms-bundle.json

SLUG2=$(Q "pathname FROM geo_foundry.url_records WHERE edition_id=$ED2 AND site_id=$SITE")
REL3_SHA=$(Q "manifest_sha256 FROM geo_foundry.releases WHERE release_id='$REL3'")
if s3_get "$PREFIX/sites/site-$SITE/releases/$REL3/manifest.json" /tmp/ms-manifest-375-2.json; then
  MAN_SHA2=$(sha256sum /tmp/ms-manifest-375-2.json | cut -d' ' -f1)
  [ "$MAN_SHA2" = "$REL3_SHA" ] && ok "single manifest bytes sha matches releases row" \
    || bad "single manifest sha mismatch got=$MAN_SHA2 want=$REL3_SHA"
  DOC_OK2=$(python3 -c '
import json,sys
d=json.load(open("/tmp/ms-manifest-375-2.json"))
paths={o["path"] for o in d["objects"]}
want="pages"+sys.argv[1]+".json"
for req in ("pages/not-found.json","sitemap.xml","routes.json","pages/articles.json",want):
    assert req in paths, "missing %s"%req
for o in d["objects"]:
    assert o.get("path") and o.get("sha256") and o.get("bytes") is not None and o.get("contentType"), o
assert d["siteId"]=="site-%s"%sys.argv[2]
print("ok")' "$SLUG2" "$SITE" 2>/dev/null)
  [ "$DOC_OK2" = "ok" ] && ok "single manifest structural invariants hold (doc=$SLUG2)" \
    || bad "single manifest structure check failed"
else
  bad "object store manifest unavailable (check S3 reader and credentials)"
fi

BASELINE=$(ls /tmp/a2-baseline-*.json 2>/dev/null | head -1)
if [ -n "$BASELINE" ]; then
  python3 - /tmp/ms-bundle.json "$BASELINE" "$ED2" <<'PYEOF'
import json, sys
b = json.load(open(sys.argv[1]))
base = json.load(open(sys.argv[2]))
ed2 = int(sys.argv[3])
fails = []
def chk(label, got, want):
    if got != want:
        fails.append(f"{label}: got={got!r} want={want!r}")

rel, bref = b["release"], base["releases"][0]
chk("release.state", rel["state"], "current")
chk("release.tenant_id", rel["tenant_id"], bref["tenant_id"])
chk("release.site_id", rel["site_id"], bref["site_id"])
chk("release.runtime_site_id", rel["runtime_site_id"], bref["runtime_site_id"])
chk("release.revision", rel["revision"], bref["revision"])

op, bof = b["operation"], base["operations"][0]
chk("operation.operation_type", op["operation_type"], bof["operation_type"])
chk("operation.state", op["state"], "succeeded")
chk("operation.attempt", op["attempt"], bof["attempt"])
chk("operation.revision", op["revision"], bof["revision"])
chk("operation.current_stage", op["current_stage"], bof["current_stage"])
chk("operation.tenant_id", op["tenant_id"], bof["tenant_id"])
chk("operation.site_id", op["site_id"], bof["site_id"])
chk("operation.endpoint", op["endpoint"], f"/editions/{ed2}/publish")
chk("operation.target_ids", op["target_ids"], {"editionId": ed2})
chk("operation.result.releaseId", op["result"]["releaseId"], rel["release_id"])
chk("operation.result.manifestSha256", op["result"]["manifestSha256"], rel["manifest_sha256"])
# A2 预期差异：body 新增 siteId（单站同样按站落操作）
chk("operation.request_payload.body", op["request_payload"]["body"], {"editionId": ed2, "siteId": bof["site_id"]})

ur, buf = b["url"], base["urlRecords"][0]
chk("url.state", ur["state"], buf["state"])
chk("url.site_id", ur["site_id"], buf["site_id"])
chk("url.tenant_id", ur["tenant_id"], buf["tenant_id"])
chk("url.locale", ur["locale"], buf["locale"])
chk("url.status_code", ur["status_code"], buf["status_code"])
chk("url.revision", ur["revision"], buf["revision"])
chk("url.pathname prefix", ur["pathname"].startswith("/articles/"), True)

es, bef = b["edition_site"], base["editionSites"][0]
chk("edition_site.tenant_id", es["tenant_id"], bef["tenant_id"])
chk("edition_site.site_id", es["site_id"], bef["site_id"])
chk("edition_site.quality_state", es["quality_state"], bef["quality_state"])
# A2 首次回填（基线为 pending/null/null）
chk("edition_site.publish_state", es["publish_state"], "published")
chk("edition_site.release_id", es["release_id"], rel["release_id"])
chk("edition_site.url_record_id backfilled", es["url_record_id"] is not None, True)

ce, bce = b["edition"], base["contentEditions"][0]
chk("edition.workflow_status", ce["workflow_status"], bce["workflow_status"])
chk("edition.workflow_revision", ce["workflow_revision"], bce["workflow_revision"])
chk("edition.site_id", ce["site_id"], bce["site_id"])
chk("edition.sites", ce["sites"], bce["sites"])
chk("edition.compiled_release", ce["compiled_release"], rel["release_id"])

rv, brv = b["revision"], base["editionRevisions"][0]
chk("revision.latest", rv["latest"], brv["latest"])
chk("revision.workflow_status", rv["workflow_status"], brv["workflow_status"])
chk("revision.workflow_revision", rv["workflow_revision"], brv["workflow_revision"])
chk("revision.site_id", rv["site_id"], brv["site_id"])
chk("revision.sites", rv["sites"], brv["sites"])
chk("revision.compiled_release", rv["compiled_release"], rel["release_id"])

if fails:
    print("BASELINE_DIFF: " + "; ".join(fails))
    sys.exit(1)
print("BASELINE_MATCH: all compared fields equal (ids/timestamps/site drift exempt)")
PYEOF
  if [ $? -eq 0 ]; then ok "single-site bundle matches A1 baseline field-by-field"
  else bad "baseline comparison failed (see BASELINE_DIFF above)"; fi
else
  echo "SKIP: baseline file missing on /tmp (scp 后重跑)"
fi

# ---------- 6.5. 重发布周期（单站回归，两段） ----------
# 段 A：遗留幂等语义——dfp 后 revision 复位 0，重审/重批后回到 revision-2，
#   与首条发布键（revision-2，当时文章还是 approved 未编译）撞车 →
#   publish 幂等 no-op：不新建操作/发布，旧 release 继续服务。
#   这是 A2 前单站既有行为，A2 契约要求完全一致（断言 created=false）。
# 段 B：真实新编译周期——free-flow approved→review→approved 把 revision
#   推到 4（≠2）→ 新操作 → worker 铸新 release。回归守卫：新编译周期
#   不复位站点行时（2356fc2 修的 bug），发布回执命中
#   "published 且 releaseId 匹配 → 幂等返回"，文章卡 compiled 退出 delivery。
D2R=$(curl -s -X POST "$BASE/api/editions/$ED2/draft-from-published" -b /tmp/ms-e.jar \
  -H 'Content-Type: application/json' -d '{"reason":"E2E multi-site republish cycle"}')
[ "$(st_of "$D2R")" = "draft" ] && ok "republish A: draft-from-published -> draft" || bad "republish A dfp $D2R"
curl -s -o /dev/null -X POST "$BASE/api/editions/$ED2/workflow-transitions" -b /tmp/ms-e.jar \
  -H 'Content-Type: application/json' -d '{"target":"review"}'
R3=$(rev_of "$(draft "$ED2")")
A3=$(curl -s -X POST "$BASE/api/workspaces/reviewer/editions/$ED2/approve" -b /tmp/ms-r.jar \
  -H 'Content-Type: application/json' -H "x-request-id: ms-a3-$TS" -H "idempotency-key: ms-approve3-$TS" \
  -d "{\"expectedRevision\":$R3}")
[ "$(st_of "$A3")" = "approved" ] && ok "republish A: re-approve -> approved" || bad "republish A approve $A3"
# 重记 passed 评估（编译质量门禁按当前输入快照校验，dfp 后以防哈希变化）
IH3=$(input_hash_of "$ED2")
AS3=$(post_assessment "$ED2" "$SITE" "ms-as3" "$IH3")
assess_ok "$AS3" && ok "republish A: assessment passed re-recorded" || bad "republish A assessment $AS3"
# 段 A 断言：同 revision 重发布 → 幂等 no-op（无新操作，旧 release 继续服务）
P4=$(curl -s -X POST "$BASE/api/editions/$ED2/publish-operations" -b /tmp/ms-p.jar \
  -H 'Content-Type: application/json' -d '{}')
echo "publish-op(republish-A): $P4"
OP4=$(echo "$P4" | python3 -c 'import json,sys;print(json.load(sys.stdin)["operation"]["operationId"])')
REL4=$(echo "$P4" | python3 -c 'import json,sys;print(json.load(sys.stdin)["operation"]["releaseId"])')
C4=$(echo "$P4" | python3 -c 'import json,sys;print(json.load(sys.stdin)["operation"]["created"])')
[ "$C4" = "False" ] && [ "$OP4" = "$OP3" ] && [ "$REL4" = "$REL3" ] \
  && ok "republish A: same revision key -> idempotent no-op (legacy single-site semantics)" \
  || bad "republish A want no-op got $P4"
ROW2A=$(Q "publish_state||'|'||coalesce(release_id,'') FROM geo_foundry.edition_sites WHERE edition_id=$ED2 AND site_id=$SITE")
[ "$ROW2A" = "published|$REL3" ] && ok "republish A: site row untouched (serving $REL3)" || bad "republish A row=$ROW2A"
ST2A=$(Q "workflow_status FROM geo_foundry.edition_revisions WHERE parent_id=$ED2 AND latest=true")
[ "$ST2A" = "approved" ] && ok "republish A: article stays approved (no new cycle started)" || bad "republish A latest=$ST2A"
DL4=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/delivery/articles/$ED2")
[ "$DL4" = "200" ] && ok "republish A: delivery still 200 on old release" || bad "republish A delivery code=$DL4"

# 段 B：free-flow 回弹（approved→review→approved）把 revision 推到 4 → 真实新编译周期
curl -s -o /dev/null -X POST "$BASE/api/editions/$ED2/workflow-transitions" -b /tmp/ms-e.jar \
  -H 'Content-Type: application/json' -d '{"target":"review"}'
R4=$(rev_of "$(draft "$ED2")")
A4=$(curl -s -X POST "$BASE/api/workspaces/reviewer/editions/$ED2/approve" -b /tmp/ms-r.jar \
  -H 'Content-Type: application/json' -H "x-request-id: ms-a4-$TS" -H "idempotency-key: ms-approve4-$TS" \
  -d "{\"expectedRevision\":$R4}")
[ "$(st_of "$A4")" = "approved" ] && ok "republish B: bounce re-approve -> approved (revision bumped)" || bad "republish B approve $A4"
IH4=$(input_hash_of "$ED2")
AS4=$(post_assessment "$ED2" "$SITE" "ms-as4" "$IH4")
assess_ok "$AS4" && ok "republish B: assessment passed re-recorded" || bad "republish B assessment $AS4"
P5=$(curl -s -X POST "$BASE/api/editions/$ED2/publish-operations" -b /tmp/ms-p.jar \
  -H 'Content-Type: application/json' -d '{}')
echo "publish-op(republish-B): $P5"
OP5=$(echo "$P5" | python3 -c 'import json,sys;print(json.load(sys.stdin)["operation"]["operationId"])')
REL5=$(echo "$P5" | python3 -c 'import json,sys;print(json.load(sys.stdin)["operation"]["releaseId"])')
[ -n "$OP5" ] && [ "$OP5" != "$OP3" ] && [ "$REL5" != "$REL3" ] \
  && ok "republish B: fresh operation + fresh release ($REL5)" \
  || bad "republish B op=$OP5 rel=$REL5 (want fresh vs op=$OP3 rel=$REL3)"
S5=""
for i in $(seq 1 40); do
  S5=$(Q "state FROM geo_foundry.operations WHERE operation_id='$OP5'")
  { [ "$S5" = "succeeded" ] || [ "$S5" = "failed" ]; } && break
  sleep 3
done
if [ "$S5" = "succeeded" ]; then ok "republish B operation succeeded"
else ERR=$(Q "coalesce(error->>'code','') FROM geo_foundry.operations WHERE operation_id='$OP5'"); bad "republish B state=$S5 error=$ERR"; fi
ST2B=$(Q "workflow_status FROM geo_foundry.edition_revisions WHERE parent_id=$ED2 AND latest=true")
[ "$ST2B" = "published" ] && ok "republish B: article back to published (not stuck compiled)" || bad "republish B latest=$ST2B"
ROW2_FINAL=$(Q "publish_state||'|'||coalesce(release_id,'') FROM geo_foundry.edition_sites WHERE edition_id=$ED2 AND site_id=$SITE")
[ "$ROW2_FINAL" = "published|$REL5" ] && ok "republish B: site row republished with fresh release" || bad "republish B row=$ROW2_FINAL"
URL2_FINAL=$(Q "state FROM geo_foundry.url_records WHERE edition_id=$ED2 AND site_id=$SITE")
[ "$URL2_FINAL" = "active" ] && ok "republish B: URL still active" || bad "republish B url=$URL2_FINAL"
# delivery 直读接口必须仍可见（文章级 published + 站点行 published 双条件）
DL5=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/delivery/articles/$ED2")
[ "$DL5" = "200" ] && ok "republish B: delivery detail 200 on fresh release" || bad "republish B delivery code=$DL5"

# ---------- 7. 还原现场 ----------
D1=$(curl -s -X POST "$BASE/api/editions/$ED/draft-from-published" -b /tmp/ms-e.jar \
  -H 'Content-Type: application/json' -d '{"reason":"E2E multi-site cleanup"}')
[ "$(st_of "$D1")" = "draft" ] && ok "cleanup 1 draft-from-published" || bad "dfp1 $D1"
S1=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/editions/$ED/workflow-transitions" -b /tmp/ms-e.jar \
  -H 'Content-Type: application/json' -d '{"target":"archived","reason":"E2E multi-site cleanup"}')
[ "$(echo "$S1" | tail -1)" = "200" ] && ok "cleanup 1 -> archived" || bad "archive1 $(echo "$S1"|tail -2)"

D2=$(curl -s -X POST "$BASE/api/editions/$ED2/draft-from-published" -b /tmp/ms-e.jar \
  -H 'Content-Type: application/json' -d '{"reason":"E2E multi-site cleanup"}')
[ "$(st_of "$D2")" = "draft" ] && ok "cleanup 2 draft-from-published" || bad "dfp2 $D2"
S2=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/editions/$ED2/workflow-transitions" -b /tmp/ms-e.jar \
  -H 'Content-Type: application/json' -d '{"target":"archived","reason":"E2E multi-site cleanup"}')
[ "$(echo "$S2" | tail -1)" = "200" ] && ok "cleanup 2 -> archived" || bad "archive2 $(echo "$S2"|tail -2)"

cleanup_site_c
FINAL_C=$(Q "count(*) FROM geo_foundry.sites WHERE id=$SITE_C")
[ "$FINAL_C" = "0" ] && ok "fixture site C removed" || bad "site C cleanup count=$FINAL_C"

rm -f /tmp/ms-e.jar /tmp/ms-r.jar /tmp/ms-p.jar /tmp/ms-manifest-375.json /tmp/ms-manifest-375-2.json /tmp/ms-bundle.json
echo
echo "==== RESULT: ${#PASS[@]} passed, ${#FAIL[@]} failed ===="
[ ${#FAIL[@]} -gt 0 ] && printf 'FAILED: %s\n' "${FAIL[@]}" && exit 1
exit 0
