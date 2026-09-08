/*
 * 不依赖 Payload auth 管线的请求身份解析。
 * 支持现有 payload-token cookie 与 Worker `users API-Key <key>`；两条路径最终
 * 都复用 resolveSessionClaims 的角色/租户不变量，避免认证切换出现第二套规则。
 */

import { resolveSessionClaims, type SessionClaims } from "../../access/session"
import { apiKeyFromAuthorization, verifySessionTokenCompat } from "./compat"
import { UsersRepository, type UserAuthRecord } from "../repositories/users"
import { serverRuntime } from "../runtime"

export type AuthenticatedRequest = Readonly<{
  claims: SessionClaims
  siteIds: readonly number[]
  user: UserAuthRecord
}>

const tokenFromCookie = (cookie: string | null): string | null => {
  if (cookie === null) return null
  const pair = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("payload-token="))
  return pair === undefined ? null : pair.slice("payload-token=".length)
}

const authenticatedOf = async (
  repo: UsersRepository,
  user: UserAuthRecord,
): Promise<AuthenticatedRequest | null> => {
  const claims = resolveSessionClaims({
    id: user.id,
    role: user.role,
    tenant: user.tenantId,
  })
  if (claims === null) return null
  return { claims, siteIds: await repo.siteIds(user.id), user }
}

export const authenticateRequest = async (headers: Headers): Promise<AuthenticatedRequest | null> => {
  const { configSecret, db } = serverRuntime()
  const repo = new UsersRepository(db)

  const apiKey = apiKeyFromAuthorization(headers.get("authorization"))
  if (apiKey !== null) {
    const user = await repo.findAuthByApiKey(apiKey, configSecret)
    return user === null ? null : authenticatedOf(repo, user)
  }

  const token = tokenFromCookie(headers.get("cookie"))
  if (token === null) return null
  const tokenClaims = await verifySessionTokenCompat(token, configSecret)
  if (
    tokenClaims === null ||
    tokenClaims.collection !== "users" ||
    typeof tokenClaims.id !== "number" ||
    typeof tokenClaims.sid !== "string"
  ) {
    return null
  }
  const [user, active] = await Promise.all([
    repo.findAuthById(tokenClaims.id),
    repo.hasActiveSession(tokenClaims.id, tokenClaims.sid),
  ])
  return user === null || !active ? null : authenticatedOf(repo, user)
}
