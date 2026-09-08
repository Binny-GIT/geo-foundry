import { TextDecoder, TextEncoder } from "node:util"

import { ContentClientError, type ContentServiceClient } from "@geo/content-client"
import { extractRssEntries, extractStructuredArticle } from "../intake/extract.js"
import { fetchPublicUrl, IntakeFetchError } from "../intake/safe-fetch.js"
import type { StoredSnapshot } from "../intake/snapshot-store.js"
import type { WorkJob, WorkerLogger } from "./types.js"

export type IntakeJobData = Readonly<{
  intakeItemId: number
  tenantId: number
}>

type IntakeClient = Pick<
  ContentServiceClient,
  | "claimIntakeFetch"
  | "completeIntakeFetch"
  | "createRssEntries"
  | "failIntakeFetch"
  | "getIntakeFetchInput"
>

type SnapshotStore = Readonly<{
  put: (input: {
    readonly body: Uint8Array
    readonly contentType: string
    readonly intakeItemId: number
    readonly kind: "extracted-content" | "raw-response"
    readonly tenantId: number
  }) => Promise<StoredSnapshot>
}>

type IntakeEnqueuer = (job: IntakeJobData) => Promise<void>

const permanentCodeOf = (error: unknown): string | null => {
  if (error instanceof IntakeFetchError && !error.retryable) return error.code
  if (error instanceof Error && /^INTAKE_(EXTRACTION_EMPTY|RSS_EMPTY|RSS_INVALID)$/.test(error.message)) {
    return error.message
  }
  return null
}

const messageOf = (error: unknown): string =>
  String(error instanceof Error ? error.message : error).slice(0, 500)

const decodedText = (body: Uint8Array): string => new TextDecoder("utf-8", { fatal: false }).decode(body)

const isXml = (contentType: string): boolean =>
  contentType === "application/rss+xml" ||
  contentType === "application/atom+xml" ||
  contentType === "application/xml" ||
  contentType === "text/xml"

const isHtml = (contentType: string): boolean => contentType === "text/html" || contentType === "application/xhtml+xml"

const isText = (contentType: string): boolean => contentType === "text/plain"

const assertion = (value: unknown): value is IntakeJobData => {
  if (typeof value !== "object" || value === null) return false
  const row = value as Record<string, unknown>
  return (
    typeof row["intakeItemId"] === "number" &&
    Number.isInteger(row["intakeItemId"]) &&
    row["intakeItemId"] > 0 &&
    typeof row["tenantId"] === "number" &&
    Number.isInteger(row["tenantId"]) &&
    row["tenantId"] > 0
  )
}

/**
 * Fetches source material outside the control plane, stores raw/extracted bytes
 * immutably, then asks CMS to persist tenant-checked metadata.
 */
export type IntakeProcessorOptions = {
  readonly client: IntakeClient
  readonly enqueue: IntakeEnqueuer
  readonly logger: WorkerLogger
  readonly snapshots: SnapshotStore
}

export const createIntakeProcessor = (options: IntakeProcessorOptions) =>
  async (job: WorkJob<IntakeJobData>): Promise<{ readonly intakeItemId: number; readonly state: string }> => {
    if (!assertion(job.data)) throw new IntakeFetchError("INTAKE_JOB_INVALID", false)
    // 与旧 BullMQ attempts:3 + 指数退避等价的进程内重试；重试耗尽把父稿标记 failed。
    const MAX_ATTEMPTS = 3
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const outcome = await runOnce(job, attempt, MAX_ATTEMPTS, options)
      if (outcome !== null) return outcome
    }
    return { intakeItemId: job.data.intakeItemId, state: "failed" }
  }

