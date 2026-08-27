import { readFile, stat } from "node:fs/promises"
import { resolve } from "node:path"

import { getPayload } from "payload"

import config from "../src/payload.config.ts"
import { activateUrlRecord, reserveUrlRecord } from "../src/services/url-registry.ts"

const scenario = JSON.parse(
  await readFile(resolve(import.meta.dirname, "../../../tests/fixtures/mvp/scenario.json"), "utf8"),
)

if (process.env.GEO_FOUNDRY_CMS_CONFIG_MODE !== "integration-test") {
  throw new Error("MVP_SEED_INTEGRATION_MODE_REQUIRED")
}

const passwordFile = process.env.GEO_FOUNDRY_MVP_TEST_PASSWORD_FILE
if (passwordFile === undefined || passwordFile.trim().length === 0) {
  throw new Error("MVP_SEED_PASSWORD_FILE_REQUIRED")
}
const passwordMetadata = await stat(passwordFile)
if ((passwordMetadata.mode & 0o077) !== 0 || passwordMetadata.uid !== process.getuid()) {
  throw new Error("MVP_SEED_PASSWORD_FILE_INSECURE")
}
const password = (await readFile(passwordFile, "utf8")).trim()
if (password.length < 12) {
  throw new Error("MVP_SEED_PASSWORD_FILE_INVALID")
}

const payload = await getPayload({ config })

const findOne = async (collection, where) => {
  const result = await payload.find({ collection, depth: 0, limit: 1, overrideAccess: true, where })
  return result.docs[0] ?? null
}

const report = {
  created: [],
  editionIds: {},
  existing: [],
  siteIds: {},
  tenantId: null,
  urlRecordIds: {},
  userIds: {},
}

let superAdmin = await findOne("users", { email: { equals: scenario.users.superAdmin.email } })
if (superAdmin === null) {
  superAdmin = await payload.create({
    collection: "users",
    data: {
      email: scenario.users.superAdmin.email,
      password,
      role: scenario.users.superAdmin.role,
    },
  })
  report.created.push(`users:${scenario.users.superAdmin.email}`)
} else {
  report.existing.push(`users:${scenario.users.superAdmin.email}`)
}
const asSuperAdmin = { depth: 0, overrideAccess: false, user: superAdmin }

const tenant = await (async () => {
  const existing = await findOne("tenants", { name: { equals: scenario.tenant.name } })
  if (existing !== null) {
    report.existing.push(`tenants:${scenario.tenant.name}`)
    return existing
  }
  const created = await payload.create({
    collection: "tenants",
    data: { name: scenario.tenant.name },
    ...asSuperAdmin,
  })
  report.created.push(`tenants:${scenario.tenant.name}`)
  return created
})()
report.tenantId = tenant.id

const findOrCreateAs = async (actor, collection, where, data, label) => {
  const existing = await findOne(collection, where)
  if (existing !== null) {
    report.existing.push(label)
    return existing
  }
  const created = await payload.create({ collection, data, ...actor })
  report.created.push(label)
  return created
}

for (const roleUser of scenario.users.roles) {
  const user = await findOrCreateAs(
    asSuperAdmin,
    "users",
    { email: { equals: roleUser.email } },
    {
      email: roleUser.email,
      password,
      role: roleUser.role,
      tenant: report.tenantId,
    },
    `users:${roleUser.email}`,
  )
  report.userIds[roleUser.key] = user.id
}

const tenantAdmin = await findOne("users", {
  email: { equals: scenario.users.roles.find((user) => user.key === "tenantAdmin")?.email },
})
const editor = await findOne("users", {
  email: { equals: scenario.users.roles.find((user) => user.key === "editor")?.email },
})
if (tenantAdmin === null || editor === null) {
  throw new Error("MVP_SEED_REQUIRED_ROLE_MISSING")
}
const asTenantAdmin = { depth: 0, overrideAccess: false, user: tenantAdmin }
const asEditor = { depth: 0, overrideAccess: false, user: editor }

