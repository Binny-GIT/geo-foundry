import {
  type ContentServiceClient,
  crawlEntryOf,
  crawlEntrySchema,
  crawlRemoteJobSchema,
} from "@geo/content-client"
import { z } from "zod"

import { readWorkerCredentialFile } from "../config/credentials.js"
import type { WorkJob } from "./types.js"

const dispatchSchema = z.object({
  kind: z.literal("crawl-dispatch"),
  parentIntakeItemId: z.number().int().positive(),
  tenantId: z.number().int().positive(),
})
const ingestSchema = z.object({
  kind: z.literal("crawl-ingest"),
  jobId: z.string().regex(/^job_[0-9a-f]{16}$/),
  parentIntakeItemId: z.number().int().positive(),
  tenantId: z.number().int().positive(),
})

export class CrawlRemoteError extends Error {
  override readonly name = "CrawlRemoteError"
  constructor(readonly code: string) {
    super(code)
  }
}

export type CrawlOptions = Readonly<{
  baseUrl: string
  callbackUrl: string
  credentialDirectory: string | undefined
  fetchImpl?: typeof fetch
}>

export const createCrawlProcessor =
  (
    client: Pick<
      ContentServiceClient,
      | "getCrawlDispatchInput"
      | "recordCrawlDispatch"
      | "failCrawlDispatch"
      | "getCrawlJobInput"
      | "completeCrawlJob"
      | "failCrawlJob"
      | "acknowledgeCrawlJob"
    >,
    options: CrawlOptions,
  ) =>
  async (job: WorkJob<unknown>): Promise<void> => {
    const dispatch = dispatchSchema.safeParse(job.data)
    if (dispatch.success) {
      const { parentIntakeItemId, tenantId } = dispatch.data
      const input = await client.getCrawlDispatchInput(parentIntakeItemId)
      if (input.tenantId !== tenantId) throw new CrawlRemoteError("CRAWL_TENANT_MISMATCH")
      try {
        if (options.credentialDirectory === undefined)
          throw new CrawlRemoteError("CRAWL_CREDENTIALS_MISSING")
        const key = readWorkerCredentialFile(
          "GEO_FOUNDRY_CRAWL_CREDENTIALS_DIR",
          `${options.credentialDirectory}/${input.secretReference}.console-key`,
        )
        const response = await (options.fetchImpl ?? fetch)(`${options.baseUrl}/api/jobs`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": key },
          body: JSON.stringify({
            type: "article_collection",
            target: input.sourceEndpoint,
            params: {
              output: { format: "article_collection", max_items: 3 },
              instruction: "Select the most important content on this page.",
              callback: { url: options.callbackUrl, secretRef: input.secretReference },
            },
          }),
          signal: AbortSignal.timeout(10_000),
        })
        if (response.status !== 201)
          throw new CrawlRemoteError(`CRAWL_CREATE_HTTP_${response.status}`)
        const remote = z
          .object({ id: z.string().regex(/^job_[0-9a-f]{16}$/) })
          .safeParse(await response.json())
        if (!remote.success) throw new CrawlRemoteError("CRAWL_CREATE_RESPONSE_INVALID")
        await client.recordCrawlDispatch(parentIntakeItemId, remote.data.id)
      } catch (error) {
        const code = error instanceof CrawlRemoteError ? error.code : "CRAWL_DISPATCH_FAILED"
        await client.failCrawlDispatch(parentIntakeItemId, code)
        throw error
      }
      return
    }
    const parsed = ingestSchema.safeParse(job.data)
    if (!parsed.success) throw new CrawlRemoteError("CRAWL_JOB_INVALID")
    const { jobId, tenantId } = parsed.data
    const input = await client.getCrawlJobInput(jobId)
    if (input.tenantId !== tenantId) throw new CrawlRemoteError("CRAWL_TENANT_MISMATCH")
    if (input.parentIntakeItemId !== parsed.data.parentIntakeItemId)
      throw new CrawlRemoteError("CRAWL_PARENT_MISMATCH")
    if (options.credentialDirectory === undefined)
      throw new CrawlRemoteError("CRAWL_CREDENTIALS_MISSING")
    const key = readWorkerCredentialFile(
      "GEO_FOUNDRY_CRAWL_CREDENTIALS_DIR",
      `${options.credentialDirectory}/${input.secretReference}.console-key`,
    )
    const fetchImpl = options.fetchImpl ?? fetch
    if (input.state !== "ingested" && input.state !== "failed") {
      const response = await fetchImpl(`${options.baseUrl}/api/jobs/${encodeURIComponent(jobId)}`, {
        headers: { "x-api-key": key },
        signal: AbortSignal.timeout(10_000),
      })
      if (response.status === 404) {
        await client.failCrawlJob(jobId, "CRAWL_JOB_NOT_FOUND")
      } else {
        if (!response.ok) throw new CrawlRemoteError(`CRAWL_GET_HTTP_${response.status}`)
        const result = crawlRemoteJobSchema.safeParse(await response.json())
        if (!result.success || result.data.id !== jobId)
          throw new CrawlRemoteError("CRAWL_RESULT_INVALID")
        switch (result.data.status) {
          case "pending":
          case "leased":
          case "running":
            return
          case "failed":
            await client.failCrawlJob(jobId, "CRAWL_REMOTE_FAILED")
            break
          case "succeeded":
            if (result.data.result == null) throw new CrawlRemoteError("CRAWL_RESULT_INVALID")
            // crawl 对超长正文只打标记不截断：越界的单篇丢弃，不让整批落库失败
            await client.completeCrawlJob(
              jobId,
              result.data.result.items
                .map(crawlEntryOf)
                .filter((entry) => crawlEntrySchema.safeParse(entry).success),
            )
            break
          default: {
            const neverStatus: never = result.data.status
            throw new CrawlRemoteError(`CRAWL_STATUS_INVALID:${neverStatus}`)
          }
        }
      }
    }
    const removed = await fetchImpl(`${options.baseUrl}/api/jobs/${encodeURIComponent(jobId)}`, {
      method: "DELETE",
      headers: { "x-api-key": key },
      signal: AbortSignal.timeout(10_000),
    })
    if (removed.status === 409) return
    if (removed.status !== 204 && removed.status !== 404)
      throw new CrawlRemoteError(`CRAWL_DELETE_HTTP_${removed.status}`)
    await client.acknowledgeCrawlJob(jobId)
  }
