#!/usr/bin/env bash
# A2 基线录制（一次性，不入库）：在当前镜像（A1 状态）上做一次单站真实发布，
# 记录 manifest + 关键 DB 行作为 A2 改造后的逐项对照基线。
# 流程复用 e2e-real-publish（纯文本，无媒体、无 super-admin 周期），
# 发布成功后抓取数据到 /tmp/a2-baseline-<ts>.json，再归档夹具还原现场。
set -uo pipefail
BASE=http://127.0.0.1:3090
SITE=375
TS=$(date +%s)
EDPW="${GF_E2E_EDITOR_PASSWORD:?}"
RTPW="${GF_E2E_ROOT_PASSWORD:?}"
PBPW="${GF_E2E_PUBLISHER_PASSWORD:?}"

PSQL() { sudo docker exec pg-server psql -U gpucloud -d geo_foundry -qAt -c "$1"; }
Q() { PSQL "SELECT $1"; }

login() {
  curl -s -X POST $BASE/api/users/login -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" -c "$3" -o /dev/null
}
login gf-editor-test@geo-foundry.dev "$EDPW" /tmp/ba-e.jar
login gf-root-test@geo-foundry.dev "$RTPW" /tmp/ba-r.jar
login e2e-scheduled-publisher@geo-foundry.test "$PBPW" /tmp/ba-p.jar
SKEY=$(sudo python3 -c 'import json;print(json.load(open("/opt/geo-foundry/credentials/content-service-keyring.json"))["tenants"]["413"])')
auth() { echo "Authorization: users API-Key $SKEY"; }