for (const site of scenario.sites) {
  const created = await findOrCreateAs(
    asTenantAdmin,
    "sites",
    { and: [{ tenant: { equals: report.tenantId } }, { name: { equals: site.name } }] },
    {
      contentStrategy: {
        contentAngles: [site.strategy],
        positioning: site.positioning,
        tone: site.tone,
      },
      locale: "en-US",
      name: site.name,
      status: "active",
      tenant: report.tenantId,
      timezone: "UTC",
    },
    `sites:${site.name}`,
  )
  report.siteIds[site.key] = created.id
  await findOrCreateAs(
    asTenantAdmin,
    "domains",
    { hostname: { equals: site.canonicalDomain } },
    {
      hostname: site.canonicalDomain,
      role: "canonical",
      site: created.id,
      tenant: report.tenantId,
    },
    `domains:${site.canonicalDomain}`,
  )
  await findOrCreateAs(
    asTenantAdmin,
    "domains",
    { hostname: { equals: site.aliasDomain } },
    {
      hostname: site.aliasDomain,
      role: "alias",
      site: created.id,
      tenant: report.tenantId,
    },
    `domains:${site.aliasDomain}`,
  )
}

const content = await findOrCreateAs(
  asEditor,
  "contents",
  { and: [{ tenant: { equals: report.tenantId } }, { topic: { equals: scenario.content.topic } }] },
  { intent: scenario.content.intent, tenant: report.tenantId, topic: scenario.content.topic },
  `contents:${scenario.content.topic}`,
)
report.contentId = content.id

for (const edition of scenario.editions) {
  const created = await findOrCreateAs(
    asEditor,
    "content-editions",
    { and: [{ content: { equals: content.id } }, { angle: { equals: edition.angle } }] },
    {
      angle: edition.angle,
      body: [
        {
          blockType: "paragraph",
          text: `${edition.angle}: ${scenario.content.intent}`,
        },
      ],
      content: content.id,
      creationOrigin: "human",
      primaryTopic: scenario.content.topic,
      site: report.siteIds[edition.siteKey],
      summary: scenario.content.intent,
      tenant: report.tenantId,
      title: `${edition.angle}: ${scenario.content.topic}`,
    },
    `content-editions:${edition.angle}`,
  )
  report.editionIds[edition.key] = created.id
  const intake = await findOrCreateAs(
    asEditor,
    "intake-items",
    {
      and: [
        { tenant: { equals: report.tenantId } },
        { title: { equals: `Source for ${edition.angle}` } },
      ],
    },
    {
      channel: "manual",
      duplicateStatus: "unique",
      receivedAt: "2026-08-27T00:00:00.000Z",
      status: "ready",
      suggestedSite: report.siteIds[edition.siteKey],
      summary: `Traceable source for ${edition.angle}`,
      tenant: report.tenantId,
      title: `Source for ${edition.angle}`,
    },
    `intake-items:${edition.angle}`,
  )
  await findOrCreateAs(
    asEditor,
    "article-sources",
    {
      and: [
        { edition: { equals: created.id } },
        { intakeItem: { equals: intake.id } },
      ],
    },
    {
      edition: created.id,
      intakeItem: intake.id,
      note: "MVP scenario source",
      role: "primary",
      tenant: report.tenantId,
    },
    `article-sources:${edition.angle}`,
  )
  const existingUrl = await findOne("url-records", {
    and: [
      { content: { equals: content.id } },
      { pathname: { equals: edition.pathname } },
      { site: { equals: report.siteIds[edition.siteKey] } },
    ],
  })
  if (existingUrl !== null) {
    report.existing.push(`url-records:${edition.pathname}`)
    report.urlRecordIds[edition.key] = existingUrl.id
    continue
  }
  const reservedId = await reserveUrlRecord(payload, {
    contentId: content.id,
    locale: "en-US",
    pathname: edition.pathname,
    siteId: report.siteIds[edition.siteKey],
    tenantId: report.tenantId,
  })
  const site = scenario.sites.find((entry) => entry.key === edition.siteKey)
  if (site === undefined) {
    throw new Error("MVP_SEED_SITE_MISSING")
  }
  await activateUrlRecord(payload, reservedId, site.canonicalDomain)
  report.created.push(`url-records:${edition.pathname}`)
  report.urlRecordIds[edition.key] = reservedId
}

process.stdout.write(`${JSON.stringify(report)}\n`)
process.exit(0)
