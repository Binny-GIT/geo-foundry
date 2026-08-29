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

import { createClient } from "redis"

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

const redis = createClient({
  database: Number(process.env.GEO_FOUNDRY_REDIS_DATABASE ?? "0"),
  password: requiredFile("GEO_FOUNDRY_REDIS_PASSWORD_FILE"),
  socket: {
    host: process.env.GEO_FOUNDRY_REDIS_HOST,
    port: Number(process.env.GEO_FOUNDRY_REDIS_PORT ?? "6379"),
  },
})
try {
  await redis.connect()
  if ((await redis.ping()) !== "PONG") {
    throw new Error("WORKER_SMOKE_REDIS_PING_FAILED")
  }
} finally {
  await redis.quit().catch(() => undefined)
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
