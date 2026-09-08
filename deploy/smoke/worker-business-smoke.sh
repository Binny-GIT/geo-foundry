#!/usr/bin/env bash
set -euo pipefail

WORKER_CONTAINER="${WORKER_CONTAINER:-geo-foundry-worker-mk-dev}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-pg-server}"
PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REQUEST_ID="worker-business-smoke-$(date -u +%Y%m%d%H%M%S)-$$"

fixture_output="$({
  cd "$PROJECT_ROOT/apps/cms"
  GEO_FOUNDRY_PG_SECRET_REF=pg-server-mk-dev-existing-auth \
    GEO_FOUNDRY_S3_SECRET_REF=rustfs-geo-foundry-svc \
    /home/ubuntu/.local/bin/geo-foundry-cms-secure \
      env PATH=/home/ubuntu/.n/n/versions/node/24.18.0/bin:$PATH \
      node --import tsx scripts/provision-worker-business-smoke.mjs
})"

read -r edition_id tenant_id < <(
  python3 - "$fixture_output" <<'PY'
import json
import sys

for line in reversed(sys.argv[1].splitlines()):
    try:
        fixture = json.loads(line)
    except json.JSONDecodeError:
        continue
    if "editionId" in fixture and "tenantId" in fixture:
        print(f"{int(fixture['editionId'])} {int(fixture['tenantId'])}")
        break
else:
    raise SystemExit("WORKER_BUSINESS_SMOKE_FIXTURE_OUTPUT_INVALID")
PY
)

before="$(sudo -n docker exec -i -w /worker \
  -e SMOKE_EDITION_ID="$edition_id" \
  -e SMOKE_TENANT_ID="$tenant_id" \
  -e SMOKE_REQUEST_ID="$REQUEST_ID" \
  "$WORKER_CONTAINER" node --input-type=module <<'NODE'
import { readFileSync } from "node:fs"

const editionId = Number(process.env.SMOKE_EDITION_ID)
const tenantId = Number(process.env.SMOKE_TENANT_ID)
const requestId = process.env.SMOKE_REQUEST_ID
const keyring = JSON.parse(readFileSync(process.env.CONTENT_SERVICE_KEYRING_FILE, "utf8"))
const apiKey = keyring?.tenants?.[String(tenantId)]
if (typeof apiKey !== "string" || apiKey.length === 0) {
  throw new Error("WORKER_BUSINESS_SMOKE_KEYRING_TENANT_MISSING")
}
const headers = {
  authorization: `users API-Key ${apiKey}`,
  "content-type": "application/json",
  "x-operation-id": requestId,
  "x-request-id": requestId,
}
const inputResponse = await fetch(new URL(`/api/internal/editions/${editionId}/input`, process.env.CMS_BASE_URL), {
  headers,
  signal: AbortSignal.timeout(10_000),
})
if (!inputResponse.ok) throw new Error(`WORKER_BUSINESS_SMOKE_INPUT_${inputResponse.status}`)
const input = await inputResponse.json()
if (input.tenantId !== tenantId || input.workflowStatus !== "draft") {
  throw new Error("WORKER_BUSINESS_SMOKE_FIXTURE_STATE_INVALID")
}
const assessmentResponse = await fetch(
  new URL(`/api/internal/editions/${editionId}/assessments`, process.env.CMS_BASE_URL),
  {
    body: JSON.stringify({
      inputHash: input.inputHash,
      issues: [],
      modelId: "worker-business-smoke",
      promptVersion: "2026-08-30",
      provider: "worker-business-smoke",
      state: "failed",
      thresholdsHash: "d".repeat(64),
    }),
    headers,
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  },
)
if (!assessmentResponse.ok) throw new Error(`WORKER_BUSINESS_SMOKE_ASSESSMENT_${assessmentResponse.status}`)
console.log(JSON.stringify({
  inputHash: input.inputHash,
  workflowRevision: input.workflowRevision,
  workflowStatus: input.workflowStatus,
}))
NODE
)"

read -r input_hash workflow_revision workflow_status < <(
  python3 - "$before" <<'PY'
import json
import sys

result = json.loads(sys.argv[1])
print(result["inputHash"], result["workflowRevision"], result["workflowStatus"])
PY
)

postgres_user="$(sudo -n docker exec "$POSTGRES_CONTAINER" printenv POSTGRES_USER)"
# 等待链路证据：草稿写入事务内的 embedding 任务被 worker 消费完成
# （旧版等 outbox job 的 observed 回执；等价链路改为 pgboss 单例任务终态）。
job_state=""
for _ in $(seq 1 30); do
  job_state="$(sudo -n docker exec "$POSTGRES_CONTAINER" psql -U "$postgres_user" -d geo_foundry -At -c "SELECT state FROM pgboss.job WHERE name='content-embedding' AND data->>'editionId'='${edition_id}' ORDER BY created_on DESC LIMIT 1;")"
  if [[ "$job_state" == "completed" ]]; then
    break
  fi
  sleep 1
done
if [[ "$job_state" != "completed" ]]; then
  printf 'WORKER_BUSINESS_SMOKE_EMBEDDING_JOB_%s
' "${job_state:-missing}" >&2
  exit 1
fi

after="$(sudo -n docker exec -i -w /worker \
  -e SMOKE_EDITION_ID="$edition_id" \
  -e SMOKE_TENANT_ID="$tenant_id" \
  "$WORKER_CONTAINER" node --input-type=module <<'NODE'
import { readFileSync } from "node:fs"

const editionId = Number(process.env.SMOKE_EDITION_ID)
const tenantId = Number(process.env.SMOKE_TENANT_ID)
const keyring = JSON.parse(readFileSync(process.env.CONTENT_SERVICE_KEYRING_FILE, "utf8"))
const apiKey = keyring?.tenants?.[String(tenantId)]
if (typeof apiKey !== "string" || apiKey.length === 0) {
  throw new Error("WORKER_BUSINESS_SMOKE_KEYRING_TENANT_MISSING")
}
const response = await fetch(new URL(`/api/internal/editions/${editionId}/input`, process.env.CMS_BASE_URL), {
  headers: { authorization: `users API-Key ${apiKey}` },
  signal: AbortSignal.timeout(10_000),
})
if (!response.ok) throw new Error(`WORKER_BUSINESS_SMOKE_RECHECK_${response.status}`)
const input = await response.json()
console.log(JSON.stringify({
  inputHash: input.inputHash,
  workflowRevision: input.workflowRevision,
  workflowStatus: input.workflowStatus,
}))
NODE
)"

python3 - "$before" "$after" <<'PY'
import json
import sys

before = json.loads(sys.argv[1])
after = json.loads(sys.argv[2])
if before != after:
    raise SystemExit("WORKER_BUSINESS_SMOKE_EDITION_MUTATED")
PY

printf 'WORKER_BUSINESS_SMOKE_OK edition=%s embedding=completed
' "$edition_id"
printf 'WORKER_BUSINESS_SMOKE_OK edition=%s event=%s\n' "$edition_id" "$event_id"
