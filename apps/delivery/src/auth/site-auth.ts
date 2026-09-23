/*
 * 站点密钥鉴权 + 配额：站点作用域的路由（JSON 页、sitemap、media、HTML 回落）
 * 全部要求 `Authorization: Bearer <site-key>`，密钥与配额只从
 * config/site-keyring.ts 装配出的内存 keyring 判断，不读对象存储、不连数据库。
 *
 * 与 apps/cms/src/server/routes/delivery.ts 现有限流的差异：那里按
 * `x-forwarded-for` 第一段限流——架构文档已指出这在 Cloudflare 隧道之后
 * 可被伪造（docs/content-delivery-architecture.md 第 8 节）。这里改为按
 * "站点 host + 具体 key" 分桶，配额值本身也来自凭据文件而不是硬编码常量。
 *
 * 判定顺序（见各分支返回的 kind）：
 *   1. host 在 keyring 里完全没有条目 / 请求没带 Authorization → 401
 *   2. 带了 Authorization，但对该 host 而言，token 不匹配任何一把已登记的 key → 403
 *   3. token 匹配上的 key 状态是 revoked → 403
 *   4. token 匹配上的 key 已过 expiresAt → 403
 *   5. 通过后按该 key 的 quotaPerMinute 走配额，超额 → 429
 * "未知站点"（host 在路由清单里都不存在）不是这一层的职责——那是
 * runtime.resolve/resolveSitemap/resolveMedia 各自的 unknown-host 分支，
 * 在鉴权通过之后才会被观察到，两层互不依赖对方的判断依据。
 */
import { createHash, timingSafeEqual } from "node:crypto"

import type { SiteKeyEntry, SiteKeyring } from "../config/site-keyring.js"

export type SiteAuthDecision =
  | { readonly kind: "expired" }
  | { readonly kind: "invalid-key" }
  | { readonly kind: "missing-credentials" }
  | { readonly entry: SiteKeyEntry; readonly kind: "ok" }
  | { readonly kind: "revoked" }

const BEARER_PATTERN = /^Bearer\s+(\S+)$/

const digestOf = (value: string): Buffer => createHash("sha256").update(value).digest()

export const bearerTokenOf = (authorizationHeader: string | undefined | null): string | null => {
  if (authorizationHeader === undefined || authorizationHeader === null) return null
  const match = BEARER_PATTERN.exec(authorizationHeader.trim())
  return match?.[1] ?? null
}

export const authorizeSiteRequest = (
  keyring: SiteKeyring,
  host: string,
  authorizationHeader: string | undefined | null,
  now: number,
): SiteAuthDecision => {
  const token = bearerTokenOf(authorizationHeader)
  if (token === null) return { kind: "missing-credentials" }
  const entries = keyring.get(host.trim().toLowerCase()) ?? []
  const tokenDigest = digestOf(token)
  let matched: SiteKeyEntry | undefined
  for (const entry of entries) {
    const equal = timingSafeEqual(digestOf(entry.key), tokenDigest)
    if (equal) matched = entry
  }
  if (matched === undefined) return { kind: "invalid-key" }
  if (matched.status === "revoked") return { kind: "revoked" }
  if (matched.expiresAt !== null && Date.parse(matched.expiresAt) <= now) return { kind: "expired" }
  return { entry: matched, kind: "ok" }
}

export type QuotaCheck =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterSeconds: number }

/** 简单的固定窗口配额计数器，按任意字符串 bucket key 分桶（这里用 `host\0key`）。 */
export class QuotaTracker {
  readonly #buckets = new Map<string, { count: number; resetAt: number }>()
  readonly #windowMs: number

  constructor(windowMs = 60_000) {
    this.#windowMs = windowMs
  }

  consume(bucketKey: string, limitPerWindow: number, now: number): QuotaCheck {
    const bucket = this.#buckets.get(bucketKey)
    if (bucket === undefined || bucket.resetAt <= now) {
      this.#buckets.set(bucketKey, { count: 1, resetAt: now + this.#windowMs })
      return { allowed: true }
    }
    bucket.count += 1
    if (bucket.count > limitPerWindow) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      }
    }
    return { allowed: true }
  }
}

export const quotaBucketKeyOf = (host: string, entry: SiteKeyEntry): string =>
  `${host.trim().toLowerCase()}\u0000${entry.key}`
