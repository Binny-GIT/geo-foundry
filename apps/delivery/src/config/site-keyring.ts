/*
 * 站点密钥 + 配额的凭据文件解析。形态参照仓库现有的
 * `content-service-keyring.json`（apps/worker/src/config/tenant-keyring.ts）：
 * 一份 JSON 文件，owner-only 权限，进程启动时一次性读入内存，此后鉴权判断
 * 全部基于内存 Map，不再触碰文件系统，也绝不连数据库（ADR-001）。
 *
 * 与 content-service-keyring 的差异：那份文件是"每租户一把 key、一次全量
 * 轮换"；这里改为"每站点一组 key"（数组，支持滚动轮换期内新旧 key 并存），
 * 且每把 key 自带 status（active/revoked）与 expiresAt（可空，配合密钥吊销
 * /过期语义）、quotaPerMinute（每分钟配额，配合 auth/quota 中间件）。
 */
import { readFileSync } from "node:fs"
import { z } from "zod"

const SiteKeyEntrySchema = z
  .strictObject({
    expiresAt: z.union([z.iso.datetime({ offset: true }), z.null()]),
    key: z.string().min(16),
    quotaPerMinute: z.number().int().positive(),
    status: z.enum(["active", "revoked"]),
  })
  .readonly()

const SiteKeyringFileSchema = z
  .strictObject({
    sites: z.record(
      z.string().min(1),
      z.strictObject({ keys: z.array(SiteKeyEntrySchema).min(1).readonly() }).readonly(),
    ),
  })
  .readonly()

export type SiteKeyEntry = z.infer<typeof SiteKeyEntrySchema>

/** 站点 host（小写归一化）到其有效 key 列表的映射。 */
export type SiteKeyring = ReadonlyMap<string, readonly SiteKeyEntry[]>

export class SiteKeyringError extends Error {
  override readonly name = "SiteKeyringError"

  constructor(readonly code: string) {
    super(code)
  }
}

export const parseSiteKeyring = (raw: unknown): SiteKeyring => {
  const parsed = SiteKeyringFileSchema.safeParse(raw)
  if (!parsed.success) {
    throw new SiteKeyringError("DELIVERY_SITE_KEYRING_INVALID")
  }
  const entries = new Map<string, readonly SiteKeyEntry[]>()
  for (const [host, value] of Object.entries(parsed.data.sites)) {
    const normalizedHost = host.trim().toLowerCase()
    if (normalizedHost.length === 0) {
      throw new SiteKeyringError("DELIVERY_SITE_KEYRING_INVALID")
    }
    entries.set(normalizedHost, value.keys)
  }
  return entries
}

/** 从磁盘加载并解析站点密钥凭据文件。JSON 解析失败也归一为同一个错误码，不泄露内容。 */
export const loadSiteKeyringFile = (path: string): SiteKeyring => {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, "utf8"))
  } catch {
    throw new SiteKeyringError("DELIVERY_SITE_KEYRING_INVALID")
  }
  return parseSiteKeyring(raw)
}
