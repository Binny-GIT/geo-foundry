#!/usr/bin/env bash
# 真实发布全链路 E2E（批次 0a）：一次性文章 draft→review→approved
# → POST publish-operations → mk-dev 真实 worker（不经任何模拟）消费 pgboss 任务
# → release 落对象存储、releases 行 current、文章 published、URL active、
#   台账 manifest 哈希与 releases 行一致。
# 收尾用 draft-from-published → archived 还原现场（文章退出 delivery 列表）。
# 在 mk-dev 宿主机运行；需要 GF_E2E_EDITOR_PASSWORD / GF_E2E_ROOT_PASSWORD。
# 前提：SITE 站点必须有 active canonical 域名（编译快照硬依赖）。
set -uo pipefail
BASE=http://127.0.0.1:3090
SITE=375
TS=$(date +%s)
PASS=(); FAIL=()
ok() { PASS+=("$1"); echo "PASS: $1"; }
bad() { FAIL+=("$1"); echo "FAIL: $1"; }
EDPW="${GF_E2E_EDITOR_PASSWORD:?}"
RTPW="${GF_E2E_ROOT_PASSWORD:?}"

PSQL() { sudo docker exec pg-server psql -U gpucloud -d geo_foundry -qAt -c "$1"; }
Q() { PSQL "SELECT $1"; }

login() { # email pass jar
  curl -s -X POST $BASE/api/users/login -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" -c "$3" -o /dev/null
}
login gf-editor-test@geo-foundry.dev "$EDPW" /tmp/rp-e.jar
login gf-root-test@geo-foundry.dev "$RTPW" /tmp/rp-r.jar
echo "logins ok"

