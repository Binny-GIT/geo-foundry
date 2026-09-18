/*
 * 不依赖旧认证管线的请求身份解析。
 * 优先支持 gf-session，回退旧 cookie payload-token；Worker 仍使用
 * `users API-Key <key>`。两条路径最终都复用 resolveSessionClaims 的角色/租户
 * 不变量，避免认证切换出现第二套规则。
 */

import { CMS_ROLE } from "../../access/roles"
import { resolveSessionClaims, type SessionClaims } from "../../access/session"
import { ApiCredentialsRepository } from "../repositories/api-credentials"
import { type UserAuthRecord, UsersRepository } from "../repositories/users"
import { serverRuntime } from "../runtime"
import { apiKeyFromAuthorization, verifySessionToken } from "./compat"

export type AuthenticatedRequest = Readonly<{
  claims: SessionClaims
  /** gfa_ 密钥身份的凭据配置（投稿缺省站点等）；Cookie 会话为 null。 */
  credential: Readonly<{ defaultSiteId: number | null }> | null
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
  credential: AuthenticatedRequest["credential"] = null,
): Promise<AuthenticatedRequest | null> => {
  const claims = resolveSessionClaims({
    id: user.id,
    role: user.role,
    tenant: user.tenantId,
  })
  if (claims === null) return null
  return { claims, credential, session, siteIds: await repo.siteIds(user.id), user }
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
      /*
       * 密钥的权限面与绑定用户的角色解耦：无论密钥属于谁（automation
       * 身份或自助创建的真人用户），gfa_ 密钥一律按 automation 角色出
       * claims —— 投稿面权限 + service kind（adopt/工作流/内部面全部
       * 自动拒绝）。归属由 userId 保留：投稿记 createdById、采纳后文章
       * owner 是密钥创建者。绑定用户转岗/升权不影响既有密钥的权限面。
       * credential 携带密钥的投稿配置（默认站点），只作为数据不作为权限。
       */
      return authenticatedOf(repo, { ...user, role: CMS_ROLE.AUTOMATION }, null, {
        defaultSiteId: issued.defaultSiteId,
      })
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
