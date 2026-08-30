import { getPayload } from "payload"

import config from "../src/payload.config.ts"

const MARKER = "Geo Foundry Worker business smoke fixture"

const payload = await getPayload({ config })
try {
  const users = await payload.find({
    collection: "users",
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { email: { equals: "embed-editor@geo-foundry.test" } },
  })
  const editor = users.docs[0]
  if (editor === undefined || typeof editor.tenant !== "number") {
    throw new Error("WORKER_BUSINESS_SMOKE_EDITOR_MISSING")
  }
  const existing = await payload.find({
    collection: "content-editions",
    depth: 0,
    draft: true,
    limit: 2,
    overrideAccess: true,
    where: { title: { equals: MARKER } },
  })
  const edition = existing.docs[0]
  if (edition !== undefined) {
    if (edition.tenant !== editor.tenant || edition.workflowStatus !== "draft") {
      throw new Error("WORKER_BUSINESS_SMOKE_FIXTURE_INVALID")
    }
    console.log(JSON.stringify({ editionId: edition.id, tenantId: editor.tenant }))
    process.exit(0)
  }
  const sites = await payload.find({
    collection: "sites",
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { and: [{ tenant: { equals: editor.tenant } }, { status: { equals: "active" } }] },
  })
  const site = sites.docs[0]
  if (site === undefined) throw new Error("WORKER_BUSINESS_SMOKE_SITE_MISSING")
  const content = await payload.create({
    collection: "contents",
    data: {
      createdBy: "human",
      intent: MARKER,
      tenant: editor.tenant,
      topic: "worker-business-smoke",
    },
    depth: 0,
    overrideAccess: true,
    user: editor,
  })
  const created = await payload.create({
    collection: "content-editions",
    data: {
      angle: "append-only smoke evidence",
      body: [{ blockType: "paragraph", text: MARKER }],
      content: content.id,
      creationOrigin: "human",
      primaryTopic: "worker-business-smoke",
      site: site.id,
      summary: MARKER,
      tenant: editor.tenant,
      title: MARKER,
    },
    depth: 0,
    draft: true,
    overrideAccess: true,
    user: editor,
  })
  console.log(JSON.stringify({ editionId: created.id, tenantId: editor.tenant }))
} finally {
  void payload.destroy()
}

process.exit(0)
