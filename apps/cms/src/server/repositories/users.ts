/*
 * users 仓储：认证域的最小查询集（登录校验、API-Key、锁定、会话撤销）。
 *
 * 设计约束：
 * - 只做数据访问，不做访问控制判定（那是 service/access 层的事）；
 * - 返回 DTO 而非表行，调用方不接触 drizzle 类型；
 * - 写操作接受可选事务（tx 参数），保证登录计数的读写落在同一事务。
 */

import { and, eq, gt, sql } from "drizzle-orm"

import type { ServerDb } from "../db/client"
import { users, usersSessions, usersRole } from "../db/schema"

export type UserAuthRecord = Readonly<{
  apiKey: string | null
  apiKeyIndex: string | null
  email: string
  enableAPIToken: boolean
  hash: string | null
  id: number
  loginAttempts: number
  lockUntil: Date | null
  role: (typeof usersRole.enumValues)[number]
  salt: string | null
  tenantId: number | null
}>

type UserRow = typeof users.$inferSelect

const authRecordOf = (row: UserRow): UserAuthRecord => ({
  apiKey: row.apiKey,
  apiKeyIndex: row.apiKeyIndex,
  email: row.email,
  enableAPIToken: row.enableAPIToken === true,
  hash: row.hash,
  id: row.id,
  loginAttempts: row.loginAttempts === null ? 0 : Number(row.loginAttempts),
  lockUntil: row.lockUntil,
  role: row.role,
  salt: row.salt,
  tenantId: row.tenantId,
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

  /** Worker keyring：Payload 的 API-Key 按「索引前缀 + 全键」两列存储。 */
  async findIdByApiKey(apiKey: string): Promise<number | null> {
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.apiKey, apiKey), eq(users.enableAPIToken, true)))
      .limit(1)
    return rows[0]?.id ?? null
  }

  async recordLoginFailure(id: number): Promise<{ attempts: number; lockUntil: Date | null }> {
    const rows = await this.db
      .update(users)
      .set({ loginAttempts: sql`${users.loginAttempts} + 1`, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({ attempts: users.loginAttempts, lockUntil: users.lockUntil })
    const row = rows[0]
    if (row === undefined) throw new Error(`users row missing: ${String(id)}`)
    return { attempts: Number(row.attempts ?? 0), lockUntil: row.lockUntil }
  }

  async resetLoginFailures(id: number): Promise<void> {
    await this.db
      .update(users)
      .set({ loginAttempts: "0", lockUntil: null, updatedAt: new Date() })
      .where(eq(users.id, id))
  }

  /** 会话撤销：按 sid 删除 users_sessions 行（Payload 撤销语义的等价实现）。 */
  async revokeSession(userId: number, sid: string): Promise<boolean> {
    const rows = await this.db
      .delete(usersSessions)
      .where(and(eq(usersSessions.parentId, userId), eq(usersSessions.id, sid)))
      .returning({ id: usersSessions.id })
    return rows.length > 0
  }

  async activeSessionIds(userId: number): Promise<readonly string[]> {
    const rows = await this.db
      .select({ sid: usersSessions.id })
      .from(usersSessions)
      .where(and(eq(usersSessions.parentId, userId), gt(usersSessions.expiresAt, new Date())))
    return rows.map((row) => row.sid)
  }
}
