import { getPayload } from "payload"

import config from "../src/payload.config.ts"
import { pollDueRssConnectors } from "../src/services/connector-polling.ts"

const RSS_FEED_URL = "https://hnrss.org/frontpage"
const WAIT_TIMEOUT_MS = 2 * 60_000
const POLL_INTERVAL_MS = 5_000

const fail = (code) => {
  throw new Error(code)
}

const waitFor = async (probe) => {
  const deadline = Date.now() + WAIT_TIMEOUT_MS
  while (Date.now() < deadline) {
    const value = await probe()
    if (value !== null) return value
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  fail("E2E_RSS_TIMEOUT")
}

const payload = await getPayload({ config })
let exitCode = 0
let connectorId = null
try {
  const users = await payload.find({
    collection: "users",
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { email: { equals: "embed-tenant-admin@geo-foundry.test" } },
  })
  const tenantAdmin = users.docs[0] ?? fail("E2E_RSS_TENANT_ADMIN_MISSING")
  const sites = await payload.find({
    collection: "sites",
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { and: [{ tenant: { equals: tenantAdmin.tenant } }, { status: { equals: "active" } }] },
  })
  const site = sites.docs[0] ?? fail("E2E_RSS_SITE_MISSING")
  const connector = await payload.create({
    collection: "connectors",
    data: {
      name: `E2E RSS poll ${new Date().toISOString()}`,
      site: site.id,
      sourceEndpoint: RSS_FEED_URL,
      status: "active",
      tenant: tenantAdmin.tenant,
      type: "rss",
    },
    depth: 0,
    overrideAccess: true,
    user: tenantAdmin,
  })
  connectorId = connector.id

  const firstPollAt = new Date().toISOString()
  const first = await pollDueRssConnectors(payload, { now: firstPollAt })
  if (!first.polled.includes(connector.id)) fail("E2E_RSS_CONNECTOR_NOT_POLLED")
  const second = await pollDueRssConnectors(payload, { now: firstPollAt })
  if (second.polled.includes(connector.id)) fail("E2E_RSS_POLL_LEASE_BYPASSED")

  const parent = await waitFor(async () => {
    const found = await payload.find({
      collection: "intake-items",
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: {
        and: [
          { channel: { equals: "rss" } },
          { connector: { equals: connector.id } },
          { tenant: { equals: tenantAdmin.tenant } },
        ],
      },
    })
    const candidate = found.docs[0]
    if (candidate === undefined) return null
    if (candidate.status === "failed") fail(`E2E_RSS_PARENT_FAILED:${candidate.failureCode ?? "unknown"}`)
    return candidate.status === "ready" ? candidate : null
  })
  const children = await payload.find({
    collection: "intake-items",
    depth: 0,
    limit: 100,
    overrideAccess: true,
    where: {
      and: [
        { channel: { equals: "url" } },
        { connector: { equals: connector.id } },
        { tenant: { equals: tenantAdmin.tenant } },
      ],
    },
  })
  if (children.docs.length === 0) fail("E2E_RSS_CHILDREN_MISSING")
  console.log(JSON.stringify({
    code: "E2E_RSS_SUCCEEDED",
    childCount: children.docs.length,
    connectorId: connector.id,
    parentId: parent.id,
  }))
} catch (error) {
  exitCode = 1
  console.error(JSON.stringify({ code: "E2E_RSS_FAILED", message: String(error) }))
} finally {
  if (connectorId !== null) {
    await payload.update({
      collection: "connectors",
      data: { status: "disabled" },
      depth: 0,
      id: connectorId,
      overrideAccess: true,
    }).catch(() => undefined)
  }
  void payload.destroy()
}

process.exit(exitCode)
