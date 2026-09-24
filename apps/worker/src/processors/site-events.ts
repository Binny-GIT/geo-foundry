/*
 * B3 站点事件投递：CMS 在 release 登记同事务入队的 webhook 任务。
 *
 * 重试语义沿用 intake 惯例：进程内 3 次、2s/4s 指数退避；耗尽后把结果
 * 回报 CMS 投递台账（state='failed' 即死信行）并正常返回——事件台账是
 * 唯一事实源，pg-boss 只做兜底。回报本身失败才抛错让 pg-boss 重试
 * （消费方按 eventId 去重，重复投递安全）。
 */

import {
  type SiteEventJobData,
  SITE_EVENT_ID_HEADER,
  SITE_EVENT_SIGNATURE_HEADER,
  parseSiteEventJobData,
  signSiteEventBody,
  siteEventBodyOf,
  siteEventIssueText,
} from "@geo/content-client"
import type { ContentServiceClient } from "@geo/content-client"

import { readWorkerCredentialFile, WorkerCredentialError } from "../config/credentials.js"
import type { WorkJob, WorkerLogger } from "./types.js"

const MAX_ATTEMPTS = 3
const REQUEST_TIMEOUT_MS = 10_000
const backoffMsOf = (attempt: number): number => 2_000 * 2 ** (attempt - 1)
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export type SiteEventProcessorOptions = {
  /** webhook 密钥所在目录（GEO_FOUNDRY_SITE_WEBHOOK_CREDENTIALS_DIR）。 */
  readonly credentialDirectory: string | undefined
  readonly fetchImpl?: typeof fetch
}

const truncateError = (value: string): string => value.slice(0, 500)

export const createSiteEventProcessor = (
  client: Pick<ContentServiceClient, "recordSiteEventDelivery">,
  logger: WorkerLogger,
  options: SiteEventProcessorOptions,
) =>
  async (job: WorkJob<Record<string, unknown>>): Promise<Record<string, unknown>> => {
    const parsed = parseSiteEventJobData(job.data)
    if (!parsed.success) {
      // 毒丸任务：重试必然同样失败，落日志后直接结束（不入台账，无事件可记）。
      logger({
        code: "worker.site-event.payload-invalid",
        detail: { reason: siteEventIssueText(parsed.error) },
        jobId: job.id,
        queue: job.queueName,
      })
      return { eventId: null, state: "poison" }
    }
    const event = parsed.data
    const queue = job.queueName

    const report = async (
      outcome: { error: string | null; lastStatusCode: number | null; ok: boolean },
      attemptCount: number,
    ): Promise<void> => {
      await client.recordSiteEventDelivery({
        attemptCount,
        error: outcome.error,
        eventType: event.eventType,
        eventId: event.eventId,
        hostname: event.hostname,
        lastStatusCode: outcome.lastStatusCode,
        releaseId: event.releaseId,
        siteId: event.siteId,
        state: outcome.ok ? "delivered" : "failed",
        tenantId: event.tenantId,
        webhookUrl: event.webhookUrl,
      })
    }

    if (options.credentialDirectory === undefined) {
      const reason = "SITE_WEBHOOK_CREDENTIALS_DIR_MISSING"
      logger({ code: "worker.site-event.config-missing", detail: { reason }, jobId: job.id, queue })
      await report({ error: reason, lastStatusCode: null, ok: false }, 0)
      return { eventId: event.eventId, state: "failed" }
    }
    // 密钥引用名只允许文件名安全字符，防止引用值被写进路径穿越。
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(event.webhookSecretReference)) {
      const reason = "SITE_WEBHOOK_SECRET_REFERENCE_INVALID"
      logger({ code: "worker.site-event.config-missing", detail: { reason }, jobId: job.id, queue })
      await report({ error: reason, lastStatusCode: null, ok: false }, 0)
      return { eventId: event.eventId, state: "failed" }
    }

    let secret: string
    try {
      secret = readWorkerCredentialFile(
        "GEO_FOUNDRY_SITE_WEBHOOK_SECRET",
        `${options.credentialDirectory}/${event.webhookSecretReference}`,
      )
    } catch (error) {
      const reason =
        error instanceof WorkerCredentialError ? error.code : "SITE_WEBHOOK_SECRET_UNREADABLE"
      logger({ code: "worker.site-event.secret-unreadable", detail: { reason }, jobId: job.id, queue })
      await report({ error: truncateError(reason), lastStatusCode: null, ok: false }, 0)
      return { eventId: event.eventId, state: "failed" }
    }

    const body = JSON.stringify(siteEventBodyOf(event))
    const fetchImpl = options.fetchImpl ?? fetch
    let attemptsUsed = 0
    let outcome: { error: string | null; lastStatusCode: number | null; ok: boolean } = {
      error: null,
      lastStatusCode: null,
      ok: false,
    }
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      attemptsUsed = attempt
      try {
        const response = await fetchImpl(event.webhookUrl, {
          body,
          headers: {
            "content-type": "application/json",
            [SITE_EVENT_ID_HEADER]: event.eventId,
            [SITE_EVENT_SIGNATURE_HEADER]: signSiteEventBody(secret, body),
          },
          method: "POST",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
        outcome = {
          error: response.ok ? null : `HTTP_${response.status}`,
          lastStatusCode: response.status,
          ok: response.ok,
        }
        if (response.ok) break
      } catch (error) {
        outcome = {
          error: truncateError(error instanceof Error ? error.message : String(error)),
          lastStatusCode: null,
          ok: false,
        }
      }
      if (attempt < MAX_ATTEMPTS) await sleep(backoffMsOf(attempt))
    }

    // 回报 CMS 失败则抛错：pg-boss 兜底重试，消费方按 eventId 去重。
    await report(outcome, attemptsUsed)
    logger({
      code: outcome.ok ? "worker.site-event.delivered" : "worker.site-event.dead-lettered",
      detail: {
        eventId: event.eventId,
        eventType: event.eventType,
        siteId: event.siteId,
        ...(outcome.lastStatusCode === null ? {} : { status: outcome.lastStatusCode }),
      },
      jobId: job.id,
      queue,
    })
    return {
      eventId: event.eventId,
      state: outcome.ok ? "delivered" : "failed",
    }
  }

export type { SiteEventJobData }
