/*
 * 集成密钥仓储：Console 自助签发给外部 AI/自动化工具的 API Key。
 *
 * 设计约束：
 * - 明文只在 issue() 的返回值里出现一次，既不落库也不写日志；
 * - 库里只有 HMAC-SHA256 索引（与 Worker keyring 同一套派生规则）与展示前缀；
 * - 吊销是软删除（revoked_at），保留审计痕迹；认证每次查库，吊销下一请求即生效；
 * - 只做数据访问，租户判定由调用方传入 EntityScope 决定。
 */

import { randomBytes } from "node:crypto"

import { and, desc, eq, isNull, or, sql } from "drizzle-orm"

import { apiKeyIndexesOf } from "../auth/compat"
import type { ServerDb } from "../db/client"
import { apiCredentials } from "../db/schema"

/** 明文密钥前缀。选它是为了让泄漏扫描（GitHub secret scanning 等）能识别。 */
export const API_KEY_PREFIX = "gfa_"

/** 列表展示用的前缀长度：gfa_ + 8 位，足以人眼区分且不足以暴力还原。 */
const DISPLAY_PREFIX_LENGTH = API_KEY_PREFIX.length + 8

export type ApiCredentialRecord = Readonly<{
  createdAt: Date
  createdById: number
  defaultSiteId: number | null
  expiresAt: Date | null
  id: number
  keyPrefix: string
  lastUsedAt: Date | null
  name: string
  revokedAt: Date | null
  tenantId: number
  userId: number
}>

export type IssuedApiCredential = Readonly<{
  /** 明文密钥，仅此一次可见。 */
  apiKey: string
  record: ApiCredentialRecord
}>

export type ApiCredentialAuth = Readonly<{
  credentialId: number
  /** 投稿缺省站点：payload 不带 suggestedSiteId 时回落到这里。 */
  defaultSiteId: number | null
  tenantId: number
  userId: number
}>

type CredentialRow = typeof apiCredentials.$inferSelect

const recordOf = (row: CredentialRow): ApiCredentialRecord => ({
  createdAt: row.createdAt,
  createdById: row.createdById,
  defaultSiteId: row.defaultSiteId,
  expiresAt: row.expiresAt,
  id: row.id,
  keyPrefix: row.keyPrefix,
  lastUsedAt: row.lastUsedAt,
  name: row.name,
  revokedAt: row.revokedAt,
  tenantId: row.tenantId,
  userId: row.userId,
})

/** 生成一把新密钥的明文。32 字节随机数，base64url 无填充。 */
export const generateApiKey = (): string =>
  `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`

export const displayPrefixOf = (apiKey: string): string => apiKey.slice(0, DISPLAY_PREFIX_LENGTH)

export class ApiCredentialsRepository {
  constructor(private readonly db: ServerDb) {}

  /**
   * 签发一把新密钥。明文只出现在返回值里；调用方必须一次性交给用户，
   * 不得回写日志或再次持久化。
   */
  async issue(input: {
    readonly configSecret: string
    readonly createdById: number
    readonly defaultSiteId: number | null
    readonly expiresAt: Date | null
    readonly name: string
    readonly tenantId: number
    readonly userId: number
  }): Promise<IssuedApiCredential> {
    const apiKey = generateApiKey()
    const [, keyIndex] = apiKeyIndexesOf(apiKey, input.configSecret)
    const rows = await this.db
      .insert(apiCredentials)
      .values({
        createdById: input.createdById,
        defaultSiteId: input.defaultSiteId,
        expiresAt: input.expiresAt,
        keyIndex,
        keyPrefix: displayPrefixOf(apiKey),
        name: input.name,
        tenantId: input.tenantId,
        userId: input.userId,
      })
      .returning()
    const row = rows[0]
    if (row === undefined) throw new Error("API_CREDENTIAL_INSERT_FAILED")
    return { apiKey, record: recordOf(row) }
  }

  /**
   * 认证查找：只命中未吊销且未过期的密钥。
   * 只用 SHA-256 索引——本表是新建的，不存在旧 SHA-1 兼容形态。
   */
  async findActiveByKey(apiKey: string, configSecret: string): Promise<ApiCredentialAuth | null> {
    if (!apiKey.startsWith(API_KEY_PREFIX)) return null
    const [, keyIndex] = apiKeyIndexesOf(apiKey, configSecret)
    const rows = await this.db
      .select({
        defaultSiteId: apiCredentials.defaultSiteId,
        id: apiCredentials.id,
        tenantId: apiCredentials.tenantId,
        userId: apiCredentials.userId,
      })
      .from(apiCredentials)
      .where(
        and(
          eq(apiCredentials.keyIndex, keyIndex),
          isNull(apiCredentials.revokedAt),
          or(isNull(apiCredentials.expiresAt), sql`${apiCredentials.expiresAt} > NOW()`),
        ),
      )
      .limit(1)
    const row = rows[0]
    return row === undefined
      ? null
      : {
          credentialId: row.id,
          defaultSiteId: row.defaultSiteId,
          tenantId: row.tenantId,
          userId: row.userId,
        }
  }

  /** 最后使用时间。调用方以 fire-and-forget 方式使用，失败不得阻断请求。 */
  async touchLastUsed(credentialId: number): Promise<void> {
    await this.db
      .update(apiCredentials)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiCredentials.id, credentialId))
  }

  async listByTenant(tenantId: number): Promise<readonly ApiCredentialRecord[]> {
    const rows = await this.db
      .select()
      .from(apiCredentials)
      .where(eq(apiCredentials.tenantId, tenantId))
      .orderBy(desc(apiCredentials.createdAt))
      .limit(200)
    return rows.map(recordOf)
  }

  async listAll(): Promise<readonly ApiCredentialRecord[]> {
    const rows = await this.db
      .select()
      .from(apiCredentials)
      .orderBy(desc(apiCredentials.createdAt))
      .limit(200)
    return rows.map(recordOf)
  }

  async findById(id: number): Promise<ApiCredentialRecord | null> {
    const rows = await this.db
      .select()
      .from(apiCredentials)
      .where(eq(apiCredentials.id, id))
      .limit(1)
    const row = rows[0]
    return row === undefined ? null : recordOf(row)
  }

  /** 吊销。重复吊销保持首次时间戳，返回 false 让调用方回 409 而不是假装成功。 */
  async revoke(id: number): Promise<boolean> {
    const now = new Date()
    const rows = await this.db
      .update(apiCredentials)
      .set({ revokedAt: now, updatedAt: now })
      .where(and(eq(apiCredentials.id, id), isNull(apiCredentials.revokedAt)))
      .returning({ id: apiCredentials.id })
    return rows.length === 1
  }
}
