import { getPayload } from "payload"

import config from "../src/payload.config.ts"
import { createRollbackIntent } from "../src/services/rollback-intent-approval.ts"

const siteId = 375
const waitTimeoutMs = 2 * 60_000

const fail = (code) => {
  throw new Error(code)
}

const payload = await getPayload({ config })
let exitCode = 0
try {
  const publishers = await payload.find({
    collection: "users",
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { email: { equals: "e2e-scheduled-publisher@geo-foundry.test" } },
  })
  const publisher = publishers.docs[0] ?? fail("ROLLBACK_E2E_PUBLISHER_MISSING")

  const releaseRows = async () =>
    payload.find({
      collection: "releases",
      depth: 0,
      limit: 10,
      overrideAccess: true,
      sort: "createdAt",
      where: { site: { equals: siteId } },
    })

  const awaitCurrent = async (releaseId) => {
    const deadline = Date.now() + waitTimeoutMs
    while (Date.now() < deadline) {
      const releases = await releaseRows()
      const current = releases.docs.find((release) => release.state === "current")
      if (current?.releaseId === releaseId) return
      await new Promise((resolve) => setTimeout(resolve, 2_000))
    }
    fail(`ROLLBACK_E2E_TIMEOUT:${releaseId}`)
  }

  const execute = async (source, target, reason) => {
    const approval = await createRollbackIntent(payload, {
      expectedCurrentManifestSha256: source.manifestSha256,
      expectedCurrentReleaseId: source.releaseId,
      expectedManifestSha256: target.manifestSha256,
      reason,
      siteId,
      targetReleaseId: target.releaseId,
      user: publisher,
    })
    await awaitCurrent(target.releaseId)
    const intents = await payload.find({
      collection: "rollback-intents",
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { intentId: { equals: approval.intentId } },
    })
    const intent = intents.docs[0]
    if (intent?.consumedAt === null || intent?.consumedAt === undefined) {
      fail(`ROLLBACK_E2E_INTENT_NOT_CONSUMED:${approval.intentId}`)
    }
    console.log(JSON.stringify({ code: "ROLLBACK_E2E_CONSUMED", intentId: approval.intentId, targetReleaseId: target.releaseId }))
  }

  const before = await releaseRows()
  const current = before.docs.find((release) => release.state === "current")
  const previous = before.docs.find((release) => release.state === "superseded")
  if (current === undefined || previous === undefined) fail("ROLLBACK_E2E_RELEASE_PAIR_MISSING")

  await execute(current, previous, "Verify automatic rollback dispatch")
  await execute(previous, current, "Restore original release after rollback verification")
  console.log(JSON.stringify({ code: "ROLLBACK_E2E_SUCCEEDED", restoredReleaseId: current.releaseId }))
} catch (error) {
  exitCode = 1
  console.error(JSON.stringify({ code: "ROLLBACK_E2E_FAILED", message: String(error) }))
} finally {
  void payload.destroy()
}

process.exit(exitCode)
