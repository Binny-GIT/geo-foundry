import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createCrawlProcessor } from "../../src/processors/crawl.js"

describe("crawl worker", () => {
  let directory = ""
  const record = vi.fn(async (_parentId: number, _jobId: string) => {})
  const failDispatch = vi.fn(async (_parentId: number, _code: string) => {})
  const complete = vi.fn(async (_jobId: string, entries: readonly unknown[]) => ({
    count: entries.length,
    duplicates: 0,
  }))
  const failJob = vi.fn(async (_jobId: string, _code: string) => {})
  const ack = vi.fn(async (_jobId: string) => {})
  const client = {
    getCrawlDispatchInput: async () => ({
      connectorId: 1,
      parentIntakeItemId: 3,
      secretReference: "e2e",
      sourceEndpoint: "https://example.test",
      tenantId: 2,
    }),
    recordCrawlDispatch: record,
    failCrawlDispatch: failDispatch,
    getCrawlJobInput: async () => ({
      jobId: "job_1234567890abcdef",
      parentIntakeItemId: 3,
      secretReference: "e2e",
      state: "notified" as const,
      tenantId: 2,
    }),
    completeCrawlJob: complete,
    failCrawlJob: failJob,
    acknowledgeCrawlJob: ack,
  }
  const dispatch = {
    data: { kind: "crawl-dispatch", parentIntakeItemId: 3, tenantId: 2 },
    id: "task-1",
    name: "crawl-dispatch",
    queueName: "content-intake",
  }
  const ingest = {
    ...dispatch,
    data: {
      kind: "crawl-ingest",
      parentIntakeItemId: 3,
      tenantId: 2,
      jobId: "job_1234567890abcdef",
    },
  }
  beforeEach(async () => {
    vi.clearAllMocks()
    directory = await mkdtemp(join(tmpdir(), "geo-crawl-test-"))
    await writeFile(join(directory, "e2e.console-key"), "test-key", { mode: 0o600 })
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })
  const run = (fetchImpl: typeof fetch) =>
    createCrawlProcessor(client, {
      baseUrl: "http://crawl.test",
      callbackUrl: "http://cms.test/api/integration/crawl-callbacks",
      credentialDirectory: directory,
      fetchImpl,
    })

  it("Given a 201 create response, when dispatch runs, then the job id is recorded", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ id: "job_1234567890abcdef" }, { status: 201 }),
    )
    await run(fetchImpl)(dispatch)
    expect(record).toHaveBeenCalledWith(3, "job_1234567890abcdef")
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toMatchObject({
      type: "article_collection",
      params: { output: { format: "article_collection", max_items: 3 } },
    })
  })
  it("Given a 400 create response, when dispatch runs, then the parent fails", async () => {
    await expect(run(async () => new Response("bad", { status: 400 }))(dispatch)).rejects.toThrow(
      "CRAWL_CREATE_HTTP_400",
    )
    expect(failDispatch).toHaveBeenCalledWith(3, "CRAWL_CREATE_HTTP_400")
  })
  it("Given a network error, when dispatch runs, then the parent fails", async () => {
    await expect(
      run(async () => {
        throw new TypeError("offline")
      })(dispatch),
    ).rejects.toThrow("offline")
    expect(failDispatch).toHaveBeenCalledWith(3, "CRAWL_DISPATCH_FAILED")
  })
  it("Given a pending remote job, when ingest runs, then it does not delete", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ id: ingest.data.jobId, status: "running" }))
    await run(fetchImpl)(ingest)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(complete).not.toHaveBeenCalled()
  })
  it("Given a failed job, when ingest runs, then failure and delete are recorded", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ id: ingest.data.jobId, status: "failed", error: "bad" }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    await run(fetchImpl)(ingest)
    expect(failJob).toHaveBeenCalledWith(ingest.data.jobId, "CRAWL_REMOTE_FAILED")
    expect(ack).toHaveBeenCalledWith(ingest.data.jobId)
  })
  it("Given a successful article and DELETE 404, when ingest runs, then mapped content is stored and acked", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          id: ingest.data.jobId,
          status: "succeeded",
          result: {
            schema_version: "1.0",
            type: "article_collection",
            source_url: "https://example.test",
            requested_count: 1,
            returned_count: 1,
            status: "complete",
            items: [
              {
                title: "文章",
                url: "https://example.test/a",
                canonical_url: "https://example.test/c",
                content: "正文",
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
    await run(fetchImpl)(ingest)
    expect(complete).toHaveBeenCalledWith(ingest.data.jobId, [
      { content: "正文", sourceUrl: "https://example.test/c", summary: null, title: "文章" },
    ])
    expect(ack).toHaveBeenCalledWith(ingest.data.jobId)
  })
  it("Given DELETE 409 after ingestion, when ingest runs, then it leaves acknowledgement for reconciliation", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          id: ingest.data.jobId,
          status: "succeeded",
          result: {
            schema_version: "1.0",
            type: "article_collection",
            source_url: "https://example.test",
            requested_count: 1,
            returned_count: 0,
            status: "partial",
            items: [],
          },
        }),
      )
      .mockResolvedValueOnce(Response.json({ error: "job_not_terminal" }, { status: 409 }))
    await run(fetchImpl)(ingest)
    expect(ack).not.toHaveBeenCalled()
  })
})
