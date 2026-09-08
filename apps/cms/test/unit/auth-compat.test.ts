import crypto from "node:crypto"

import { SignJWT } from "jose"
import { describe, expect, it } from "vitest"

import {
  apiKeyFromAuthorization,
  type StoredCredentials,
  payloadApiKeyIndexesOf,
  payloadSigningKeyOf,
  verifyPasswordCompat,
  verifySessionTokenCompat,
} from "../../src/server/auth/compat"

/* 与 Payload generatePasswordSaltHash 相同参数的自产凭据。 */
const credentialsOf = async (password: string): Promise<StoredCredentials> => {
  const salt = crypto.randomBytes(32).toString("hex")
  const hash = await new Promise<Buffer>((resolve, reject) => {
    crypto.pbkdf2(password, salt, 25_000, 512, "sha256", (error, hashRaw) => {
      if (error !== null) reject(error)
      else resolve(hashRaw)
    })
  })
  return { hash: hash.toString("hex"), salt }
}

describe("auth compat: password", () => {
  it("Given Payload-shaped credentials, when verifying the right password, then it matches", async () => {
    const stored = await credentialsOf("gf-root-001")
    await expect(verifyPasswordCompat("gf-root-001", stored)).resolves.toBe(true)
  })

  it("Given a wrong password, when verifying, then it is rejected", async () => {
    const stored = await credentialsOf("gf-root-001")
    await expect(verifyPasswordCompat("gf-root-000", stored)).resolves.toBe(false)
  })

  it("Given empty stored fields, when verifying, then it refuses instead of hashing", async () => {
    await expect(verifyPasswordCompat("x", { hash: "", salt: "" })).resolves.toBe(false)
  })
})

describe("auth compat: API key", () => {
  const configSecret = "mk-dev-test-secret-must-be-long-enough"

  it("derives current SHA-256 and legacy SHA-1 indexes with Payload's signing key", () => {
    const key = "worker-key-1"
    const signingKey = payloadSigningKeyOf(configSecret)
    expect(payloadApiKeyIndexesOf(key, configSecret)).toEqual([
      crypto.createHmac("sha1", signingKey).update(key).digest("hex"),
      crypto.createHmac("sha256", signingKey).update(key).digest("hex"),
    ])
  })

  it("strictly parses only the users API-Key authorization contract", () => {
    expect(apiKeyFromAuthorization("users API-Key abc123")).toBe("abc123")
    expect(apiKeyFromAuthorization("users Bearer abc123")).toBeNull()
    expect(apiKeyFromAuthorization("sites API-Key abc123")).toBeNull()
    expect(apiKeyFromAuthorization("users API-Key ")).toBeNull()
    expect(apiKeyFromAuthorization(null)).toBeNull()
  })
})

describe("auth compat: session token", () => {
  const configSecret = "mk-dev-test-secret-must-be-long-enough"
  // 签发端模拟 Payload 3.88：实际密钥是 sha256(configSecret).hex 前 32 字符。
  const signingKey = payloadSigningKeyOf(configSecret)
  const signToken = (claims: Record<string, unknown>, key = signingKey) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(new TextEncoder().encode(key))

  it("Given a Payload-signed token, when verifying with the same secret, then claims resolve", async () => {
    const token = await signToken({ collection: "users", email: "a@b.c", id: 416 })
    const claims = await verifySessionTokenCompat(token, configSecret)
    expect(claims?.["collection"]).toBe("users")
    expect(claims?.["id"]).toBe(416)
    expect(typeof claims?.exp).toBe("number")
  })

  it("Given a token signed with another secret, when verifying, then it is rejected", async () => {
    const token = await signToken({ id: 1 }, payloadSigningKeyOf("attacker-secret-x"))
    await expect(verifySessionTokenCompat(token, configSecret)).resolves.toBeNull()
  })

  it("Given a token signed with the raw config secret (no derivation), when verifying, then it is rejected", async () => {
    // 防回归：密钥派生规则一旦丢失，用原文签的 token 会「意外通过」或校验错位。
    const token = await signToken({ id: 1 }, configSecret)
    await expect(verifySessionTokenCompat(token, configSecret)).resolves.toBeNull()
  })

  it("Given an expired token, when verifying, then it is rejected", async () => {
    const token = await new SignJWT({ id: 1 })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 800_000)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1000)
      .sign(new TextEncoder().encode(signingKey))
    await expect(verifySessionTokenCompat(token, configSecret)).resolves.toBeNull()
  })

  it("Given garbage input, when verifying, then it is rejected without throwing", async () => {
    await expect(verifySessionTokenCompat("not-a-jwt", configSecret)).resolves.toBeNull()
  })
})
