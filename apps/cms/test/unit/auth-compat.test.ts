import crypto from "node:crypto"

import { SignJWT } from "jose"
import { describe, expect, it } from "vitest"

import {
  apiKeyFromAuthorization,
  apiKeyIndexesOf,
  derivedAuthKeyOf,
  type StoredCredentials,
  verifyLegacyPbkdf2,
  verifySessionToken,
} from "../../src/server/auth/compat"
import {
  issueSessionToken,
  SESSION_TOKEN_EXPIRATION_SECONDS,
} from "../../src/server/auth/session-token"

/* 使用旧 PBKDF2 参数在测试内生成凭据 fixture。 */
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

describe("旧认证格式：密码", () => {
  it("Given 旧 PBKDF2 凭据, when verifying the right password, then it matches", async () => {
    const stored = await credentialsOf("gf-root-001")
    await expect(verifyLegacyPbkdf2("gf-root-001", stored)).resolves.toBe(true)
  })

  it("Given a wrong password, when verifying, then it is rejected", async () => {
    const stored = await credentialsOf("gf-root-001")
    await expect(verifyLegacyPbkdf2("gf-root-000", stored)).resolves.toBe(false)
  })

  it("Given empty stored fields, when verifying, then it refuses instead of hashing", async () => {
    await expect(verifyLegacyPbkdf2("x", { hash: "", salt: "" })).resolves.toBe(false)
  })
})

describe("旧认证格式：API key", () => {
  const configSecret = "mk-dev-test-secret-must-be-long-enough"

  it("derives current SHA-256 and legacy SHA-1 indexes with the derived signing key", () => {
    const key = "worker-key-1"
    const signingKey = derivedAuthKeyOf(configSecret)
    expect(apiKeyIndexesOf(key, configSecret)).toEqual([
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

describe("旧认证格式：会话令牌", () => {
  const configSecret = "mk-dev-test-secret-must-be-long-enough"

  it("issues the seven-day token with the preserved JWT claims", async () => {
    const before = Math.floor(Date.now() / 1000)
    const session = await issueSessionToken({
      configSecret,
      email: "a@b.c",
      sid: "session-1",
      userId: 416,
    })
    const claims = await verifySessionToken(session.token, configSecret)

    expect(session.expiresAt).toBeGreaterThanOrEqual(before + SESSION_TOKEN_EXPIRATION_SECONDS)
    expect(session.expiresAt).toBeLessThanOrEqual(before + SESSION_TOKEN_EXPIRATION_SECONDS + 1)
    expect(claims).toMatchObject({ collection: "users", email: "a@b.c", id: 416, sid: "session-1" })
  })

  // 签发端模拟旧认证格式：实际密钥是 sha256(configSecret).hex 前 32 字符。
  const signingKey = derivedAuthKeyOf(configSecret)
  const signToken = (claims: Record<string, unknown>, key = signingKey) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(new TextEncoder().encode(key))

  it("Given a legacy-format token, when verifying with the same secret, then claims resolve", async () => {
    const token = await signToken({ collection: "users", email: "a@b.c", id: 416 })
    const claims = await verifySessionToken(token, configSecret)
    expect(claims?.["collection"]).toBe("users")
    expect(claims?.["id"]).toBe(416)
    expect(typeof claims?.exp).toBe("number")
  })

  it("Given a token signed with another secret, when verifying, then it is rejected", async () => {
    const token = await signToken({ id: 1 }, derivedAuthKeyOf("attacker-secret-x"))
    await expect(verifySessionToken(token, configSecret)).resolves.toBeNull()
  })

  it("Given a token signed with the raw config secret (no derivation), when verifying, then it is rejected", async () => {
    // 防回归：密钥派生规则一旦丢失，用原文签的 token 会「意外通过」或校验错位。
    const token = await signToken({ id: 1 }, configSecret)
    await expect(verifySessionToken(token, configSecret)).resolves.toBeNull()
  })

  it("Given an expired token, when verifying, then it is rejected", async () => {
    const token = await new SignJWT({ id: 1 })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 800_000)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1000)
      .sign(new TextEncoder().encode(signingKey))
    await expect(verifySessionToken(token, configSecret)).resolves.toBeNull()
  })

  it("Given garbage input, when verifying, then it is rejected without throwing", async () => {
    await expect(verifySessionToken("not-a-jwt", configSecret)).resolves.toBeNull()
  })
})
