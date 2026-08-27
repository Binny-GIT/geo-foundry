import { randomBytes } from "node:crypto"
import { rename, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { getPayload } from "payload"

import config from "../src/payload.config.ts"

const directory = process.env.GEO_FOUNDRY_CREDENTIALS_DIR
if (directory === undefined || directory.trim().length === 0) {
  throw new Error("WORKER_KEYRING_DIRECTORY_REQUIRED")
}

const destination = join(directory, "content-service-keyring.json")
const temporary = `${destination}.${process.pid}.tmp`
const payload = await getPayload({ config })

try {
  const superAdmins = await payload.find({
    collection: "users",
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { role: { equals: "super-admin" } },
  })
  const actor = superAdmins.docs[0]
  if (actor === undefined) throw new Error("WORKER_KEYRING_SUPER_ADMIN_MISSING")
  const services = await payload.find({
    collection: "users",
    depth: 0,
    limit: 100,
    overrideAccess: true,
    where: { role: { equals: "content-service" } },
  })
  const tenants = {}
  for (const service of services.docs) {
    const tenantId = typeof service.tenant === "number" ? service.tenant : null
    if (tenantId === null) throw new Error("WORKER_KEYRING_SERVICE_TENANT_INVALID")
    const apiKey = randomBytes(32).toString("base64url")
    await payload.update({
      collection: "users",
      data: {
        apiKey,
        enableAPIKey: true,
        role: service.role,
        tenant: tenantId,
      },
      depth: 0,
      id: service.id,
      overrideAccess: false,
      user: actor,
    })
    tenants[String(tenantId)] = apiKey
  }
  if (Object.keys(tenants).length === 0) {
    throw new Error("WORKER_KEYRING_SERVICE_IDENTITY_MISSING")
  }
  await writeFile(temporary, `${JSON.stringify({ tenants })}\n`, { mode: 0o600 })
  await rename(temporary, destination)
  process.stdout.write(`${JSON.stringify({ code: "WORKER_KEYRING_PROVISIONED", tenants: Object.keys(tenants).length })}\n`)
  process.exit(0)
} finally {
  void payload.destroy()
}
