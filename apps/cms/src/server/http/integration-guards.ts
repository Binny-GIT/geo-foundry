/*
 * 集成面守卫：对携带 API Key 的机器请求施加限流、请求体上限、幂等键
 * 校验与 x-request-id 回写。Cookie 会话（Console）一律绕过，行为不变。
 *
 * 与 endpoints/internal/guards.ts 的关系：那边服务 Worker 零信任面，规则
 * 更严（强制 x-request-id、service 身份、CORS）；这边服务外部工具投稿，
 * 只挂基础护栏。限流是进程内窗口，与 delivery 限流同一量级的实现——
 * 当前单副本部署下够用，多副本时应上移到网关层。
 */

import { createHash } from "node:crypto"

export const INTEGRATION_ERROR_CODE = {
  BODY_TOO_LARGE: "INTEGRATION_BODY_TOO_LARGE",
  IDEMPOTENCY_KEY_INVALID: "INTEGRATION_IDEMPOTENCY_KEY_INVALID",
  RATE_LIMITED: "INTEGRATION_RATE_LIMITED",
} as const

/** 与 internal 面同一格式契约，方便外部工具复用一套请求模板。 */
export const INTEGRATION_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._-]{8,128}$/

/** 请求 id 只回显不生成：外部工具带了自己的 id 才回写，Console 无感。 */
export const INTEGRATION_REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/

export type IntegrationGuardConfig = {
  readonly maxBodyBytes: number
  readonly rateLimitPerMinute: number
}

const RATE_WINDOW_MS = 60_000

const positiveIntOrDefault = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export const parseIntegrationGuardConfig = (
  env: Record<string, string | undefined>,
): IntegrationGuardConfig => ({
  maxBodyBytes: positiveIntOrDefault(env["CMS_INTEGRATION_MAX_BODY_BYTES"], 1_048_576),
  rateLimitPerMinute: positiveIntOrDefault(env["CMS_INTEGRATION_RATE_LIMIT_PER_MINUTE"], 120),
})

let guardConfig: IntegrationGuardConfig | null = null

export const currentIntegrationGuardConfig = (): IntegrationGuardConfig =>
  (guardConfig ??= parseIntegrationGuardConfig(process.env))

export const configureIntegrationGuardsForTests = (config: IntegrationGuardConfig | null): void => {
  guardConfig = config
  rateWindows.clear()
}

type RateWindow = { count: number; expiresAt: number }

const rateWindows = new Map<string, RateWindow>()

const consumeRateLimit = (key: string, limit: number): boolean => {
  const now = Date.now()
  const window = rateWindows.get(key)
  if (window === undefined || window.expiresAt <= now) {
    rateWindows.set(key, { count: 1, expiresAt: now + RATE_WINDOW_MS })
    return true
  }
  if (window.count >= limit) {
    return false
  }
  window.count += 1
  return true
}

export type IntegrationGuardInput = Readonly<{
  /** 已认证身份的稳定键（API-Key 身份的用户 id）。 */
  readonly actorKey: string
  readonly bodyBytes: number
  readonly idempotencyKey: string | null
}>

/** 全部通过返回 null；任一不通过返回对应 4xx 响应。 */
export const integrationGuardOf = (input: IntegrationGuardInput): Response | null => {
  const config = currentIntegrationGuardConfig()
  if (input.bodyBytes > config.maxBodyBytes) {
    return integrationError(413, INTEGRATION_ERROR_CODE.BODY_TOO_LARGE)
  }
  if (
    input.idempotencyKey !== null &&
    !INTEGRATION_IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)
  ) {
    return integrationError(400, INTEGRATION_ERROR_CODE.IDEMPOTENCY_KEY_INVALID)
  }
  if (!consumeRateLimit(input.actorKey, config.rateLimitPerMinute)) {
    return integrationError(429, INTEGRATION_ERROR_CODE.RATE_LIMITED)
  }
  return null
}

const integrationError = (status: number, code: string): Response =>
  new Response(JSON.stringify({ error: { code } }), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  })

/*
 * 幂等派生哈希：外部工具重试（n8n 指数退避、网络超时重放）不应在稿源箱
 * 留下重复行。优先级：调用方自带 contentHash（内容寻址，最准）> webhook
 * 正文哈希（同文重投天然去重）> Idempotency-Key 哈希（同键重放）。
 * 带前缀的派生值在 create 事务里走「查到即原样返回、不插入」的快速路径。
 */
export const derivedIdempotencyHashOf = (input: {
  readonly bodyMarkdown?: string
  readonly contentHash?: string
  readonly idempotencyKey?: string | null
}): string | undefined => {
  if (input.contentHash !== undefined) return undefined
  if (input.bodyMarkdown !== undefined && input.bodyMarkdown.length > 0) {
    return `webhook:${createHash("sha256").update(input.bodyMarkdown).digest("hex")}`
  }
  if (input.idempotencyKey !== null && input.idempotencyKey !== undefined) {
    return `idem:${createHash("sha256").update(input.idempotencyKey).digest("hex")}`
  }
  return undefined
}

export const isDerivedIdempotencyHash = (hash: string | undefined): hash is string =>
  hash !== undefined && (hash.startsWith("webhook:") || hash.startsWith("idem:"))
