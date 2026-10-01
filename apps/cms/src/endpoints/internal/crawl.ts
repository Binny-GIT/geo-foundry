import type { z } from "zod"

import {
  crawlDispatchInput,
  failCrawlDispatch,
  recordCrawlDispatch,
} from "../../server/repositories/crawl-dispatch"
import {
  acknowledgeCrawlJob,
  completeCrawlIngest,
  crawlJobInput,
  failCrawlIngest,
} from "../../server/repositories/crawl-ingest"
import { serverRuntime } from "../../server/runtime"
import { IntakeError } from "../../services/intake"
import {
  crawlCompleteSchema,
  crawlDispatchRecordSchema,
  crawlFailureSchema,
  crawlJobIdSchema,
} from "./contracts"
import { type InternalRequest, internalJsonResponse, withInternalGuards } from "./guards"

const parentId = (req: InternalRequest): number => {
  const id = Number(req.routeParams["id"])
  if (!Number.isInteger(id) || id <= 0) throw new IntakeError("INTAKE_ITEM_NOT_FOUND")
  return id
}

const jobId = (req: InternalRequest): string => {
  const parsed = crawlJobIdSchema.safeParse(req.routeParams["jobId"])
  if (!parsed.success) throw new IntakeError("INTAKE_ITEM_NOT_FOUND")
  return parsed.data
}

export const crawlHandlerByOperation = {
  getCrawlDispatchInput: withInternalGuards(
    { bodySchema: null, operation: "getCrawlDispatchInput" },
    async (req, ctx) =>
      internalJsonResponse(
        200,
        await crawlDispatchInput(serverRuntime().db, parentId(req), req.user),
        ctx.requestId,
        null,
      ),
  ),
  recordCrawlDispatch: withInternalGuards(
    { bodySchema: crawlDispatchRecordSchema, operation: "recordCrawlDispatch" },
    async (req, ctx, body: z.infer<typeof crawlDispatchRecordSchema>) => {
      await recordCrawlDispatch(serverRuntime().db, parentId(req), body.jobId, req.user)
      return internalJsonResponse(200, { recorded: true }, ctx.requestId, null)
    },
  ),
  failCrawlDispatch: withInternalGuards(
    { bodySchema: crawlFailureSchema, operation: "failCrawlDispatch" },
    async (req, ctx, body: z.infer<typeof crawlFailureSchema>) => {
      await failCrawlDispatch(serverRuntime().db, parentId(req), body.code, req.user)
      return internalJsonResponse(200, { failed: true }, ctx.requestId, null)
    },
  ),
  getCrawlJobInput: withInternalGuards(
    { bodySchema: null, operation: "getCrawlJobInput" },
    async (req, ctx) =>
      internalJsonResponse(
        200,
        await crawlJobInput(serverRuntime().db, jobId(req), req.user),
        ctx.requestId,
        null,
      ),
  ),
  completeCrawlJob: withInternalGuards(
    { bodySchema: crawlCompleteSchema, operation: "completeCrawlJob" },
    async (req, ctx, body: z.infer<typeof crawlCompleteSchema>) =>
      internalJsonResponse(
        200,
        await completeCrawlIngest(serverRuntime().db, jobId(req), body.entries, req.user),
        ctx.requestId,
        null,
      ),
  ),
  failCrawlJob: withInternalGuards(
    { bodySchema: crawlFailureSchema, operation: "failCrawlJob" },
    async (req, ctx, body: z.infer<typeof crawlFailureSchema>) => {
      await failCrawlIngest(serverRuntime().db, jobId(req), body.code, req.user)
      return internalJsonResponse(200, { failed: true }, ctx.requestId, null)
    },
  ),
  ackCrawlJob: withInternalGuards(
    { bodySchema: null, operation: "ackCrawlJob" },
    async (req, ctx) => {
      await acknowledgeCrawlJob(serverRuntime().db, jobId(req), req.user)
      return internalJsonResponse(200, { acknowledged: true }, ctx.requestId, null)
    },
  ),
} satisfies Record<string, ReturnType<typeof withInternalGuards>>
