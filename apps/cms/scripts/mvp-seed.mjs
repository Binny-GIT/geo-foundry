import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { getPayload } from "payload"

import config from "../src/payload.config"

const scenario = JSON.parse(
  await readFile(resolve(import.meta.dirname, "../../../tests/fixtures/mvp/scenario.json"), "utf8"),
)

if (process.env.GEO_FOUNDRY_CMS_CONFIG_MODE !== "integration-test") {
  throw new Error("MVP_SEED_INTEGRATION_MODE_REQUIRED")
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
  userIds: {},
}

const tenant = await (async () => {
  const existing = await findOne("tenants", { name: { equals: scenario.tenant.name } })
  if (existing !== null) {
    report.existing.push(`tenants:${scenario.tenant.name}`)
    return existing
  }
  const created = await payload.create({
    collection: "tenants",
    data: { name: scenario.tenant.name },
    overrideAccess: true,
  })
  report.created.push(`tenants:${scenario.tenant.name}`)
  return created
})()
report.tenantId = tenant.id

let superAdmin = await findOne("users", { email: { equals: scenario.users.superAdmin.email } })
if (superAdmin === null) {
  superAdmin = await payload.create({
    collection: "users",
    data: {
      email: scenario.users.superAdmin.email,
      password: scenario.users.superAdmin.password,
      role: scenario.users.superAdmin.role,
    },
    overrideAccess: true,
  })
  report.created.push(`users:${scenario.users.superAdmin.email}`)
} else {
  report.existing.push(`users:${scenario.users.superAdmin.email}`)
}
const asSuperAdmin = { depth: 0, overrideAccess: false, user: superAdmin }

const findOrCreateAs = async (collection, where, data, label) => {
  const existing = await findOne(collection, where)
  if (existing !== null) {
    report.existing.push(label)
    return existing
  }
  const created = await payload.create({ collection, data, ...asSuperAdmin })
  report.created.push(label)
  return created
}

for (const roleUser of scenario.users.roles) {
  const user = await findOrCreateAs(
    "users",
    { email: { equals: roleUser.email } },
    {
      email: roleUser.email,
      password: roleUser.password,
      role: roleUser.role,
      tenant: report.tenantId,
    },
    `users:${roleUser.email}`,
  )
  report.userIds[roleUser.key] = user.id
}

for (const site of scenario.sites) {
  const created = await findOrCreateAs(
    "sites",
    { and: [{ tenant: { equals: report.tenantId } }, { name: { equals: site.name } }] },
    {
      contentStrategy: {
        contentAngles: [site.angle],
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
    "domains",
    { hostname: { equals: site.canonicalDomain } },
    {
      enabled: true,
      hostname: site.canonicalDomain,
      role: "canonical",
      site: created.id,
      tenant: report.tenantId,
    },
    `domains:${site.canonicalDomain}`,
  )
  await findOrCreateAs(
    "domains",
    { hostname: { equals: site.aliasDomain } },
    {
      enabled: true,
      hostname: site.aliasDomain,
      role: "alias",
      site: created.id,
      tenant: report.tenantId,
    },
    `domains:${site.aliasDomain}`,
  )
}

const content = await findOrCreateAs(
  "contents",
  { and: [{ tenant: { equals: report.tenantId } }, { topic: { equals: scenario.content.topic } }] },
  { intent: scenario.content.intent, tenant: report.tenantId, topic: scenario.content.topic },
  `contents:${scenario.content.topic}`,
)
report.contentId = content.id

for (const edition of scenario.editions) {
  const created = await findOrCreateAs(
    "content-editions",
    { and: [{ content: { equals: content.id } }, { angle: { equals: edition.angle } }] },
    {
      angle: edition.angle,
      content: content.id,
      creationOrigin: "scenario-seed",
      site: report.siteIds[edition.siteKey],
      tenant: report.tenantId,
      workflowStatus: "draft",
    },
    `content-editions:${edition.angle}`,
  )
  report.editionIds[edition.key] = created.id
}

process.stdout.write(`${JSON.stringify(report)}\n`)
process.exit(0)
