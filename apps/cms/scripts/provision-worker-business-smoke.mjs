/*
 * worker-business-smoke 的固定 fixture：按标题定位 mk-dev 上的长期草稿
 * （编辑 550，租户 413）。fixture 由早期 Payload 脚本创建并持续存在；
 * 若不存在，先用 Console 以 embed-editor 身份新建同名草稿。
 */
import { and, eq } from "drizzle-orm"

import { contentEditions, editionVersions } from "../src/server/db/edition-schema.ts"
import { users } from "../src/server/db/schema.ts"
import { serverRuntime } from "../src/server/runtime.ts"

const MARKER = "Geo Foundry Worker business smoke fixture"

const db = serverRuntime().db
const editors = await db
  .select({ id: users.id, tenantId: users.tenantId })
  .from(users)
  .where(eq(users.email, "embed-editor@geo-foundry.test"))
  .limit(1)
const editor = editors[0]
if (editor === undefined || editor.tenantId === null) {
  throw new Error("WORKER_BUSINESS_SMOKE_EDITOR_MISSING")
}
const rows = await db
  .select({
    editionId: contentEditions.id,
    status: editionVersions.workflowStatus,
    tenantId: editionVersions.tenantId,
  })
  .from(contentEditions)
  .innerJoin(
    editionVersions,
    and(eq(editionVersions.parentId, contentEditions.id), eq(editionVersions.latest, true)),
  )
  .where(eq(editionVersions.title, MARKER))
  .limit(2)
const edition = rows[0]
if (edition === undefined) {
  throw new Error(
    "WORKER_BUSINESS_SMOKE_FIXTURE_MISSING: create a draft titled exactly the marker with embed-editor",
  )
}
if (edition.tenantId !== editor.tenantId || edition.status !== "draft") {
  throw new Error("WORKER_BUSINESS_SMOKE_FIXTURE_INVALID")
}
console.log(JSON.stringify({ editionId: edition.editionId, tenantId: editor.tenantId }))
process.exit(0)
