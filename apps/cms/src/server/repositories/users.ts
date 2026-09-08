/*
 * users 仓储：认证域的最小查询集（登录校验、API-Key、锁定、会话撤销）。
 *
 * 设计约束：
 * - 只做数据访问，不做访问控制判定（那是 service/access 层的事）；
 * - 返回 DTO 而非表行，调用方不接触 drizzle 类型；
 * - 登录成功的 session 插入与失败计数清零在同一事务提交。
 */

import { and, eq, gt, inArray, sql } from "drizzle-orm"

import { payloadApiKeyIndexesOf } from "../auth/compat"
import type { ServerDb } from "../db/client"
import { users, usersSessions, type usersRole } from "../db/schema"

export type UserAuthRecord = Readonly<{
  createdAt: Date
  email: string
  enableAPIToken: boolean | null
  hash: string | null
  id: number
  loginAttempts: number
  lockUntil: Date | null
  role: (typeof usersRole.enumValues)[number]
  salt: string | null
  tenantId: number | null
  updatedAt: Date
}>

type UserRow = typeof users.$inferSelect

const authRecordOf = (row: UserRow): UserAuthRecord => ({
  createdAt: row.createdAt,
  email: row.email,
  enableAPIToken: row.enableAPIToken,
  hash: row.hash,
  id: row.id,
  loginAttempts: row.loginAttempts === null ? 0 : Number(row.loginAttempts),
  lockUntil: row.lockUntil,
  role: row.role,
  salt: row.salt,
  tenantId: row.tenantId,
  updatedAt: row.updatedAt,
})

export class UsersRepository {
  constructor(private readonly db: ServerDb) {}

  async findAuthByEmail(email: string): Promise<UserAuthRecord | null> {
    const rows = await this.db.select().from(users).where(eq(users.email, email)).limit(1)
    const row = rows[0]
    return row === undefined ? null : authRecordOf(row)
  }

  async findAuthById(id: number): Promise<UserAuthRecord | null> {
    const rows = await this.db.select().from(users).where(eq(users.id, id)).limit(1)
    const row = rows[0]
    return row === undefined ? null : authRecordOf(row)
  }

  /**
   * Worker keyring：数据库 api_key 是密文，不能与明文比较；按 Payload 官方
   * 策略计算 HMAC-SHA256 / legacy SHA1 两种 api_key_index 查询。
   */
  async findAuthByApiKey(apiKey: string, configSecret: string): Promise<UserAuthRecord | null> {
    const indexes = payloadApiKeyIndexesOf(apiKey, configSecret)
    const rows = await this.db
      .select()
      .from(users)
      .where(and(inArray(users.apiKeyIndex, indexes), eq(users.enableAPIToken, true)))
      .limit(1)
    const row = rows[0]
    return row === undefined ? null : authRecordOf(row)
  }

  async recordLoginFailure(id: number): Promise<{ attempts: number; lockUntil: Date | null }> {
    const now = new Date()
    const lockUntil = new Date(now.getTime() + 10 * 60 * 1000)
    const rows = await this.db
      .update(users)
      .set({
        loginAttempts: sql`CASE
          WHEN ${users.lockUntil} IS NOT NULL AND ${users.lockUntil} <= ${now} THEN 1
          ELSE COALESCE(${users.loginAttempts}, 0) + 1
        END`,
        lockUntil: sql`CASE
          WHEN (
            CASE
              WHEN ${users.lockUntil} IS NOT NULL AND ${users.lockUntil} <= ${now} THEN 1
              ELSE COALESCE(${users.loginAttempts}, 0) + 1
            END
          ) >= 5 THEN ${lockUntil}
          WHEN ${users.lockUntil} IS NOT NULL AND ${users.lockUntil} <= ${now} THEN NULL
          ELSE ${users.lockUntil}
        END`,
      })
      .where(eq(users.id, id))
      .returning({ attempts: users.loginAttempts, lockUntil: users.lockUntil })
    const row = rows[0]
    if (row === undefined) throw new Error(`users row missing: ${String(id)}`)
    return { attempts: Number(row.attempts ?? 0), lockUntil: row.lockUntil }
  }

  async resetLoginFailures(id: number): Promise<void> {
    await this.db.update(users).set({ loginAttempts: "0", lockUntil: null }).where(eq(users.id, id))
  }

