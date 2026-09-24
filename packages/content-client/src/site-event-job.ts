import { createHash, createHmac } from "node:crypto"
import { z } from "zod"

/**
 * 站点事件（发布 webhook）任务契约（pg-boss 队列 site-events，CMS 入队端
 * 与 worker 投递端共用，两端只允许以本文件为唯一真源——operation-job.ts
 * 2026-09-09 事故的同一教训）。
 *
 * 事件类型：
 *   published   — 站点从"无已发布 release"首次进入有发布 release；
 *   updated     — 站点已有发布 release，当前 release 变了（重发布或回滚）；
 *   unpublished — 站点发布状态被移除（A4 "撤下站点"语义；B3 先立类型与
 *                 投递链，CMS 侧挂点随 A4 落）。
 *
 * eventId 由 (siteId, releaseId, eventType) 确定性推导：同一事件重放得到
 * 同一 id，pg-boss singletonKey 与 CMS 投递台账 upsert 都据此幂等。
 *
 * 签名：HMAC-SHA256(原始请求体, 站点 webhook 密钥)，头
 * X-Geo-Foundry-Signature: sha256=<hex>；X-Geo-Foundry-Event-Id 带 eventId
 * 供消费方去重。请求体由 siteEventBodyOf 固定键序构造，序列化字节即签名
 * 字节。
 */

export const siteEventTypeSchema = z.enum(["published", "updated", "unpublished"])

export type SiteEventType = z.infer<typeof siteEventTypeSchema>

export const SITE_EVENT_SIGNATURE_HEADER = "x-geo-foundry-signature"
export const SITE_EVENT_ID_HEADER = "x-geo-foundry-event-id"

export const siteEventJobDataSchema = z
  .object({
    eventId: z.string().min(1),
    eventType: siteEventTypeSchema,
    hostname: z.string().min(1).nullable(),
    manifestSha256: z.string().min(1).nullable(),
    occurredAt: z.string().min(1),
    releaseId: z.string().min(1).nullable(),
    siteId: z.number().int().positive(),
    tenantId: z.number().int().positive(),
    webhookSecretReference: z.string().min(1),
    webhookUrl: z.string().min(1),
  })
  .strict()

export type SiteEventJobData = z.input<typeof siteEventJobDataSchema>

/** eventId 确定性推导：evt-<sha256("siteId|releaseId|eventType") 前 24 位 hex>。 */
export const siteEventIdOf = (input: {
  eventType: SiteEventType
  releaseId: string | null
  siteId: number
}): string =>
  `evt-${createHash("sha256")
    .update(`${input.siteId}|${input.releaseId ?? ""}|${input.eventType}`)
    .digest("hex")
    .slice(0, 24)}`

/** 任务数据唯一构造入口：CMS 入队端用它产出 pg-boss send 的对象。 */
export const siteEventJobDataOf = (input: {
  eventType: SiteEventType
  hostname: string | null
  manifestSha256: string | null
  occurredAt: string
  releaseId: string | null
  secretReference: string
  siteId: number
  tenantId: number
  webhookUrl: string
}): SiteEventJobData => ({
  eventId: siteEventIdOf({
    eventType: input.eventType,
    releaseId: input.releaseId,
    siteId: input.siteId,
  }),
  eventType: input.eventType,
  hostname: input.hostname,
  manifestSha256: input.manifestSha256,
  occurredAt: input.occurredAt,
  releaseId: input.releaseId,
  siteId: input.siteId,
  tenantId: input.tenantId,
  webhookSecretReference: input.secretReference,
  webhookUrl: input.webhookUrl,
})

export type SiteEventJobIssue = Readonly<{
  message: string
  path: readonly PropertyKey[]
}>

export type SiteEventJobParse =
  | { readonly data: SiteEventJobData; readonly success: true }
  | { readonly error: readonly SiteEventJobIssue[]; readonly success: false }

/** 任务数据唯一解析入口：worker 投递端使用。 */
export const parseSiteEventJobData = (data: unknown): SiteEventJobParse => {
  const parsed = siteEventJobDataSchema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.issues, success: false }
  return { data: parsed.data, success: true }
}

export const siteEventIssueText = (issues: readonly SiteEventJobIssue[]): string =>
  issues.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`).join("; ")

/**
 * Webhook 请求体（发往消费方）：键序固定，JSON.stringify 的字节即签名与
 * 投递字节。不含 tenantId/密钥引用/webhookUrl 等内部字段。
 */
export const siteEventBodyOf = (data: SiteEventJobData): Readonly<{
  eventId: string
  eventType: SiteEventType
  hostname: string | null
  manifestSha256: string | null
  occurredAt: string
  releaseId: string | null
  siteId: number
}> => ({
  eventId: data.eventId,
  eventType: data.eventType,
  hostname: data.hostname,
  manifestSha256: data.manifestSha256,
  occurredAt: data.occurredAt,
  releaseId: data.releaseId,
  siteId: data.siteId,
})

/** 签名头值：sha256=<HMAC-SHA256 hex>。 */
export const signSiteEventBody = (secret: string, body: string): string =>
  `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`

/**
 * 消费方验签（E2E 接收端与未来站点侧共用）。签名值本身是随请求公开的
 * 定长 hex（sha256= 前缀 + 64 位），直接比较无时序侧信道问题；本包
 * tsconfig 禁用了 node 全局类型，也不引入 Buffer/timingSafeEqual。
 */
export const verifySiteEventBody = (
  secret: string,
  body: string,
  signatureHeader: string | undefined,
): boolean => {
  if (signatureHeader === undefined) return false
  return signatureHeader === signSiteEventBody(secret, body)
}
