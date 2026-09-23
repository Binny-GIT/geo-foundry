#!/usr/bin/env bash
# 真实发布全链路 E2E（批次 0a + 0b）：一次性带图文章 draft→review→approved
# → POST publish-operations → mk-dev 真实 worker（不经任何模拟）消费 pgboss 任务
# → release 落对象存储、releases 行 current、文章 published、URL active、
#   台账 manifest 哈希与 releases 行一致；
# → 0b：图片上传 /api/media，正文引用 /api/media/file/<f>，
#   release manifest 必须含 media/<f> 对象且哈希与上传字节一致。
# → 追加：super-admin 提交的第二个发布周期（回执段角色不区分回归：
#   publisher / super-admin 都放行，2026-09-23 定调），
# 收尾用 draft-from-published → archived 还原现场（文章退出 delivery 列表），
# 并清理媒体行与媒体对象。
# 在 mk-dev 宿主机运行；需要 GF_E2E_EDITOR_PASSWORD / GF_E2E_ROOT_PASSWORD /
# GF_E2E_PUBLISHER_PASSWORD。
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
PBPW="${GF_E2E_PUBLISHER_PASSWORD:?}"

PSQL() { sudo docker exec pg-server psql -U gpucloud -d geo_foundry -qAt -c "$1"; }
Q() { PSQL "SELECT $1"; }

login() { # email pass jar
  curl -s -X POST $BASE/api/users/login -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" -c "$3" -o /dev/null
}
login gf-editor-test@geo-foundry.dev "$EDPW" /tmp/rp-e.jar
login gf-root-test@geo-foundry.dev "$RTPW" /tmp/rp-r.jar
login e2e-scheduled-publisher@geo-foundry.test "$PBPW" /tmp/rp-p.jar
echo "logins ok"
SKEY=$(sudo python3 -c 'import json;print(json.load(open("/opt/geo-foundry/credentials/content-service-keyring.json"))["tenants"]["413"])')
auth() { echo "Authorization: users API-Key $SKEY"; }

