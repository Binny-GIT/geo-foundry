/*
 * worker-business-smoke 的固定 fixture：按标题定位 mk-dev 上的长期草稿
 * （编辑 550，租户 413）。fixture 缺失时在编辑（embed-editor）名下用与
 * Console 相同的草稿创建服务自建同名草稿，换环境无需手工准备。
 */
import { and, asc, eq } from "drizzle-orm"

import { contentEditions, editionVersions } from "../src/server/db/edition-schema.ts"
import { sites } from "../src/server/db/entity-schema.ts"
import { users } from "../src/server/db/schema.ts"
import { EditionsRepository } from "../src/server/repositories/editions.ts"
import { serverRuntime } from "../src/server/runtime.ts"

const MARKER = "Geo Foundry Worker business smoke fixture"
const BODY = "# Fixture\n\nworker business smoke 固定正文。"

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
const locate = async () => {
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
  return rows[0] ?? null
}
let edition = await locate()
if (edition === null) {
  const siteRows = await db
    .select({ id: sites.id })
    .from(sites)
    .where(eq(sites.tenantId, editor.tenantId))
    .orderBy(asc(sites.id))
    .limit(1)
  const site = siteRows[0]
  if (site === undefined) {
    throw new Error("WORKER_BUSINESS_SMOKE_SITE_MISSING")
  }
  const doc = await new EditionsRepository(db).createDraft(
    { kind: "tenant", tenantId: editor.tenantId },
    { bodyMarkdown: BODY, site: site.id, title: MARKER },
  )
  edition = await locate()
  if (edition === null) {
    throw new Error(`WORKER_BUSINESS_SMOKE_CREATE_FAILED:${String(doc)}`)
  }
  console.error(`fixture self-provisioned as edition ${edition.editionId}`)
}
if (edition.tenantId !== editor.tenantId || edition.status !== "draft") {
  throw new Error("WORKER_BUSINESS_SMOKE_FIXTURE_INVALID")
}
console.log(JSON.stringify({ editionId: edition.editionId, tenantId: editor.tenantId }))
process.exit(0)
