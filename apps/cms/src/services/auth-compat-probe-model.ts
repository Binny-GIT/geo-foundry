/*
 * 影子认证端点的纯逻辑：兼容层会话签发（与 Payload login 的 JWT 形态对齐）。
 * 供 endpoint 与单测共用；不含任何 IO。
 */

import { SignJWT } from "jose"

import { payloadSigningKeyOf } from "../server/auth/compat"

export const SESSION_TOKEN_EXPIRATION_SECONDS = 60 * 60 * 24 * 7

export type CompatSessionToken = Readonly<{ expiresAt: number; token: string }>

/** 签发与 Payload login 同构的会话 JWT（HS256 + 派生密钥 + 7 天 + sid）。 */
export const issueCompatSessionToken = async (input: {
  readonly configSecret: string
  readonly email: string
  readonly sid: string
  readonly userId: number
}): Promise<CompatSessionToken> => {
  const issuedAt = Math.floor(Date.now() / 1000)
  const exp = issuedAt + SESSION_TOKEN_EXPIRATION_SECONDS
  const token = await new SignJWT({
    collection: "users",
    email: input.email,
    id: input.userId,
    sid: input.sid,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(issuedAt)
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(payloadSigningKeyOf(input.configSecret)))
  return { expiresAt: exp, token }
}

/** 登录失败的统一响应体：不区分「用户不存在」与「密码错误」，防账号枚举。 */
export const LOGIN_REJECTED_BODY = { error: { code: "AUTH_PROBE_LOGIN_REJECTED" } } as const
