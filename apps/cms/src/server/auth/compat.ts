/*
 * 旧认证格式兼容层：不依赖旧运行时，独立校验历史凭据与会话。
 *
 * 历史兼容规则：
 * - 密码：PBKDF2(password, salt, 25000 轮, 512 字节, sha256)，salt 为
 *   32 字节随机数的 hex；存储形态为 users 表的 salt/hash 两列（hex 字符串）。
 * - 会话：jose HS256 JWT，旧 cookie 名为 payload-token；载荷含 id/collection/
 *   email/sid（会话撤销用），iat + exp（7 天）。
 * - JWT 签名密钥使用 sha256(secret).hex 的前 32 字符派生值，而非原始 secret。
 */

import crypto from "node:crypto"

import { jwtVerify } from "jose"

/** 历史认证格式的签名密钥：sha256(configSecret) 的 hex 前 32 字符。 */
export const derivedAuthKeyOf = (configSecret: string): string =>
  crypto.createHash("sha256").update(configSecret).digest("hex").slice(0, 32)

/**
 * 历史 API-Key 不按 api_key 密文列匹配，而是用派生签名密钥对明文 key
 * 计算 HMAC 索引。SHA-1 是旧版兼容形态，SHA-256 是当前形态。
 */
export const apiKeyIndexesOf = (
  apiKey: string,
  configSecret: string,
): readonly [sha1: string, sha256: string] => {
  const signingKey = derivedAuthKeyOf(configSecret)
  return [
    crypto.createHmac("sha1", signingKey).update(apiKey).digest("hex"),
    crypto.createHmac("sha256", signingKey).update(apiKey).digest("hex"),
  ]
}

/** 严格解析 Worker 的固定 Authorization 契约。 */
export const apiKeyFromAuthorization = (authorization: string | null): string | null => {
  const prefix = "users API-Key "
  if (authorization === null || !authorization.startsWith(prefix)) return null
  const apiKey = authorization.slice(prefix.length)
  return apiKey.length > 0 ? apiKey : null
}

export type StoredCredentials = Readonly<{
  /** users.hash：512 字节的 hex（1024 字符）。 */
  readonly hash: string
  /** users.salt：32 字节的 hex（64 字符）。 */
  readonly salt: string
}>

/** 校验明文密码与旧 PBKDF2 存储凭据是否匹配。 */
export const verifyLegacyPbkdf2 = async (
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
  return derived.length === storedHash.length && crypto.timingSafeEqual(derived, storedHash)
}

export type SessionClaims = Readonly<{
  collection?: unknown
  email?: unknown
  exp: number
  id?: unknown
  /** 会话撤销用的 session id（users_sessions 行）。 */
  sid?: unknown
}>

/** 校验会话 JWT 的签名与有效期；解析失败、过期或篡改一律返回 null。 */
export const verifySessionToken = async (
  token: string,
  configSecret: string,
): Promise<SessionClaims | null> => {
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(derivedAuthKeyOf(configSecret)),
      {
        algorithms: ["HS256"],
      },
    )
    if (typeof payload !== "object" || payload === null || typeof payload["exp"] !== "number") {
      return null
    }
    return payload as unknown as SessionClaims
  } catch {
    return null
  }
}