st_of() { echo "$1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["workflowStatus"])'; }
rev_of() { echo "$1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["workflowRevision"])'; }
draft() { curl -s -b /tmp/ba-e.jar "$BASE/api/content-editions/$1?draft=true&depth=0"; }

# ---------- 0. 前提 ----------
DOMAIN=$(Q "hostname FROM geo_foundry.domains WHERE site_id=$SITE AND role='canonical' AND status='active' LIMIT 1")
[ -n "$DOMAIN" ] && echo "domain=$DOMAIN" || { echo "NO_CANONICAL"; exit 1; }

# ---------- 0.5 预清理无评估的旧夹具（同 real-publish） ----------
STALE=$(Q "ce.id FROM geo_foundry.content_editions ce
  JOIN geo_foundry.edition_revisions ev ON ev.parent_id = ce.id AND ev.latest
  WHERE ev.site_id = $SITE AND ev.workflow_status IN ('approved','compiled','published')
    AND NOT EXISTS (SELECT 1 FROM geo_foundry.quality_assessments qa
      WHERE qa.edition_id = ce.id AND qa.state = 'passed')
  ORDER BY ce.id")
for ID in $STALE; do
  CODE=$(curl -s -o /tmp/ba-stale.json -w '%{http_code}' \
    -X POST "$BASE/api/editions/$ID/workflow-transitions" -b /tmp/ba-r.jar \
    -H 'Content-Type: application/json' \
    -d '{"target":"archived","reason":"A2 基线：清理无评估旧夹具"}')
  [ "$CODE" = "200" ] && echo "stale $ID archived" || { echo "stale $ID code=$CODE $(cat /tmp/ba-stale.json)"; exit 1; }
done

# ---------- 1. 纯文本文章到 approved + passed 评估 ----------
C=$(python3 -c 'import json,sys;print(json.dumps({"title":sys.argv[1],"bodyMarkdown":sys.argv[2],"site":int(sys.argv[3])},ensure_ascii=False))' \
  "A2 基线 $TS" "A2 基线正文：单站发布对照用，发布成功后归档。" "$SITE" | \
  curl -s -X POST "$BASE/api/content-editions?draft=true&depth=0" -b /tmp/ba-e.jar \
    -H 'Content-Type: application/json' -d @-)
ED=$(echo "$C" | python3 -c 'import json,sys;print(json.load(sys.stdin)["doc"]["id"])')
[ -n "$ED" ] && echo "edition=$ED" || { echo "create failed: $C"; exit 1; }
curl -s -o /dev/null -X POST "$BASE/api/editions/$ED/workflow-transitions" -b /tmp/ba-e.jar \
  -H 'Content-Type: application/json' -d '{"target":"review"}'
R1=$(rev_of "$(draft "$ED")")
A1=$(curl -s -X POST "$BASE/api/workspaces/reviewer/editions/$ED/approve" -b /tmp/ba-r.jar \
  -H 'Content-Type: application/json' -H "x-request-id: ba-a1-$TS" -H "idempotency-key: ba-approve-$TS" \
  -d "{\"expectedRevision\":$R1}")
[ "$(st_of "$A1")" = "approved" ] && echo "approved" || { echo "approve failed: $A1"; exit 1; }
INPUT_HASH=$(curl -s -H "$(auth)" "$BASE/api/internal/editions/$ED/input" | python3 -c 'import json,sys;print(json.load(sys.stdin)["inputHash"])')
THRESH_HASH=$(python3 -c "import hashlib;print(hashlib.sha256(b'e2e-real-publish-defaults').hexdigest())")
AS=$(curl -s -X POST "$BASE/api/internal/editions/$ED/assessments" -H "$(auth)" \
  -H 'Content-Type: application/json' -H "x-request-id: ba-as-$TS" \
  -d "{\"inputHash\":\"$INPUT_HASH\",\"issues\":[],\"modelId\":\"a2-baseline\",\"overall\":90,\"dimensions\":{\"content\":90,\"seo\":90,\"structure\":90},\"promptVersion\":\"e2e-1\",\"provider\":\"e2e\",\"state\":\"passed\",\"thresholdsHash\":\"$THRESH_HASH\"}")
echo "$AS" | python3 -c 'import json,sys;assert json.load(sys.stdin)["assessmentId"]>0' \
  && echo "assessment passed" || { echo "assessment failed: $AS"; exit 1; }

# ---------- 2. publisher 提交发布，等真实 worker ----------
P1=$(curl -s -X POST "$BASE/api/editions/$ED/publish-operations" -b /tmp/ba-p.jar \
  -H 'Content-Type: application/json' -d '{}')
OP=$(echo "$P1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["operation"]["operationId"])')
REL=$(echo "$P1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["operation"]["releaseId"])')
echo "op=$OP rel=$REL"
STATE=""
for i in $(seq 1 40); do
  STATE=$(Q "state FROM geo_foundry.operations WHERE operation_id='$OP'")
  { [ "$STATE" = "succeeded" ] || [ "$STATE" = "failed" ]; } && break
  sleep 3
done
[ "$STATE" = "succeeded" ] && echo "worker succeeded" || {
  echo "worker failed: $(Q "coalesce(error->>'code','') FROM geo_foundry.operations WHERE operation_id='$OP'")"; exit 1; }

# ---------- 3. 抓取基线（DB 行 + manifest） ----------
PREFIX=$(grep '^GEO_FOUNDRY_S3_KEY_PREFIX=' /opt/geo-foundry/mk-dev.env 2>/dev/null | cut -d= -f2)
BUCKET=$(grep '^GEO_FOUNDRY_S3_BUCKET=' /opt/geo-foundry/mk-dev.env 2>/dev/null | cut -d= -f2)
[ -n "$BUCKET" ] || BUCKET=geo-foundry
[ -n "$PREFIX" ] || PREFIX=objects
S3CRED_DIR=$(sudo grep '^GEO_FOUNDRY_CREDENTIALS_DIR=' /opt/geo-foundry/mk-dev.env 2>/dev/null | cut -d= -f2)
MANIFEST=/tmp/ba-manifest.json
sudo python3 /tmp/rp-s3get.py "$S3CRED_DIR/s3-access-key" "$S3CRED_DIR/s3-secret-key" \
  "$BUCKET" "$PREFIX/sites/site-$SITE/releases/$REL/manifest.json" > "$MANIFEST" 2>/dev/null \
  && echo "manifest fetched" || { echo "manifest fetch failed"; exit 1; }

OUT="/tmp/a2-baseline-$TS.json"
ED="$ED" REL="$REL" OP="$OP" SITE="$SITE" TS="$TS" MANIFEST="$MANIFEST" OUT="$OUT" \
IMAGE_TAG="$(grep '^IMAGE_TAG=' /opt/geo-foundry/mk-dev.env | cut -d= -f2)" \
python3 - <<'PY'
import json, os, subprocess

def rows(sql):
    r = subprocess.run(
        ["sudo", "docker", "exec", "pg-server", "psql", "-U", "gpucloud",
         "-d", "geo_foundry", "-tA", "-c",
         "SELECT json_agg(row_to_json(t)) FROM (" + sql + ") t"],
        capture_output=True, text=True, check=True)
    return json.loads(r.stdout.strip() or "[]")

ed, rel, op = os.environ["ED"], os.environ["REL"], os.environ["OP"]
site = os.environ["SITE"]
with open(os.environ["MANIFEST"], encoding="utf-8") as f:
    manifest = json.load(f)

bundle = {
    "recordedAt": os.environ["TS"],
    "imageTag": os.environ["IMAGE_TAG"],
    "siteId": int(site),
    "editionId": int(ed),
    "releaseId": rel,
    "operationId": op,
    "releases": rows("SELECT * FROM geo_foundry.releases WHERE release_id = '" + rel + "'"),
    "operations": rows("SELECT * FROM geo_foundry.operations WHERE operation_id = '" + op + "'"),
    "urlRecords": rows("SELECT * FROM geo_foundry.url_records WHERE edition_id = " + ed),
    "editionSites": rows("SELECT * FROM geo_foundry.edition_sites WHERE edition_id = " + ed),
    "contentEditions": rows("SELECT id,tenant_id,site_id,sites,workflow_status,workflow_revision,compiled_release,updated_at FROM geo_foundry.content_editions WHERE id = " + ed),
    "editionRevisions": rows("SELECT id,parent_id,latest,site_id,sites,workflow_status,workflow_revision,compiled_release,title,updated_at FROM geo_foundry.edition_revisions WHERE parent_id = " + ed + " AND latest=true"),
    "qualityAssessments": rows("SELECT * FROM geo_foundry.quality_assessments WHERE edition_id = " + ed),
    "manifest": manifest,
}
with open(os.environ["OUT"], "w", encoding="utf-8") as f:
    json.dump(bundle, f, ensure_ascii=False, indent=2)
print("baseline written:", os.environ["OUT"])
PY

# ---------- 4. 还原现场 ----------
D=$(curl -s -X POST "$BASE/api/editions/$ED/draft-from-published" -b /tmp/ba-e.jar \
  -H 'Content-Type: application/json' -d '{"reason":"A2 baseline cleanup"}')
[ "$(st_of "$D")" = "draft" ] && echo "dfp -> draft" || { echo "dfp failed: $D"; exit 1; }
S=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/editions/$ED/workflow-transitions" -b /tmp/ba-e.jar \
  -H 'Content-Type: application/json' -d '{"target":"archived","reason":"A2 baseline cleanup"}')
[ "$(echo "$S" | tail -1)" = "200" ] && echo "archived" || { echo "archive failed"; exit 1; }
rm -f /tmp/ba-e.jar /tmp/ba-r.jar /tmp/ba-p.jar /tmp/ba-stale.json /tmp/ba-manifest.json
echo "BASELINE_DONE $OUT"