  /**
   * 登录成功事务：按用户 advisory lock 串行化 session order，清理过期行、
   * 插入新 sid，并把失败计数/锁定同时清零。任一步失败都不会签出孤儿会话。
   */
  async createLoginSession(userId: number, sid: string, expiresAt: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${userId})`)
      await tx
        .delete(usersSessions)
        .where(and(eq(usersSessions.parentId, userId), sql`${usersSessions.expiresAt} <= NOW()`))
      const maxOrderRows = await tx
        .select({ order: sql<number>`COALESCE(MAX(${usersSessions.order}), -1)` })
        .from(usersSessions)
        .where(eq(usersSessions.parentId, userId))
      await tx.insert(usersSessions).values({
        createdAt: new Date(),
        expiresAt,
        id: sid,
        order: Number(maxOrderRows[0]?.order ?? -1) + 1,
        parentId: userId,
      })
      await tx
        .update(users)
        .set({ loginAttempts: "0", lockUntil: null })
        .where(eq(users.id, userId))
    })
  }

  async hasActiveSession(userId: number, sid: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: usersSessions.id })
      .from(usersSessions)
      .where(
        and(
          eq(usersSessions.parentId, userId),
          eq(usersSessions.id, sid),
          gt(usersSessions.expiresAt, new Date()),
        ),
      )
      .limit(1)
    return rows.length > 0
  }

  /** 会话撤销：按 sid 删除 users_sessions 行（Payload 撤销语义的等价实现）。 */
  async revokeSession(userId: number, sid: string): Promise<boolean> {
    const rows = await this.db
      .delete(usersSessions)
      .where(and(eq(usersSessions.parentId, userId), eq(usersSessions.id, sid)))
      .returning({ id: usersSessions.id })
    return rows.length > 0
  }

  async revokeAllSessions(userId: number): Promise<number> {
    const rows = await this.db
      .delete(usersSessions)
      .where(eq(usersSessions.parentId, userId))
      .returning({ id: usersSessions.id })
    return rows.length
  }

  async refreshSession(userId: number, sid: string, expiresAt: Date): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      await tx
        .delete(usersSessions)
        .where(and(eq(usersSessions.parentId, userId), sql`${usersSessions.expiresAt} <= NOW()`))
      const rows = await tx
        .update(usersSessions)
        .set({ expiresAt })
        .where(and(eq(usersSessions.parentId, userId), eq(usersSessions.id, sid)))
        .returning({ id: usersSessions.id })
      return rows.length === 1
    })
  }

  async updatePasswordHash(
    userId: number,
    credentials: Readonly<{ hash: string; salt: string }>,
  ): Promise<boolean> {
    const rows = await this.db
      .update(users)
      .set({
        hash: credentials.hash,
        resetPasswordExpiration: null,
        resetPasswordToken: null,
        salt: credentials.salt,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning({ id: users.id })
    return rows.length === 1
  }

  async writeResetToken(email: string, token: string, expiresAt: Date): Promise<boolean> {
    const rows = await this.db
      .update(users)
      .set({
        resetPasswordExpiration: expiresAt,
        resetPasswordToken: token,
        updatedAt: new Date(),
      })
      .where(eq(users.email, email))
      .returning({ id: users.id })
    return rows.length === 1
  }

  /** reset token 单次消费 + password + 新 sid 同一事务提交。 */
  async consumeResetToken(
    input: Readonly<{
      credentials: Readonly<{ hash: string; salt: string }>
      expiresAt: Date
      sid: string
      token: string
    }>,
  ): Promise<UserAuthRecord | null> {
    return this.db.transaction(async (tx) => {
      const candidates = await tx
        .select()
        .from(users)
        .where(
          and(
            eq(users.resetPasswordToken, input.token),
            gt(users.resetPasswordExpiration, new Date()),
          ),
        )
        .limit(1)
      const user = candidates[0]
      if (user === undefined) return null
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${user.id})`)
      const updatedRows = await tx
        .update(users)
        .set({
          hash: input.credentials.hash,
          resetPasswordExpiration: new Date(),
          resetPasswordToken: null,
          salt: input.credentials.salt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(users.id, user.id),
            eq(users.resetPasswordToken, input.token),
            gt(users.resetPasswordExpiration, new Date()),
          ),
        )
        .returning()
      const updated = updatedRows[0]
      if (updated === undefined) return null
      await tx
        .delete(usersSessions)
        .where(and(eq(usersSessions.parentId, user.id), sql`${usersSessions.expiresAt} <= NOW()`))
      const orders = await tx
        .select({ order: sql<number>`COALESCE(MAX(${usersSessions.order}), -1)` })
        .from(usersSessions)
        .where(eq(usersSessions.parentId, user.id))
      await tx.insert(usersSessions).values({
        createdAt: new Date(),
        expiresAt: input.expiresAt,
        id: input.sid,
        order: Number(orders[0]?.order ?? -1) + 1,
        parentId: user.id,
      })
      return authRecordOf(updated)
    })
  }

  async activeSessions(
    userId: number,
  ): Promise<readonly Readonly<{ createdAt: Date | null; expiresAt: Date; id: string }>[]> {
    return this.db
      .select({
        createdAt: usersSessions.createdAt,
        expiresAt: usersSessions.expiresAt,
        id: usersSessions.id,
      })
      .from(usersSessions)
      .where(and(eq(usersSessions.parentId, userId), gt(usersSessions.expiresAt, new Date())))
      .orderBy(usersSessions.order)
  }

  async activeSessionIds(userId: number): Promise<readonly string[]> {
    return (await this.activeSessions(userId)).map((session) => session.id)
  }

  /** 用户站点范围功能已下线（users_rels 表已删除）：始终为空。 */
  async siteIds(_userId: number): Promise<readonly number[]> {
    return []
  }
}
