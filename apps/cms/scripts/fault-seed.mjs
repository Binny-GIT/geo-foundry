import { readFile, stat } from "node:fs/promises"

import { getPayload } from "payload"

import config from "../src/payload.config.ts"
import { activateUrlRecord, reserveUrlRecord } from "../src/services/url-registry.ts"

const runIdPattern = /^todo39-[a-z0-9]{20}$/

const fail = (code) => {
  throw new Error(code)
}

const runIdOf = () => {
  const runId = process.env.GEO_FOUNDRY_FAULT_RUN_ID
  if (runId === undefined || !runIdPattern.test(runId)) {
    fail("CMS_FAULT_RUN_ID_INVALID")
  }
  return runId
}

const passwordOf = async () => {
  const path = process.env.GEO_FOUNDRY_FAULT_PASSWORD_FILE
  if (path === undefined || path.trim().length === 0) {
    fail("CMS_FAULT_PASSWORD_FILE_REQUIRED")
  }
  const metadata = await stat(path)
  if ((metadata.mode & 0o077) !== 0 || metadata.uid !== process.getuid()) {
    fail("CMS_FAULT_PASSWORD_FILE_INSECURE")
  }
  const password = (await readFile(path, "utf8")).trim()
  if (password.length < 12) {
    fail("CMS_FAULT_PASSWORD_FILE_INVALID")
  }
  return password
}

if (process.env.GEO_FOUNDRY_CMS_CONFIG_MODE !== "fault-test") {
  fail("CMS_FAULT_MODE_REQUIRED")
}

const runId = runIdOf()
const password = await passwordOf()
const suffix = runId.slice("todo39-".length)
const hostname = `fault-${suffix}.test`
const payload = await getPayload({ config })

try {
  const bootstrap = await payload.create({
    collection: "users",
    data: {
      email: `fault-bootstrap-${suffix}@geo-foundry.test`,
      password,
      role: "super-admin",
    },
    depth: 0,
  })
  const asBootstrap = { depth: 0, overrideAccess: false, user: bootstrap }
  const tenant = await payload.create({
    collection: "tenants",
    data: { name: `fault-tenant-${suffix}` },
    ...asBootstrap,
  })
  const foreignTenant = await payload.create({
    collection: "tenants",
    data: { name: `fault-foreign-tenant-${suffix}` },
    ...asBootstrap,
  })
  const createUser = async (role, tenantId, label) =>
    payload.create({
      collection: "users",
      data: {
        email: `fault-${label}-${suffix}@geo-foundry.test`,
        password,
        role,
        tenant: tenantId,
      },
      ...asBootstrap,
    })
  const tenantAdmin = await createUser("tenant-admin", tenant.id, "admin")
  const editor = await createUser("editor", tenant.id, "editor")
  const reviewer = await createUser("reviewer", tenant.id, "reviewer")
  const publisher = await createUser("publisher", tenant.id, "publisher")
  const service = await createUser("content-service", tenant.id, "service")
  const foreignService = await createUser("content-service", foreignTenant.id, "foreign-service")
  const asTenantAdmin = { depth: 0, overrideAccess: false, user: tenantAdmin }
  const asEditor = { depth: 0, overrideAccess: false, user: editor }
  const site = await payload.create({
    collection: "sites",
    data: {
      contentStrategy: {
        contentAngles: ["fault-recovery"],
        positioning: "Run-owned control-plane recovery validation",
        tone: "precise",
      },
      locale: "en-US",
      name: `Fault Site ${suffix}`,
      status: "active",
      tenant: tenant.id,
      timezone: "UTC",
    },
    ...asTenantAdmin,
  })
  await payload.create({
    collection: "domains",
    data: {
      hostname,
      role: "canonical",
      site: site.id,
      status: "active",
      tenant: tenant.id,
    },
    ...asTenantAdmin,
  })
  const content = await payload.create({
    collection: "contents",
    data: {
      createdBy: "human",
      intent: "Validate a run-owned publish crash recovery path.",
      tenant: tenant.id,
      topic: `fault-recovery-${suffix}`,
    },
    ...asEditor,
  })
  const edition = await payload.create({
    collection: "content-editions",
    data: {
      angle: "post-CAS registry recovery",
      body: [
        {
          blockType: "paragraph",
          text: "This run-owned edition validates deterministic release reconciliation.",
        },
      ],
      content: content.id,
      creationOrigin: "human",
      primaryTopic: "fault-recovery",
      site: site.id,
      summary: "Run-owned post-CAS recovery fixture.",
      tenant: tenant.id,
      title: "Fault-owned release recovery fixture",
    },
    ...asEditor,
  })
  const intake = await payload.create({
    collection: "intake-items",
    data: {
      channel: "manual",
      duplicateStatus: "unique",
      receivedAt: "2026-08-27T00:00:00.000Z",
      status: "ready",
      suggestedSite: site.id,
      summary: "Run-owned source for control-plane recovery validation.",
      tenant: tenant.id,
      title: `Fault recovery source ${suffix}`,
    },
    ...asEditor,
  })
  await payload.create({
    collection: "article-sources",
    data: {
      edition: edition.id,
      intakeItem: intake.id,
      note: "Fault recovery source chain",
      role: "primary",
      tenant: tenant.id,
    },
    ...asEditor,
  })
  const urlRecordId = await reserveUrlRecord(payload, {
    contentId: content.id,
    locale: "en-US",
    pathname: "/articles/fault-recovery",
    siteId: site.id,
    tenantId: tenant.id,
  })
  await activateUrlRecord(payload, urlRecordId, hostname)

  process.stdout.write(
    `${JSON.stringify({
      editionId: edition.id,
      emails: {
        editor: editor.email,
        foreignService: foreignService.email,
        publisher: publisher.email,
        reviewer: reviewer.email,
        service: service.email,
      },
      foreignTenantId: foreignTenant.id,
      siteId: site.id,
      tenantId: tenant.id,
    })}\n`,
  )
} finally {
  await payload.destroy()
}

process.exit(0)
