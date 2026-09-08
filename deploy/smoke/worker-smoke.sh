#!/usr/bin/env bash
set -euo pipefail

WORKER_CONTAINER="${WORKER_CONTAINER:-geo-foundry-worker-mk-dev}"

state="$(sudo -n docker inspect --format '{{.State.Status}}' "$WORKER_CONTAINER")"
if [[ "$state" != "running" ]]; then
  printf 'WORKER_SMOKE_NOT_RUNNING state=%s\n' "$state" >&2
  exit 1
fi

sudo -n docker exec -w /worker -i "$WORKER_CONTAINER" node --input-type=module <<'NODE'
import { readFileSync } from "node:fs"

import pg from "pg"

const requiredFile = (name) => {
  const path = process.env[name]
  if (typeof path !== "string" || path.length === 0) {
    throw new Error(`WORKER_SMOKE_FILE_MISSING:${name}`)
  }
  const value = readFileSync(path, "utf8").trim()
  if (value.length === 0) {
    throw new Error(`WORKER_SMOKE_FILE_EMPTY:${name}`)
  }
  return value
}

const keyring = JSON.parse(requiredFile("CONTENT_SERVICE_KEYRING_FILE"))
if (
  typeof keyring !== "object" ||
  keyring === null ||
  typeof keyring.tenants !== "object" ||
  keyring.tenants === null ||
  Object.keys(keyring.tenants).length === 0 ||
  !Object.entries(keyring.tenants).every(([tenantId, apiKey]) => /^\d+$/.test(tenantId) && typeof apiKey === "string" && apiKey.length > 0)
) {
  throw new Error("WORKER_SMOKE_KEYRING_INVALID")
}

const connectionString = requiredFile("GEO_FOUNDRY_WORKER_PG_URL_FILE")
const pool = new pg.Pool({ connectionString, max: 1 })
try {
  const probe = await pool.query("SELECT count(*)::int AS n FROM pgboss.queue")
  if (probe.rows[0].n < 1) {
    throw new Error("WORKER_SMOKE_PGBOSS_QUEUES_MISSING")
  }
} finally {
  await pool.end().catch(() => undefined)
}

const cmsBaseUrl = process.env.CMS_BASE_URL
if (typeof cmsBaseUrl !== "string" || cmsBaseUrl.length === 0) {
  throw new Error("WORKER_SMOKE_CMS_URL_MISSING")
}
const health = await fetch(new URL("/api/health", cmsBaseUrl), { signal: AbortSignal.timeout(10_000) })
if (!health.ok) {
  throw new Error(`WORKER_SMOKE_CMS_HEALTH_${health.status}`)
}

console.log(JSON.stringify({ code: "WORKER_SMOKE_OK", tenants: Object.keys(keyring.tenants).length }))
NODE
