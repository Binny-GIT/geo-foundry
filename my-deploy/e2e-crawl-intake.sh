#!/usr/bin/env bash
# mk-dev：先把 worker 的 GEO_FOUNDRY_CRAWL_BASE_URL 指向 http://host.docker.internal:18097 再执行。
set -euo pipefail
BASE=${GF_CMS_BASE_URL:-http://127.0.0.1:3090}
TENANT=${GF_E2E_TENANT_ID:-413}
SITE=${GF_E2E_SITE_ID:-374}
PORT=${GF_E2E_FAKE_PORT:-18097}
REF="e2e-crawl-$(date +%s)-$$"
KEY=$(openssl rand -hex 24)
SECRET=$(openssl rand -hex 24)
DIR=${GF_E2E_CREDENTIALS_DIR:-/opt/geo-foundry/credentials}
TMP=$(mktemp -d)
CID=""
FAKE_PID=""
PSQL() { sudo docker exec pg-server psql -U gpucloud -d geo_foundry -qAt -v ON_ERROR_STOP=1 -c "$1"; }
cleanup() {
  if [ -n "$FAKE_PID" ]; then kill "$FAKE_PID" 2>/dev/null || true; fi
  if [ -n "$CID" ]; then
    PSQL "DELETE FROM geo_foundry.crawl_jobs WHERE connector_id=$CID; DELETE FROM geo_foundry.intake_items WHERE connector_id=$CID; DELETE FROM geo_foundry.connectors WHERE id=$CID AND name='$REF';" >/dev/null || true
  fi
  sudo rm -f "$DIR/$REF.console-key" "$DIR/$REF.callback-secret"
  rm -rf "$TMP"
}
trap cleanup EXIT

sudo install -o 1001 -g 1001 -m 0600 /dev/null "$DIR/$REF.console-key"
sudo install -o 1001 -g 1001 -m 0600 /dev/null "$DIR/$REF.callback-secret"
printf '%s' "$KEY" | sudo tee "$DIR/$REF.console-key" >/dev/null
printf '%s' "$SECRET" | sudo tee "$DIR/$REF.callback-secret" >/dev/null

GF_FAKE_KEY="$KEY" GF_FAKE_SECRET="$SECRET" GF_FAKE_PORT="$PORT" GF_FAKE_REF="$REF" node --input-type=module - "$TMP" <<'NODE' &
import { createServer } from 'node:http'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
const dir = process.argv[2]
const jobs = new Map()
createServer(async (req, res) => {
  if (req.headers['x-api-key'] !== process.env.GF_FAKE_KEY) { res.writeHead(401).end(); return }
  const path = new URL(req.url, 'http://fake').pathname
  if (req.method === 'POST' && path === '/api/jobs') {
    const body = JSON.parse(await new Promise(resolve => { let text = ''; req.on('data', chunk => text += chunk); req.on('end', () => resolve(text)) }))
    if (body.type !== 'article_collection' || body.params?.output?.format !== 'article_collection' ||
        body.params?.callback?.secretRef !== process.env.GF_FAKE_REF ||
        body.params?.callback?.url !== 'https://geo-foundry-mk-dev.aixllent.com/api/integration/crawl-callbacks') {
      res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'invalid_callback' }))
      return
    }
    const id = `job_${randomBytes(8).toString('hex')}`
    jobs.set(id, { id, status: 'pending', callback: body.params.callback })
    res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({ id, status: 'pending' }))
    setTimeout(async () => {
      const job = jobs.get(id)
      if (!job) return
      job.status = 'succeeded'
      const deliveryId = randomUUID()
      const raw = JSON.stringify({ deliveryId, jobId: id, status: 'succeeded', occurredAt: new Date().toISOString() })
      const timestamp = String(Math.floor(Date.now() / 1000))
      const signature = `sha256=${createHmac('sha256', process.env.GF_FAKE_SECRET).update(`${timestamp}.${raw}`).digest('hex')}`
      await fetch(job.callback.url, { method: 'POST', headers: {
        'content-type': 'application/json', 'x-crawl-delivery-id': deliveryId,
        'x-crawl-timestamp': timestamp, 'x-crawl-signature': signature,
      }, body: raw })
      writeFileSync(`${dir}/last-id`, id)
    }, 3000)
    return
  }
  const id = path.split('/')[3]
  const job = jobs.get(id)
  if (!job) { res.writeHead(404).end(JSON.stringify({ error: 'job_not_found' })); return }
  if (req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id, status: job.status,
      result: job.status === 'succeeded' ? { engine: 'scrapling', artifacts: [], execution: {}, data: {
        schema_version: '1.0', type: 'article_collection',
        source_url: 'https://example.test', requested_count: 1, returned_count: 1, status: 'complete',
        items: [{ title: '采集 E2E 文章', url: `https://example.test/${process.env.GF_FAKE_REF}`,
          canonical_url: `https://example.test/${process.env.GF_FAKE_REF}?utm_source=crawl`, content: '# 测试正文\n\n可供人工审阅的内容。', summary: '测试摘要', _meta: {} }], warnings: [], _meta: {} } } : null }))
    return
  }
  if (req.method === 'DELETE') { jobs.delete(id); res.writeHead(204).end(); return }
  res.writeHead(405).end()
}).listen(Number(process.env.GF_FAKE_PORT), '0.0.0.0')
NODE
FAKE_PID=$!

CID=$(PSQL "INSERT INTO geo_foundry.connectors (name,type,status,site_id,tenant_id,source_endpoint,secret_reference,poll_interval_minutes) VALUES ('$REF','crawl','active',$SITE,$TENANT,'https://example.test','$REF',5) RETURNING id")
for cycle in 1 2; do
  if [ "$cycle" = 2 ]; then PSQL "UPDATE geo_foundry.connectors SET last_polled_at=now()-interval '6 minutes' WHERE id=$CID" >/dev/null; fi
  completed=0
  for attempt in $(seq 1 100); do
    completed=$(PSQL "SELECT count(*) FROM geo_foundry.crawl_jobs WHERE connector_id=$CID AND acked_at IS NOT NULL")
    [ "$completed" -ge "$cycle" ] && break
    sleep 2
  done
  [ "$completed" -ge "$cycle" ] || { echo "FAIL: cycle $cycle not acknowledged"; exit 1; }
done
rows=$(PSQL "SELECT count(*) FROM geo_foundry.intake_items WHERE connector_id=$CID AND channel='crawl' AND source_url IS NOT NULL")
duplicates=$(PSQL "SELECT count(*) FROM geo_foundry.intake_items WHERE connector_id=$CID AND channel='crawl' AND status='duplicate'")
[ "$rows" -eq 2 ] && [ "$duplicates" -eq 1 ] || { echo "FAIL: rows=$rows duplicates=$duplicates"; exit 1; }
last_job=$(<"$TMP/last-id")
delivery=$(node -e 'console.log(require("node:crypto").randomUUID())')
timestamp=$(date +%s)
tamper=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/integration/crawl-callbacks" \
  -H "X-Crawl-Delivery-Id: $delivery" -H "X-Crawl-Timestamp: $timestamp" \
  -H "X-Crawl-Signature: sha256=$(printf '%064d' 0)" -H 'Content-Type: application/json' \
  -d "{\"deliveryId\":\"$delivery\",\"jobId\":\"$last_job\",\"status\":\"succeeded\",\"occurredAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}")
[ "$tamper" = 401 ] || { echo "FAIL: tamper returned $tamper"; exit 1; }
echo "PASS: two cycles acknowledged, dedupe and tamper rejection"
