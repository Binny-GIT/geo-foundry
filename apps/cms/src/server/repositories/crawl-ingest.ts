import { createHash } from "node:crypto"
import { and, eq, or } from "drizzle-orm"

import { markdownToBlocks } from "../../editor/block-markdown"
import { validateEditionBody } from "../../editor/validate-body"
import { IntakeError, normalizeIntakeUrl } from "../../services/intake"
import type { ServerDb } from "../db/client"
import { connectors, crawlJobs } from "../db/entity-schema"
import { intakeItems } from "../db/session-schema"
import { crawlTenantOf } from "./crawl-dispatch"

export type CrawlEntry = Readonly<{
  title: string
  sourceUrl: string
  summary: string | null
  content: string
}>

export const crawlJobInput = async (db: ServerDb, jobId: string, user: unknown) => {
  const tenantId = crawlTenantOf(user)
  const [row] = await db
    .select({ job: crawlJobs, secretReference: connectors.secretReference })
    .from(crawlJobs)
    .innerJoin(connectors, eq(connectors.id, crawlJobs.connectorId))
    .where(and(eq(crawlJobs.jobId, jobId), eq(crawlJobs.tenantId, tenantId)))
    .limit(1)
  if (row === undefined || row.secretReference === null)
    throw new IntakeError("INTAKE_ITEM_NOT_FOUND")
  if (row.job.state === "dispatched" || row.job.state === "notified") {
    await db
      .update(crawlJobs)
      .set({ state: "ingesting", updatedAt: new Date() })
      .where(eq(crawlJobs.id, row.job.id))
  }
  return {
    jobId,
    parentIntakeItemId: row.job.parentIntakeItemId,
    secretReference: row.secretReference,
    state:
      row.job.state === "dispatched" || row.job.state === "notified"
        ? ("ingesting" as const)
        : row.job.state,
    tenantId,
  }
}

export const completeCrawlIngest = async (
  db: ServerDb,
  jobId: string,
  entries: readonly CrawlEntry[],
  user: unknown,
): Promise<{ count: number; duplicates: number }> => {
  const tenantId = crawlTenantOf(user)
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(crawlJobs)
      .where(and(eq(crawlJobs.jobId, jobId), eq(crawlJobs.tenantId, tenantId)))
      .for("update")
    if (job === undefined) throw new IntakeError("INTAKE_ITEM_NOT_FOUND")
    if (job.state === "ingested") return { count: 0, duplicates: 0 }
    if (job.state === "failed") throw new IntakeError("INTAKE_FETCH_STATE_INVALID")
    let duplicates = 0
    for (const entry of entries) {
      const content = entry.content.trim().replace(/\r\n/g, "\n")
      const blocks = markdownToBlocks(content)
      if (validateEditionBody(blocks) !== true) throw new IntakeError("INTAKE_BODY_BLOCKS_INVALID")
      const normalizedUrl = normalizeIntakeUrl(entry.sourceUrl)
      if (normalizedUrl === undefined) throw new IntakeError("INTAKE_SOURCE_URL_REQUIRED")
      const contentHash = createHash("sha256").update(content).digest("hex")
      const [existing] = await tx
        .select({ id: intakeItems.id })
        .from(intakeItems)
        .where(
          and(
            eq(intakeItems.tenantId, tenantId),
            or(
              eq(intakeItems.normalizedUrl, normalizedUrl),
              eq(intakeItems.contentHash, contentHash),
            ),
          ),
        )
        .limit(1)
      if (existing !== undefined) duplicates += 1
      const [parent] = await tx
        .select({ suggestedSiteId: intakeItems.suggestedSiteId })
        .from(intakeItems)
        .where(eq(intakeItems.id, job.parentIntakeItemId))
        .limit(1)
      await tx.insert(intakeItems).values({
        channel: "crawl",
        connectorId: job.connectorId,
        tenantId,
        suggestedSiteId: parent?.suggestedSiteId ?? null,
        title: entry.title,
        sourceUrl: entry.sourceUrl,
        normalizedUrl,
        summary: entry.summary,
        contentBlocks: blocks,
        contentHash,
        duplicateOfId: existing?.id ?? null,
        duplicateStatus: existing === undefined ? "unique" : "duplicate",
        status: existing === undefined ? "ready" : "duplicate",
      })
    }
    await tx
      .update(crawlJobs)
      .set({ state: "ingested", ingestedAt: new Date(), updatedAt: new Date() })
      .where(eq(crawlJobs.id, job.id))
    await tx
      .update(intakeItems)
      .set({
        status: "ready",
        summary: `${entries.length} 篇文章，${duplicates} 篇重复。`,
        updatedAt: new Date(),
      })
      .where(eq(intakeItems.id, job.parentIntakeItemId))
    return { count: entries.length, duplicates }
  })
}

export const failCrawlIngest = async (
  db: ServerDb,
  jobId: string,
  code: string,
  user: unknown,
): Promise<void> => {
  const tenantId = crawlTenantOf(user)
  await db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(crawlJobs)
      .where(and(eq(crawlJobs.jobId, jobId), eq(crawlJobs.tenantId, tenantId)))
      .for("update")
    if (job === undefined) throw new IntakeError("INTAKE_ITEM_NOT_FOUND")
    if (job.state === "ingested") return
    await tx
      .update(crawlJobs)
      .set({
        state: "failed",
        crawlStatus: "failed",
        lastError: code.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(crawlJobs.id, job.id))
    await tx
      .update(intakeItems)
      .set({ status: "failed", failureCode: code.slice(0, 120), updatedAt: new Date() })
      .where(eq(intakeItems.id, job.parentIntakeItemId))
  })
}

export const acknowledgeCrawlJob = async (
  db: ServerDb,
  jobId: string,
  user: unknown,
): Promise<void> => {
  const tenantId = crawlTenantOf(user)
  await db
    .update(crawlJobs)
    .set({ ackedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(crawlJobs.jobId, jobId), eq(crawlJobs.tenantId, tenantId)))
}
