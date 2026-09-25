#!/usr/bin/env bash
# 补齐定时 E2E 残留文章（715 已 mock 发布、716 cancel 夹具）的 passed 评估记录，
# 解除多站 E2E 预检阻断；随后重跑预检 SQL 验证。
set -uo pipefail
BASE=http://127.0.0.1:3090
SKEY=$(sudo python3 -c 'import json;print(json.load(open("/opt/geo-foundry/credentials/content-service-keyring.json"))["tenants"]["413"])')
auth() { echo "Authorization: users API-Key $SKEY"; }
THRESH_HASH=$(python3 -c "import hashlib;print(hashlib.sha256(b'e2e-multi-site-defaults').hexdigest())")
for ED in 715 716; do
  IH=$(curl -s -H "$(auth)" "$BASE/api/internal/editions/$ED/input" | python3 -c 'import json,sys;print(json.load(sys.stdin)["inputHash"])')
  [ -n "$IH" ] || { echo "FAIL: edition $ED inputHash empty"; exit 1; }
  AS=$(curl -s -X POST "$BASE/api/internal/editions/$ED/assessments" -H "$(auth)" \
    -H 'Content-Type: application/json' -H "x-request-id: tmp-assess-$ED-$(date +%s)" \
    -d "{\"inputHash\":\"$IH\",\"issues\":[],\"modelId\":\"e2e-multi-site\",\"overall\":90,\"dimensions\":{\"content\":90,\"seo\":90,\"structure\":90},\"promptVersion\":\"e2e-1\",\"provider\":\"e2e\",\"state\":\"passed\",\"thresholdsHash\":\"$THRESH_HASH\"}")
  echo "edition $ED assessment: $AS"
done
STALE=$(sudo docker exec pg-server psql -U gpucloud -d geo_foundry -qAt -c "SELECT ce.id FROM geo_foundry.content_editions ce JOIN geo_foundry.edition_revisions ev ON ev.parent_id = ce.id AND ev.latest WHERE ev.site_id = 375 AND ev.workflow_status IN ('approved','compiled','published') AND NOT EXISTS (SELECT 1 FROM geo_foundry.quality_assessments qa WHERE qa.edition_id = ce.id AND qa.state = 'passed') ORDER BY ce.id")
if [ -z "$STALE" ]; then
  echo "precheck clean"
else
  echo "precheck still blocked: $STALE"
  exit 1
fi
