import { getPayload } from "payload"

import config from "../src/payload.config.ts"

const reviewerPassword = process.env.GEO_FOUNDRY_BROWSER_REVIEWER_PASSWORD
const publisherPassword = process.env.GEO_FOUNDRY_BROWSER_PUBLISHER_PASSWORD
if (!reviewerPassword || !publisherPassword) {
  throw new Error("BROWSER_BUSINESS_PASSWORDS_REQUIRED")
}

const payload = await getPayload({ config })
try {
  const admins = await payload.find({
    collection: "users",
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { email: { equals: "embed-tenant-admin@geo-foundry.test" } },
  })
  const tenantAdmin = admins.docs[0]
  if (tenantAdmin === undefined || typeof tenantAdmin.tenant !== "number") {
    throw new Error("BROWSER_BUSINESS_TENANT_ADMIN_MISSING")
  }
  for (const [email, password, role] of [
    ["browser-business-reviewer@geo-foundry.test", reviewerPassword, "reviewer"],
    ["browser-business-publisher@geo-foundry.test", publisherPassword, "publisher"],
  ]) {
    const existing = await payload.find({
      collection: "users",
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { email: { equals: email } },
    })
    const user = existing.docs[0]
    if (user === undefined) {
      await payload.create({
        collection: "users",
        data: { email, password, role, tenant: tenantAdmin.tenant },
        depth: 0,
        overrideAccess: false,
        user: tenantAdmin,
      })
      continue
    }
    await payload.update({
      collection: "users",
      id: user.id,
      data: { password, role, tenant: tenantAdmin.tenant },
      depth: 0,
      overrideAccess: false,
      user: tenantAdmin,
    })
  }
  console.log(JSON.stringify({ code: "BROWSER_BUSINESS_USERS_READY" }))
} finally {
  void payload.destroy()
}

process.exit(0)
