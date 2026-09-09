/*
 * 密码哈希（2026-09 起）：Node 内置 scrypt，OWASP 基线 N=2^17, r=8, p=1。
 *
 * 存储形态沿用 users.salt / users.hash 两列，算法标记放进 hash 串前缀：
 * - 新格式："$scrypt$131072,8,1$<saltHex>$<keyHex>"（salt 列同步存 saltHex）
 * - 旧格式：纯 hex（历史兼容 PBKDF2 25000 轮 512 字节 sha256）
 * 旧格式验证成功后由登录路径在同一请求内用新算法重哈希写回，用户无感知。
 */

import crypto from "node:crypto"

import { type StoredCredentials, verifyLegacyPbkdf2 } from "./compat"

const SCRYPT_PREFIX = "$scrypt$"
const SCRYPT_N = 131_072
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEY_BYTES = 64
/** Node 默认 maxmem 32MB 不足以跑 N=2^17, r=8（约需 128MB），显式放宽。 */
const SCRYPT_MAXMEM = 256 * 1024 * 1024

const scryptAsync = (
  password: string,
  salt: Buffer,
  params: { readonly N: number; readonly p: number; readonly r: number } = {
    N: SCRYPT_N,
    p: SCRYPT_P,
    r: SCRYPT_R,
  },
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      SCRYPT_KEY_BYTES,
      { maxmem: SCRYPT_MAXMEM, N: params.N, p: params.p, r: params.r },
      (error, key) => {
        if (error !== null) reject(error)
        else resolve(key)
      },
    )
  })

/** 新建/修改密码一律产 scrypt 格式凭据。 */
export const hashPassword = async (password: string): Promise<StoredCredentials> => {
  const salt = crypto.randomBytes(32)
  const key = await scryptAsync(password, salt)
  return {
    hash: `${SCRYPT_PREFIX}${SCRYPT_N},${SCRYPT_R},${SCRYPT_P}$${salt.toString("hex")}$${key.toString("hex")}`,
    salt: salt.toString("hex"),
  }
}

const parseScryptHash = (
  hash: string,
): {
  readonly key: Buffer
  readonly N: number
  readonly p: number
  readonly r: number
  readonly salt: Buffer
} | null => {
  if (!hash.startsWith(SCRYPT_PREFIX)) return null
  const parts = hash.slice(SCRYPT_PREFIX.length).split("$")
  if (parts.length !== 3) return null
  const [params = "", saltHex = "", keyHex = ""] = parts
  const [nText, rText, pText] = params.split(",")
  if (nText === undefined || rText === undefined || pText === undefined) return null
  const N = Number(nText)
  const r = Number(rText)
  const p = Number(pText)
  if (
    !Number.isInteger(N) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    N <= 0 ||
    r <= 0 ||
    p <= 0
  ) {
    return null
  }
  if (saltHex.length === 0 || keyHex.length === 0) return null
  if (!/^[0-9a-f]+$/.test(saltHex) || !/^[0-9a-f]+$/.test(keyHex)) return null
  return { N, key: Buffer.from(keyHex, "hex"), p, r, salt: Buffer.from(saltHex, "hex") }
}

export type PasswordVerification = Readonly<{
  readonly needsRehash: boolean
  readonly valid: boolean
}>

/**
 * 按哈希串前缀分派验证：`$scrypt$` 走 scrypt，其余按旧 PBKDF2 兼容验证。
 * 旧格式验证通过即 needsRehash=true，调用方在登录请求内重哈希写回。
 */
export const verifyPassword = async (
  password: string,
  stored: Readonly<Pick<StoredCredentials, "hash" | "salt">>,
): Promise<PasswordVerification> => {
  const scryptHash = parseScryptHash(stored.hash)
  if (scryptHash !== null) {
    const key = await scryptAsync(password, scryptHash.salt, scryptHash)
    const valid =
      key.length === scryptHash.key.length && crypto.timingSafeEqual(key, scryptHash.key)
    return { needsRehash: false, valid }
  }
  const legacy = await verifyPasswordLegacy(password, stored)
  return { needsRehash: legacy, valid: legacy }
}

const verifyPasswordLegacy = async (
  password: string,
  stored: Readonly<Pick<StoredCredentials, "hash" | "salt">>,
): Promise<boolean> => {
  if (stored.salt.length === 0 || stored.hash.length === 0) return false
  if (stored.hash.startsWith(SCRYPT_PREFIX)) return false
  return verifyLegacyPbkdf2(password, stored)
}
