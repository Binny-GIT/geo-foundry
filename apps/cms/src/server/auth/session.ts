/*
 * 不依赖旧认证管线的请求身份解析。
 * 优先支持 gf-session，回退旧 cookie payload-token；Worker 仍使用
 * `users API-Key <key>`。两条路径最终都复用 resolveSessionClaims 的角色/租户
 * 不变量，避免认证切换出现第二套规则。
 */

import { resolveSessionClaims, type SessionClaims } from "../../access/session"
import { ApiCredentialsRepository } from "../repositories/api-credentials"
import { type UserAuthRecord, UsersRepository } from "../repositories/users"
import { serverRuntime } from "../runtime"
import { apiKeyFromAuthorization, verifySessionToken } from "./compat"

export type AuthenticatedRequest = Readonly<{
  claims: SessionClaims
  /** Cookie JWT 元数据；API-Key 身份不具有浏览器会话。 */
  session: Readonly<{ exp: number; sid: string; token: string }> | null
  siteIds: readonly number[]
  user: UserAuthRecord
}>

export const sessionTokenFromCookie = (cookie: string | null): string | null => {
  if (cookie === null) return null
  const cookies = new Map(
    cookie.split(";").map((part) => {
      const [name, ...value] = part.trim().split("=")
      return [name, value.join("=")] as const
    }),
  )
  return cookies.get("gf-session") || cookies.get("payload-token") || null
}

const authenticatedOf = async (
  repo: UsersRepository,
  user: UserAuthRecord,
  session: AuthenticatedRequest["session"] = null,
): Promise<AuthenticatedRequest | null> => {
  const claims = resolveSessionClaims({
    id: user.id,
    role: user.role,
    tenant: user.tenantId,
  })
  if (claims === null) return null
  return { claims, session, siteIds: await repo.siteIds(user.id), user }
}

export const authenticateRequest = async (
  headers: Headers,
): Promise<AuthenticatedRequest | null> => {
  const { configSecret, db } = serverRuntime()
  const repo = new UsersRepository(db)

  const apiKey = apiKeyFromAuthorization(headers.get("authorization"))
  if (apiKey !== null) {
    /*
     * 先查 Console 自助签发的集成密钥（可命名、可单把吊销、可设有效期），
     * 未命中再回退 users.api_key_index —— 后者是 Worker keyring 的路径，
     * 保持原样不动，所以本改动对 Worker 的影响为零。
     */
    const credentials = new ApiCredentialsRepository(db)
    const issued = await credentials.findActiveByKey(apiKey, configSecret)
    if (issued !== null) {
      const user = await repo.findAuthById(issued.userId)
      if (user === null || user.tenantId !== issued.tenantId) return null
      /* 最后使用时间不参与认证结果，失败也不能拖垮请求。 */
      void credentials.touchLastUsed(issued.credentialId).catch(() => undefined)
      return authenticatedOf(repo, user)
    }
    const user = await repo.findAuthByApiKey(apiKey, configSecret)
    return user === null ? null : authenticatedOf(repo, user)
  }

  const token = sessionTokenFromCookie(headers.get("cookie"))
  if (token === null) return null
  const tokenClaims = await verifySessionToken(token, configSecret)
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
  return user === null || !active
    ? null
    : authenticatedOf(repo, user, {
        exp: tokenClaims.exp,
        sid: tokenClaims.sid,
        token,
      })
}
