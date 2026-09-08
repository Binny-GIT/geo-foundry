/*
 * 认证兼容层（批次 4 后端去 Payload 的第一步）：
 * 不 import 任何 Payload 代码，独立复现其凭据与会话校验。
 *
 * 机制（与 Payload 3.88 源码逐字对照，已在 mk-dev 用真实数据验证）：
 * - 密码：pbkdf2(password, salt, 25000 轮, 512 字节, sha256)，salt 为
 *   32 字节随机数的 hex；存储形态 users 表的 salt/hash 两列（hex 字符串）。
 * - 会话：jose HS256 JWT，cookie 名 payload-token；载荷含 id/collection/
 *   email/sid（会话撤销用），iat + exp（7 天）。
 * - 关键坑：JWT 签名密钥不是 config.secret 原文，而是 Payload 初始化时的
 *   派生值 sha256(secret).hex 的前 32 字符（payload/dist/index.js:322）。
 */

import crypto from "node:crypto"

import { jwtVerify } from "jose"

/** Payload 运行时签名密钥：sha256(configSecret) 的 hex 前 32 字符。 */
export const payloadSigningKeyOf = (configSecret: string): string =>
  crypto.createHash("sha256").update(configSecret).digest("hex").slice(0, 32)

export type StoredCredentials = Readonly<{
  /** users.hash：512 字节的 hex（1024 字符）。 */
  readonly hash: string
  /** users.salt：32 字节的 hex（64 字符）。 */
  readonly salt: string
}>

/** 校验明文密码与存储凭据是否匹配（参数与 Payload authenticate 逐字一致）。 */
export const verifyPasswordCompat = async (
  password: string,
  stored: StoredCredentials,
): Promise<boolean> => {
  if (stored.salt.length === 0 || stored.hash.length === 0) return false
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.pbkdf2(password, stored.salt, 25_000, 512, "sha256", (error, hashRaw) => {
      if (error !== null) reject(error)
      else resolve(hashRaw)
    })
  })
  const storedHash = Buffer.from(stored.hash, "hex")
  return (
    derived.length === storedHash.length && crypto.timingSafeEqual(derived, storedHash)
  )
}

export type SessionClaims = Readonly<{
  collection?: unknown
  email?: unknown
  exp: number
  id?: unknown
  /** 会话撤销用的 session id（users_sessions 行）。 */
  sid?: unknown
}>

/** 校验 payload-token 的 JWT 签名与有效期；解析失败/过期/篡改一律 null。 */
export const verifySessionTokenCompat = async (
  token: string,
  configSecret: string,
): Promise<SessionClaims | null> => {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(payloadSigningKeyOf(configSecret)), {
      algorithms: ["HS256"],
    })
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof payload["exp"] !== "number"
    ) {
      return null
    }
    return payload as unknown as SessionClaims
  } catch {
    return null
  }
}