draft() { curl -s -b /tmp/rp-e.jar "$BASE/api/content-editions/$1?draft=true&depth=0"; }
st_of() { echo "$1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["workflowStatus"])'; }
rev_of() { echo "$1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["workflowRevision"])'; }

# ---------- 0. 前提：站点有 active canonical 域名 ----------
DOMAIN=$(Q "hostname FROM geo_foundry.domains WHERE site_id=$SITE AND role='canonical' AND status='active' LIMIT 1")
[ -n "$DOMAIN" ] && ok "site $SITE canonical domain=$DOMAIN" || { bad "site $SITE 无 canonical 域名，无法编译"; exit 1; }

# ---------- 0.5. 幂等预清理：归档无真实评估的旧 E2E 夹具 ----------
# 定时发布等套件的模拟 worker 会遗留 approved/published 且无评估记录的夹具；
# 真实编译器对快照内每篇文章断言 assessmentState=passed（reserved URL 的
# approved 文章也进快照），必须清干净才能编译。
STALE=$(Q "ce.id FROM geo_foundry.content_editions ce
  JOIN geo_foundry.edition_revisions ev ON ev.parent_id = ce.id AND ev.latest
  WHERE ev.site_id = $SITE AND ev.workflow_status IN ('approved','compiled','published')
    AND NOT EXISTS (SELECT 1 FROM geo_foundry.quality_assessments qa
      WHERE qa.edition_id = ce.id AND qa.state = 'passed')
  ORDER BY ce.id")
for ID in $STALE; do
  CODE=$(curl -s -o /tmp/rp-stale.json -w '%{http_code}' \
    -X POST "$BASE/api/editions/$ID/workflow-transitions" -b /tmp/rp-r.jar \
    -H 'Content-Type: application/json' \
    -d '{"target":"archived","reason":"E2E 真实发布：清理无评估旧夹具"}')
  [ "$CODE" = "200" ] && ok "stale fixture $ID archived" || bad "stale fixture $ID code=$CODE $(cat /tmp/rp-stale.json)"
done

# ---------- 1. 上传一张一次性图片（0b 带图链路） ----------
# 生成 1x1 PNG，经 /api/media 上传，正文用返回的 /api/media/file/<f> 引用。
python3 -c 'import base64,sys;sys.stdout.buffer.write(base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="))' > /tmp/rp-img.png
IMG_SHA=$(sha256sum /tmp/rp-img.png | cut -d' ' -f1)
IMG_RESP=$(curl -s -X POST "$BASE/api/media" -b /tmp/rp-e.jar \
  -F "file=@/tmp/rp-img.png;type=image/png" -F "alt=E2E 真实发布测试图片")
IMG_URL=$(echo "$IMG_RESP" | python3 -c 'import json,sys;print(json.load(sys.stdin)["doc"]["url"])')
IMG_FILE=$(basename "$IMG_URL")
[ -n "$IMG_URL" ] && [ "$IMG_URL" = "/api/media/file/$IMG_FILE" ] \
  && ok "media uploaded (file=$IMG_FILE)" || { bad "media upload $IMG_RESP"; exit 1; }

# ---------- 2. 一次性带图文章到 approved ----------
BODY_MD=$(printf '# 摘要\n\n真实 worker 发布全链路验证正文。\n\n![E2E 真实发布测试图片](%s)' "$IMG_URL")
C1=$(python3 -c 'import json,sys;print(json.dumps({"title":sys.argv[1],"bodyMarkdown":sys.argv[2],"site":int(sys.argv[3])},ensure_ascii=False))' \
  "E2E 真实发布 $TS" "$BODY_MD" "$SITE" | \
  curl -s -X POST "$BASE/api/content-editions?draft=true&depth=0" -b /tmp/rp-e.jar \
    -H 'Content-Type: application/json' -d @-)
ED=$(echo "$C1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["doc"]["id"])')
[ -n "$ED" ] && ok "draft created (edition=$ED)" || { bad "create $C1"; exit 1; }
curl -s -o /dev/null -X POST "$BASE/api/editions/$ED/workflow-transitions" -b /tmp/rp-e.jar \
  -H 'Content-Type: application/json' -d '{"target":"review"}'
R1=$(rev_of "$(draft "$ED")")
A1=$(curl -s -X POST "$BASE/api/workspaces/reviewer/editions/$ED/approve" -b /tmp/rp-r.jar \
  -H 'Content-Type: application/json' -H "x-request-id: rp-a1-$TS" -H "idempotency-key: rp-approve-$TS" \
  -d "{\"expectedRevision\":$R1}")
[ "$(st_of "$A1")" = "approved" ] && ok "reviewer approve -> approved" || bad "approve $A1"

# 真实编译有质量门禁：assessmentState 必须 passed。经 worker 评估完成后使用的
# 同一内部端点记录一条 passed 评估（inputHash 取当前输入快照）。
INPUT_HASH=$(curl -s -H "$(auth)" "$BASE/api/internal/editions/$ED/input" | python3 -c 'import json,sys;print(json.load(sys.stdin)["inputHash"])')
THRESH_HASH=$(python3 -c "import hashlib;print(hashlib.sha256(b'e2e-real-publish-defaults').hexdigest())")
AS=$(curl -s -X POST "$BASE/api/internal/editions/$ED/assessments" -H "$(auth)" \
  -H 'Content-Type: application/json' -H "x-request-id: rp-as-$TS" \
  -d "{\"inputHash\":\"$INPUT_HASH\",\"issues\":[],\"modelId\":\"e2e-real-publish\",\"overall\":90,\"dimensions\":{\"content\":90,\"seo\":90,\"structure\":90},\"promptVersion\":\"e2e-1\",\"provider\":\"e2e\",\"state\":\"passed\",\"thresholdsHash\":\"$THRESH_HASH\"}")
[ "$(echo "$AS" | python3 -c 'import json,sys;print(json.load(sys.stdin)["assessmentId"]>0)')" = "True" ] \
  && ok "quality assessment passed recorded" || bad "assessment $AS"

# ---------- 3. 提交 publish operation（真实路径起点，worker 不经模拟） ----------
# 创建者用 publisher；回执段 advanceEditionToPublished 按 operation 审计恢复
# 创建者身份，断言 publisher / super-admin（不区分，见 5.5 周期）。
P1=$(curl -s -X POST "$BASE/api/editions/$ED/publish-operations" -b /tmp/rp-p.jar \
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

# ---------- 4. 等真实 worker 消费（最长 120s） ----------
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

# ---------- 5. 发布后 DB 状态 ----------
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

VER_REL=$(Q "compiled_release FROM geo_foundry.edition_revisions WHERE parent_id=$ED AND latest=true")
[ "$VER_REL" = "$REL" ] && ok "latest version compiled_release=$REL" || bad "version rel=$VER_REL"

# 对象存储 manifest 与媒体对象（best effort：aws CLI 或 SigV4 python 任一通道；
# 成功发布本身已隐含对象上传——publishRelease 对每个对象做 S3 端字节/类型校验）
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
s3_del() { # key
  if command -v aws >/dev/null 2>&1; then
    aws s3api delete-object --endpoint-url http://127.0.0.1:9000 \
      --bucket "$BUCKET" --key "$1" >/dev/null 2>&1
  elif [ -n "$S3CRED_DIR" ] && [ -r "/tmp/rp-s3get.py" ]; then
    sudo python3 /tmp/rp-s3get.py "$S3CRED_DIR/s3-access-key" "$S3CRED_DIR/s3-secret-key" \
      "$BUCKET" "$1" --delete >/dev/null 2>&1
  else
    return 1
  fi
}
if s3_get "$PREFIX/sites/site-$SITE/releases/$REL/manifest.json" /tmp/rp-manifest.json; then
  ok "object store manifest exists"
  # 0b：manifest 必须含 media/<f> 对象且哈希与上传字节一致
  MEDIA_SHA=$(python3 -c '
import json,sys
d=json.load(open("/tmp/rp-manifest.json"))
for o in d["objects"]:
    if o["path"]=="media/%s"%sys.argv[1]:
        print(o["sha256"]); break' "$IMG_FILE" 2>/dev/null)
  [ -n "$MEDIA_SHA" ] && [ "$MEDIA_SHA" = "$IMG_SHA" ] \
    && ok "manifest media object $IMG_FILE sha matches upload" \
    || bad "manifest media object mismatch got=$MEDIA_SHA want=$IMG_SHA"
  if s3_get "$PREFIX/sites/site-$SITE/releases/$REL/media/$IMG_FILE" /tmp/rp-media.bin; then
    GOT_SHA=$(sha256sum /tmp/rp-media.bin | cut -d' ' -f1)
    [ "$GOT_SHA" = "$IMG_SHA" ] \
      && ok "release media object bytes match upload sha" \
      || bad "release media object sha mismatch got=$GOT_SHA want=$IMG_SHA"
  else
    bad "release media object fetch failed"
  fi
else
  echo "SKIP: object store manifest check (no aws CLI / S3 credentials)"
fi

# ---------- 5.5. super-admin 提交发布（回执段角色不区分回归） ----------
# 历史问题：入口放行 super-admin，但回执段只认 publisher → super-admin 发布
# 先入队、再由 worker 以 RELEASE_PUBLISH_AUTHORIZATION_INVALID 终态失败。
# 2026-09-23 定调不区分后用独立纯文本文章验证 super-admin 全链路。
# 必须在第 6 节清理之前：此时第 1 篇仍在 published（有 passed 评估、URL
# active），不会卡第二个周期的整站编译质量门禁。
C2=$(python3 -c 'import json,sys;print(json.dumps({"title":sys.argv[1],"bodyMarkdown":sys.argv[2],"site":int(sys.argv[3])},ensure_ascii=False))' \
  "E2E super-admin 发布 $TS" "super-admin 发布回执段回归正文。" "$SITE" | \
  curl -s -X POST "$BASE/api/content-editions?draft=true&depth=0" -b /tmp/rp-e.jar \
    -H 'Content-Type: application/json' -d @-)
ED2=$(echo "$C2" | python3 -c 'import json,sys;print(json.load(sys.stdin)["doc"]["id"])')
[ -n "$ED2" ] && ok "sa draft created (edition=$ED2)" || { bad "sa create $C2"; exit 1; }
curl -s -o /dev/null -X POST "$BASE/api/editions/$ED2/workflow-transitions" -b /tmp/rp-e.jar \
  -H 'Content-Type: application/json' -d '{"target":"review"}'
R2=$(rev_of "$(draft "$ED2")")
A2=$(curl -s -X POST "$BASE/api/workspaces/reviewer/editions/$ED2/approve" -b /tmp/rp-r.jar \
  -H 'Content-Type: application/json' -H "x-request-id: rp-sa-a-$TS" -H "idempotency-key: rp-sa-approve-$TS" \
  -d "{\"expectedRevision\":$R2}")
[ "$(st_of "$A2")" = "approved" ] && ok "sa approve -> approved" || bad "sa approve $A2"
IH2=$(curl -s -H "$(auth)" "$BASE/api/internal/editions/$ED2/input" | python3 -c 'import json,sys;print(json.load(sys.stdin)["inputHash"])')
AS2=$(curl -s -X POST "$BASE/api/internal/editions/$ED2/assessments" -H "$(auth)" \
  -H 'Content-Type: application/json' -H "x-request-id: rp-sa-as-$TS" \
  -d "{\"inputHash\":\"$IH2\",\"issues\":[],\"modelId\":\"e2e-real-publish\",\"overall\":90,\"dimensions\":{\"content\":90,\"seo\":90,\"structure\":90},\"promptVersion\":\"e2e-1\",\"provider\":\"e2e\",\"state\":\"passed\",\"thresholdsHash\":\"$THRESH_HASH\"}")
[ "$(echo "$AS2" | python3 -c 'import json,sys;print(json.load(sys.stdin)["assessmentId"]>0)')" = "True" ] \
  && ok "sa assessment passed" || bad "sa assessment $AS2"
P2=$(curl -s -X POST "$BASE/api/editions/$ED2/publish-operations" -b /tmp/rp-r.jar \
  -H 'Content-Type: application/json' -d '{}')
echo "publish-op(sa): $P2"
OP2=$(echo "$P2" | python3 -c 'import json,sys;print(json.load(sys.stdin)["operation"]["operationId"])')
echo "$P2" | python3 -c '
import json,sys
o=json.load(sys.stdin)["operation"]
assert o["created"] is True and o["state"]=="queued", o' \
  && ok "sa publish-op created (op=$OP2)" || bad "sa publish-op $P2"

STATE2=""
for i in $(seq 1 40); do
  STATE2=$(Q "state FROM geo_foundry.operations WHERE operation_id='$OP2'")
  { [ "$STATE2" = "succeeded" ] || [ "$STATE2" = "failed" ]; } && break
  sleep 3
done
if [ "$STATE2" = "succeeded" ]; then
  ok "sa real worker consumed, operation succeeded"
else
  ERR2=$(Q "coalesce(error->>'code','') FROM geo_foundry.operations WHERE operation_id='$OP2'")
  bad "sa operation state=$STATE2 error=$ERR2"
fi
SA_ST=$(Q "workflow_status FROM geo_foundry.content_editions WHERE id=$ED2")
[ "$SA_ST" = "published" ] && ok "sa edition published (receipt accepted super-admin)" || bad "sa status=$SA_ST"
SA_URL=$(Q "state FROM geo_foundry.url_records WHERE edition_id=$ED2 AND site_id=$SITE")
[ "$SA_URL" = "active" ] && ok "sa URL active" || bad "sa url=$SA_URL"

# ---------- 6. 还原现场（两篇文章 + 媒体） ----------
D1=$(curl -s -X POST "$BASE/api/editions/$ED/draft-from-published" -b /tmp/rp-e.jar \
  -H 'Content-Type: application/json' -d '{"reason":"E2E real publish cleanup"}')
[ "$(st_of "$D1")" = "draft" ] && ok "cleanup draft-from-published -> draft" || bad "dfp $D1"
S=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/editions/$ED/workflow-transitions" -b /tmp/rp-e.jar \
  -H 'Content-Type: application/json' -d '{"target":"archived","reason":"E2E real publish cleanup"}')
[ "$(echo "$S" | tail -1)" = "200" ] && ok "cleanup -> archived" || bad "archive $(echo "$S"|tail -2)"

D2=$(curl -s -X POST "$BASE/api/editions/$ED2/draft-from-published" -b /tmp/rp-e.jar \
  -H 'Content-Type: application/json' -d '{"reason":"E2E real publish cleanup"}')
[ "$(st_of "$D2")" = "draft" ] && ok "cleanup sa draft-from-published -> draft" || bad "sa dfp $D2"
S2=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/editions/$ED2/workflow-transitions" -b /tmp/rp-e.jar \
  -H 'Content-Type: application/json' -d '{"target":"archived","reason":"E2E real publish cleanup"}')
[ "$(echo "$S2" | tail -1)" = "200" ] && ok "cleanup sa -> archived" || bad "sa archive $(echo "$S2"|tail -2)"

FINAL_ST=$(Q "workflow_status FROM geo_foundry.content_editions WHERE id=$ED")
[ "$FINAL_ST" = "archived" ] && ok "fixture archived ($FINAL_ST)" || bad "final status=$FINAL_ST"
FINAL_ST2=$(Q "workflow_status FROM geo_foundry.content_editions WHERE id=$ED2")
[ "$FINAL_ST2" = "archived" ] && ok "sa fixture archived ($FINAL_ST2)" || bad "sa final status=$FINAL_ST2"

# 清理一次性媒体：删 S3 对象 + media 行（自创建自清理，不碰 Mark 业务数据）
MT=$(Q "coalesce(tenant_id::text,'') FROM geo_foundry.media WHERE filename='$IMG_FILE'")
if [ -n "$MT" ]; then
  MPREFIX=$(grep '^GEO_FOUNDRY_S3_MEDIA_PREFIX=' /opt/geo-foundry/mk-dev.env 2>/dev/null | cut -d= -f2)
  [ -n "$MPREFIX" ] || MPREFIX="$PREFIX/media"
  s3_del "$MPREFIX/tenants/$MT/$IMG_FILE" \
    && ok "cleanup media object deleted" || echo "WARN: media object delete failed"
  PSQL "DELETE FROM geo_foundry.media WHERE filename='$IMG_FILE'" >/dev/null
  [ "$(Q "count(*) FROM geo_foundry.media WHERE filename='$IMG_FILE'")" = "0" ] \
    && ok "cleanup media row deleted" || bad "media row cleanup failed"
fi
rm -f /tmp/rp-img.png /tmp/rp-manifest.json /tmp/rp-media.bin

echo
echo "==== RESULT: ${#PASS[@]} passed, ${#FAIL[@]} failed ===="
[ ${#FAIL[@]} -gt 0 ] && printf 'FAILED: %s\n' "${FAIL[@]}" && exit 1
rm -f /tmp/rp-e.jar /tmp/rp-r.jar
exit 0
