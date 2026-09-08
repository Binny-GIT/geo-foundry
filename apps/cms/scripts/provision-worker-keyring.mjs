/*
 * 为每个 content-service 身份轮换一把 API key，并把 <tenantId → key> 写入
 * 凭据目录（600）。数据库只落 HMAC 索引（与自建认证层的查找一致），
 * 明文 key 只存在于 keyring 文件。
 */
import { randomBytes } from "node:crypto"
import { rename, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { eq } from "drizzle-orm"

import { payloadApiKeyIndexesOf } from "../src/server/auth/compat.ts"
import { users } from "../src/server/db/schema.ts"
import { serverRuntime } from "../src/server/runtime.ts"

const directory = process.env.GEO_FOUNDRY_CREDENTIALS_DIR
if (directory === undefined || directory.trim().length === 0) {
  throw new Error("WORKER_KEYRING_DIRECTORY_REQUIRED")
}

const destination = join(directory, "content-service-keyring.json")
const temporary = `${destination}.${process.pid}.tmp`
const runtime = serverRuntime()

const services = await runtime.db
  .select({ id: users.id, tenantId: users.tenantId })
  .from(users)
  .where(eq(users.role, "content-service"))
  .limit(100)
const tenants = {}
for (const service of services) {
  if (service.tenantId === null) throw new Error("WORKER_KEYRING_SERVICE_TENANT_INVALID")
  const apiKey = randomBytes(32).toString("base64url")
  const [, sha256Index] = payloadApiKeyIndexesOf(apiKey, runtime.configSecret)
  await runtime.db
    .update(users)
    .set({ apiKey: null, apiKeyIndex: sha256Index, enableAPIToken: true, updatedAt: new Date() })
    .where(eq(users.id, service.id))
  tenants[String(service.tenantId)] = apiKey
}
if (Object.keys(tenants).length === 0) {
  throw new Error("WORKER_KEYRING_SERVICE_IDENTITY_MISSING")
}
await writeFile(temporary, `${JSON.stringify({ tenants })}\n`, { mode: 0o600 })
await rename(temporary, destination)
process.stdout.write(
  `${JSON.stringify({ code: "WORKER_KEYRING_PROVISIONED", tenants: Object.keys(tenants).length })}\n`,
)
process.exit(0)
