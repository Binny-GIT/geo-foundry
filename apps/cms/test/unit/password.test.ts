import crypto from "node:crypto"
import { describe, expect, it } from "vitest"

import { hashPassword, verifyPassword } from "../../src/server/auth/password"

/*
 * scrypt 密码哈希契约：
 * - 新哈希带 $scrypt$ 前缀，往返验证通过且不再需要 rehash；
 * - 旧 PBKDF2（Payload 兼容参数）验证通过且标记 needsRehash；
 * - 错误密码、损坏哈希串一律 false。
 */
const legacyCredentialsOf = async (password: string) => {
  const salt = crypto.randomBytes(32).toString("hex")
  const hash = await new Promise<Buffer>((resolve, reject) => {
    crypto.pbkdf2(password, salt, 25_000, 512, "sha256", (error, raw) => {
      if (error !== null) reject(error)
      else resolve(raw)
    })
  })
  return { hash: hash.toString("hex"), salt }
}

describe("password hashing (scrypt migration)", () => {
  it("round-trips a freshly hashed password with the scrypt prefix", async () => {
    const credentials = await hashPassword("correct horse battery staple")
    expect(credentials.hash.startsWith("$scrypt$131072,8,1$")).toBe(true)
    expect(credentials.salt).toMatch(/^[0-9a-f]{64}$/)
    const verification = await verifyPassword("correct horse battery staple", credentials)
    expect(verification).toEqual({ needsRehash: false, valid: true })
  })

  it("rejects a wrong password", async () => {
    const credentials = await hashPassword("right password")
    const verification = await verifyPassword("wrong password", credentials)
    expect(verification.valid).toBe(false)
  })

  it("verifies legacy PBKDF2 hashes and flags them for rehash", async () => {
    const legacy = await legacyCredentialsOf("legacy secret")
    const verification = await verifyPassword("legacy secret", legacy)
    expect(verification).toEqual({ needsRehash: true, valid: true })
    const wrong = await verifyPassword("other", legacy)
    expect(wrong).toEqual({ needsRehash: false, valid: false })
  })

  it("rejects malformed hash strings without throwing", async () => {
    const salt = "ab".repeat(32)
    for (const hash of ["", "$scrypt$", "$scrypt$not,numbers$aa$bb", "$scrypt$131072,8,1$zzzz$ffff", "00zz"]) {
      const verification = await verifyPassword("x", { hash, salt })
      expect(verification.valid).toBe(false)
    }
  })
})
