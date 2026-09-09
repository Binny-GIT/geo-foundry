/*
 * 会话令牌签发的纯逻辑：保持旧认证格式的 JWT 形态。
 * 供端点与单测共用；不含任何 IO。
 */

import { SignJWT } from "jose"

import { derivedAuthKeyOf } from "./compat"

export const SESSION_TOKEN_EXPIRATION_SECONDS = 60 * 60 * 24 * 7

export type SessionToken = Readonly<{ expiresAt: number; token: string }>

/** 签发与历史登录格式同构的会话 JWT（HS256、派生密钥、7 天、sid）。 */
export const issueSessionToken = async (input: {
  readonly configSecret: string
  readonly email: string
  /** 复用已确定的数据库 session 到期秒值（reset 场景），默认 now + 7d。 */
  readonly expiresAt?: number
  readonly sid: string
  readonly userId: number
}): Promise<SessionToken> => {
  const issuedAt = Math.floor(Date.now() / 1000)
  const exp = input.expiresAt ?? issuedAt + SESSION_TOKEN_EXPIRATION_SECONDS
  const token = await new SignJWT({
    collection: "users",
    email: input.email,
    id: input.userId,
    sid: input.sid,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(issuedAt)
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(derivedAuthKeyOf(input.configSecret)))
  return { expiresAt: exp, token }
}
