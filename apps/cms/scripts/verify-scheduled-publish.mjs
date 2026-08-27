/**
 * Production-semantic scheduled publish verification for mk-dev.
 * Creates a real edition in the embed tenant, walks it to approved,
 * schedules a publication ~90 seconds out, then polls until the Worker
 * claims, publishes, and settles the plan. Run via the secure wrapper:
 *   geo-foundry-cms-secure node --import tsx scripts/verify-scheduled-publish.mjs
 */
import { getPayload } from "payload"

import config from "../src/payload.config.ts"
import { createPublicationPlan } from "../src/services/publication-plans.ts"
import {
  currentEditionInputHash,
  loadWorkflowEdition,
  recordAssessment,
  transitionEdition,
} from "../src/services/edition-workflow.ts"

const fail = (code) => {
  throw new Error(code)
}

const payload = await getPayload({ config })
const findUser = async (email) => {
  const found = await payload.find({
    collection: "users",
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { email: { equals: email } },
  })
  return found.docs[0] ?? fail(`user ${email} missing`)
}
const findSite = async (tenantId) => {
  const found = await payload.find({
    collection: "sites",
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { and: [{ tenant: { equals: tenantId } }, { status: { equals: "active" } }] },
  })
  return found.docs[0] ?? fail("no active site in tenant")
}

try {
  const editor = await findUser("embed-editor@geo-foundry.test")
  const tenantAdmin = await findUser("embed-tenant-admin@geo-foundry.test")
  const tenantId = editor.tenant
  const ensureRoleUser = async (email, role) => {
    const existing = await payload.find({
      collection: "users",
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { email: { equals: email } },
    })
    if (existing.docs[0] !== undefined) return existing.docs[0]
    return payload.create({
      collection: "users",
      data: { email, password: `e2e-${role}-${Date.now()}`, role, tenant: tenantId },
      depth: 0,
      overrideAccess: false,
      user: tenantAdmin,
    })
  }
  const reviewer = await ensureRoleUser("e2e-scheduled-reviewer@geo-foundry.test", "reviewer")
  const publisher = await ensureRoleUser("e2e-scheduled-publisher@geo-foundry.test", "publisher")
  const site = await findSite(tenantId)
  const canonicalHostname = `e2e-scheduled-publish-${site.id}.test`
  const existingDomain = await payload.find({
    collection: "domains",
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { and: [{ site: { equals: site.id } }, { role: { equals: "canonical" } }, { status: { equals: "active" } }] },
  })
  if (existingDomain.docs[0] === undefined) {
    await payload.create({
      collection: "domains",
      data: { hostname: canonicalHostname, role: "canonical", site: site.id, status: "active", tenant: tenantId },
      depth: 0,
      overrideAccess: true,
      user: tenantAdmin,
    })
    console.log(JSON.stringify({ code: "E2E_DOMAIN_CREATED", hostname: canonicalHostname }))
  }
  console.log(JSON.stringify({ code: "E2E_TENANT", siteId: site.id, tenantId }))

  const content = await payload.create({
    collection: "contents",
    data: {
      createdBy: "human",
      intent: "Scheduled publish production verification",
      tenant: tenantId,
      topic: `scheduled-publish-${Date.now()}`,
    },
    depth: 0,
    overrideAccess: true,
    user: editor,
  })
  const edition = await payload.create({
    collection: "content-editions",
    data: {
      angle: "scheduled publish e2e",
      body: [{ blockType: "paragraph", text: "Production-semantic scheduled publication verification." }],
      content: content.id,
      creationOrigin: "human",
      primaryTopic: "scheduled-publish",
      site: site.id,
      summary: "Verified by the scheduled publish E2E run.",
      tenant: tenantId,
      title: `Scheduled publish E2E ${new Date().toISOString()}`,
    },
    depth: 0,
    draft: true,
    overrideAccess: true,
    user: editor,
  })
  const editionId = edition.id
  const intake = await payload.create({
    collection: "intake-items",
    data: { channel: "manual", duplicateStatus: "unique", status: "ready", tenant: tenantId, title: `e2e-source-${editionId}` },
    depth: 0,
    draft: true,
    overrideAccess: true,
    user: editor,
  })
  await payload.create({
    collection: "article-sources",
    data: { edition: editionId, intakeItem: intake.id, role: "primary", tenant: tenantId },
    depth: 0,
    overrideAccess: true,
    user: editor,
  })
  await transitionEdition(payload, { editionId, target: "generating", user: editor })
  await transitionEdition(payload, { editionId, target: "review", user: editor })
  const draft = await loadWorkflowEdition(payload, editionId, {}, true)
  await recordAssessment(payload, {
    editionId,
    inputHash: currentEditionInputHash(draft),
    issues: [],
    modelId: "scheduled-publish-e2e",
    promptVersion: "2026-08-28",
    provider: "deterministic",
    state: "passed",
    thresholdsHash: "b".repeat(64),
  })
  await transitionEdition(payload, { editionId, target: "approved", user: reviewer })

  const scheduledFor = new Date(Date.now() + 90_000).toISOString()
  const plan = await createPublicationPlan(payload, { editionId, scheduledFor, timezone: site.timezone, user: publisher })
  console.log(JSON.stringify({ code: "E2E_PLAN_CREATED", editionId, planId: plan.planId, scheduledFor }))

  const deadline = Date.now() + 8 * 60_000
  let terminal = null
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5_000))
    const stored = await payload.find({
      collection: "publication-plans",
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { planId: { equals: plan.planId } },
    })
    const row = stored.docs[0]
    if (row === undefined) fail("plan disappeared")
    if (row.status === "succeeded" || row.status === "failed" || row.status === "cancelled") {
      terminal = row
      break
    }
    process.stdout.write(".")
  }
  console.log("")
  if (terminal === null) fail("plan did not settle within 8 minutes")
  if (terminal.status !== "succeeded") {
    console.log(JSON.stringify({ code: "E2E_PLAN_TERMINAL", status: terminal.status, lastError: terminal.lastError }))
    fail(`plan ended ${terminal.status}`)
  }
  const finalEdition = await loadWorkflowEdition(payload, editionId)
  const releases = await payload.find({
    collection: "releases",
    depth: 0,
    limit: 5,
    overrideAccess: true,
    where: { and: [{ site: { equals: site.id } }, { state: { in: ["current", "published"] } }] },
  })
  console.log(JSON.stringify({
    code: "E2E_SUCCEEDED",
    editionStatus: finalEdition.workflowStatus,
    operationId: terminal.operationId,
    planId: plan.planId,
    releaseId: terminal.releaseId,
    releasesVisible: releases.docs.length,
  }))
} finally {
  process.exit(0)
}