draft() { curl -s -b /tmp/rp-e.jar "$BASE/api/content-editions/$1?draft=true&depth=0"; }
st_of() { echo "$1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["workflowStatus"])'; }
rev_of() { echo "$1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["workflowRevision"])'; }

# ---------- 0. 前提：站点有 active canonical 域名 ----------
DOMAIN=$(Q "hostname FROM geo_foundry.domains WHERE site_id=$SITE AND role='canonical' AND status='active' LIMIT 1")
[ -n "$DOMAIN" ] && ok "site $SITE canonical domain=$DOMAIN" || { bad "site $SITE 无 canonical 域名，无法编译"; exit 1; }

# ---------- 1. 一次性文章到 approved ----------
C1=$(curl -s -X POST "$BASE/api/content-editions?draft=true&depth=0" -b /tmp/rp-e.jar \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"E2E 真实发布 $TS\",\"bodyMarkdown\":\"# 摘要\\n\\n真实 worker 发布全链路验证正文。\",\"site\":$SITE}")
ED=$(echo "$C1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["doc"]["id"])')
[ -n "$ED" ] && ok "draft created (edition=$ED)" || { bad "create $C1"; exit 1; }
curl -s -o /dev/null -X POST "$BASE/api/editions/$ED/workflow-transitions" -b /tmp/rp-e.jar \
  -H 'Content-Type: application/json' -d '{"target":"review"}'
R1=$(rev_of "$(draft "$ED")")
A1=$(curl -s -X POST "$BASE/api/workspaces/reviewer/editions/$ED/approve" -b /tmp/rp-r.jar \
  -H 'Content-Type: application/json' -H "x-request-id: rp-a1-$TS" -H "idempotency-key: rp-approve-$TS" \
  -d "{\"expectedRevision\":$R1}")
[ "$(st_of "$A1")" = "approved" ] && ok "reviewer approve -> approved" || bad "approve $A1"

# ---------- 2. 提交 publish operation（真实路径起点，worker 不经模拟） ----------
P1=$(curl -s -X POST "$BASE/api/editions/$ED/publish-operations" -b /tmp/rp-r.jar \
  -H 'Content-Type: application/json' -d '{}')
echo "publish-op: $P1"
OP=$(echo "$P1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["operation"]["operationId"])')
REL=$(echo "$P1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["operation"]["releaseId"])')
echo "$P1" | python3 -c '
import json,sys
o=json.load(sys.stdin)["operation"]
assert o["created"] is True and o["state"]=="queued" and o["releaseId"].startswith("rel-"), o' \
  && ok "publish-op created (op=$OP rel=$REL)" || bad "publish-op $P1"

JOB=$(Q "count(*) FROM pgboss.job WHERE singleton_key='$OP'")
[ "$JOB" -ge 1 ] && ok "pgboss job enqueued (singleton=$OP)" || bad "pgboss job=$JOB"

# ---------- 3. 等真实 worker 消费（最长 120s） ----------
STATE=""
for i in $(seq 1 40); do
  STATE=$(Q "state FROM geo_foundry.operations WHERE operation_id='$OP'")
  { [ "$STATE" = "succeeded" ] || [ "$STATE" = "failed" ]; } && break
  sleep 3
done
echo "worker wait: polls=$i state=$STATE"
if [ "$STATE" = "succeeded" ]; then
  ok "real worker consumed job, operation succeeded"
else
  ERR=$(Q "coalesce(error->>'code','') FROM geo_foundry.operations WHERE operation_id='$OP'")
  bad "operation state=$STATE error=$ERR"
fi

# ---------- 4. 发布后 DB 状态 ----------
REL_STATE=$(Q "state FROM geo_foundry.releases WHERE release_id='$REL'")
[ "$REL_STATE" = "current" ] && ok "release $REL current" || bad "release state=$REL_STATE"

REL_SITE=$(Q "site_id FROM geo_foundry.releases WHERE release_id='$REL'")
[ "$REL_SITE" = "$SITE" ] && ok "release belongs to site $SITE" || bad "release site=$REL_SITE"

OP_SHA=$(Q "coalesce(result->>'manifestSha256','') FROM geo_foundry.operations WHERE operation_id='$OP'")
REL_SHA=$(Q "manifest_sha256 FROM geo_foundry.releases WHERE release_id='$REL'")
[ -n "$OP_SHA" ] && [ "$OP_SHA" = "$REL_SHA" ] && ok "manifest sha consistent ($OP_SHA)" \
  || bad "sha mismatch op=$OP_SHA rel=$REL_SHA"

URL=$(Q "state||'|'||coalesce(canonical_url,'') FROM geo_foundry.url_records WHERE edition_id=$ED AND site_id=$SITE")
URLST=${URL%%|*}
[ "$URLST" = "active" ] && ok "URL active ($URL)" || bad "url $URL"

ROOT_ST=$(Q "workflow_status FROM geo_foundry.content_editions WHERE id=$ED")
[ "$ROOT_ST" = "published" ] && ok "root workflow_status=published" || bad "root status=$ROOT_ST"

VER_REL=$(Q "compiled_release FROM geo_foundry.edition_versions WHERE parent_id=$ED AND latest=true")
[ "$VER_REL" = "$REL" ] && ok "latest version compiled_release=$REL" || bad "version rel=$VER_REL"

# 对象存储 manifest 存在性（best effort：宿主有 aws CLI 才查；
# 成功发布本身已隐含对象上传——publishRelease 的 CAS 指针在对象存储上校验）
if command -v aws >/dev/null 2>&1; then
  PREFIX=$(grep '^GEO_FOUNDRY_S3_KEY_PREFIX=' /opt/geo-foundry/mk-dev.env 2>/dev/null | cut -d= -f2)
  BUCKET=$(grep '^GEO_FOUNDRY_S3_BUCKET=' /opt/geo-foundry/mk-dev.env 2>/dev/null | cut -d= -f2)
  [ -n "$BUCKET" ] || BUCKET=geo-foundry
  [ -n "$PREFIX" ] || PREFIX=objects
  if aws s3api head-object --endpoint-url http://127.0.0.1:9000 \
      --bucket "$BUCKET" --key "$PREFIX/sites/site-$SITE/releases/$REL/manifest.json" >/dev/null 2>&1; then
    ok "object store manifest exists"
  else
    bad "object store manifest missing (bucket=$BUCKET prefix=$PREFIX)"
  fi
else
  echo "SKIP: object store manifest check (no aws CLI on host)"
fi

# ---------- 5. 还原现场 ----------
D1=$(curl -s -X POST "$BASE/api/editions/$ED/draft-from-published" -b /tmp/rp-e.jar \
  -H 'Content-Type: application/json' -d '{"reason":"E2E real publish cleanup"}')
[ "$(st_of "$D1")" = "draft" ] && ok "cleanup draft-from-published -> draft" || bad "dfp $D1"
S=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/editions/$ED/workflow-transitions" -b /tmp/rp-e.jar \
  -H 'Content-Type: application/json' -d '{"target":"archived","reason":"E2E real publish cleanup"}')
[ "$(echo "$S" | tail -1)" = "200" ] && ok "cleanup -> archived" || bad "archive $(echo "$S"|tail -2)"

FINAL_ST=$(Q "workflow_status FROM geo_foundry.content_editions WHERE id=$ED")
[ "$FINAL_ST" = "archived" ] && ok "fixture archived ($FINAL_ST)" || bad "final status=$FINAL_ST"

echo
echo "==== RESULT: ${#PASS[@]} passed, ${#FAIL[@]} failed ===="
[ ${#FAIL[@]} -gt 0 ] && printf 'FAILED: %s\n' "${FAIL[@]}" && exit 1
rm -f /tmp/rp-e.jar /tmp/rp-r.jar
exit 0