const runOnce = async (
  job: WorkJob<IntakeJobData>,
  attempt: number,
  maxAttempts: number,
  options: IntakeProcessorOptions,
): Promise<{ readonly intakeItemId: number; readonly state: string } | null> => {
    const { client, enqueue, logger, snapshots } = options
    const log = (code: string, detail?: Record<string, unknown>) =>
      logger({
        code,
        ...(detail === undefined ? {} : { detail }),
        jobId: job.id ?? null,
        queue: job.queueName,
      })
    try {
      await client.claimIntakeFetch(job.data.intakeItemId)
      const input = await client.getIntakeFetchInput(job.data.intakeItemId)
      if (input.tenantId !== job.data.tenantId) throw new IntakeFetchError("INTAKE_JOB_TENANT_MISMATCH", false)
      log("worker.intake.started", { channel: input.channel, intakeItemId: input.intakeItemId })
      const response = await fetchPublicUrl(input.sourceUrl)
      const raw = await snapshots.put({
        body: response.body,
        contentType: response.contentType,
        intakeItemId: input.intakeItemId,
        kind: "raw-response",
        tenantId: input.tenantId,
      })
      const sourceText = decodedText(response.body)
      if (input.channel === "rss") {
        if (!isXml(response.contentType)) throw new IntakeFetchError("INTAKE_CONTENT_TYPE_UNSUPPORTED", false)
        const entries = extractRssEntries(sourceText)
        const intakeItemIds = await client.createRssEntries(input.intakeItemId, {
          entries: entries.map((entry) => ({
            sourceUrl: entry.sourceUrl,
            ...(entry.summary === undefined ? {} : { summary: entry.summary }),
            title: entry.title,
          })),
        })
        await Promise.all(
          intakeItemIds.map(async (intakeItemId: number) => enqueue({ intakeItemId, tenantId: input.tenantId })),
        )
        const extractedBody = new TextEncoder().encode(entries.map((entry) => `${entry.title}\n${entry.sourceUrl}`).join("\n\n"))
        const extracted = await snapshots.put({
          body: extractedBody,
          contentType: "text/plain; charset=utf-8",
          intakeItemId: input.intakeItemId,
          kind: "extracted-content",
          tenantId: input.tenantId,
        })
        await client.completeIntakeFetch(input.intakeItemId, {
          extracted,
          raw,
          summary: `${intakeItemIds.length} URL intake items created from RSS feed.`,
          title: `RSS feed: ${new URL(response.finalUrl).hostname}`,
        })
        log("worker.intake.completed", { intakeItemId: input.intakeItemId, rssEntries: intakeItemIds.length })
        return { intakeItemId: input.intakeItemId, state: "ready" }
      }
      if (!isHtml(response.contentType) && !isText(response.contentType)) {
        throw new IntakeFetchError("INTAKE_CONTENT_TYPE_UNSUPPORTED", false)
      }
      const article = isHtml(response.contentType)
        ? extractStructuredArticle(sourceText, response.finalUrl)
        : { blocks: [], summary: sourceText.slice(0, 500), text: sourceText.trim(), title: sourceText.trim().slice(0, 160) }
      if (article.text.length === 0 || article.title.length === 0) throw new IntakeFetchError("INTAKE_EXTRACTION_EMPTY", false)
      const extracted = await snapshots.put({
        body: new TextEncoder().encode(article.text),
        contentType: "text/plain; charset=utf-8",
        intakeItemId: input.intakeItemId,
        kind: "extracted-content",
        tenantId: input.tenantId,
      })
      await client.completeIntakeFetch(input.intakeItemId, {
        ...(article.blocks.length === 0 ? {} : { contentBlocks: article.blocks.map(block => ({ ...block })) }),
        extracted,
        raw,
        summary: article.summary,
        title: article.title,
      })
      log("worker.intake.completed", { intakeItemId: input.intakeItemId })
      return { intakeItemId: input.intakeItemId, state: "ready" }
    } catch (error) {
      if (error instanceof ContentClientError && error.code === "INTAKE_FETCH_STATE_INVALID") {
        log("worker.intake.skipped", { intakeItemId: job.data.intakeItemId })
        return { intakeItemId: job.data.intakeItemId, state: "skipped" }
      }
      const permanentCode = permanentCodeOf(error)
      const finalAttempt = attempt >= maxAttempts
      if (permanentCode !== null || finalAttempt) {
        const code = permanentCode ?? "INTAKE_FETCH_RETRY_EXHAUSTED"
        await client.failIntakeFetch(job.data.intakeItemId, { code, reason: messageOf(error) })
        log("worker.intake.failed", { code, intakeItemId: job.data.intakeItemId })
        return { intakeItemId: job.data.intakeItemId, state: "failed" }
      }
      log("worker.intake.retryable-failure", { attempt, intakeItemId: job.data.intakeItemId, message: messageOf(error) })
      await new Promise((resolve) => setTimeout(resolve, 2_000 * 2 ** (attempt - 1)))
      return null
    }
  }
