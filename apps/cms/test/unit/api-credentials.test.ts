/*
 * 集成密钥的纯逻辑约束：格式、展示前缀、与认证层共用的 HMAC 索引派生。
 * 落库与吊销的行为由 E2E 覆盖（需要真实数据库）。
 */

import { describe, expect, it } from "vitest"

import { apiKeyFromAuthorization, apiKeyIndexesOf } from "../../src/server/auth/compat"
import {
  API_KEY_PREFIX,
  displayPrefixOf,
  generateApiKey,
} from "../../src/server/repositories/api-credentials"

const SECRET = "test-secret-with-at-least-32-characters-长度足够"

describe("integration api key generation", () => {
  it("Given a generated key, when inspected, then it carries the scannable gfa_ prefix and 32 bytes of entropy", () => {
    const key = generateApiKey()
    expect(key.startsWith(API_KEY_PREFIX)).toBe(true)
    const body = key.slice(API_KEY_PREFIX.length)
    /* base64url of 32 bytes is 43 chars, no padding, URL-safe alphabet only. */
    expect(body).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it("Given many generated keys, when compared, then they are unique", () => {
    const keys = new Set(Array.from({ length: 200 }, () => generateApiKey()))
    expect(keys.size).toBe(200)
  })

  it("Given a generated key, when the display prefix is derived, then it reveals only the first 8 body chars", () => {
    const key = generateApiKey()
    const prefix = displayPrefixOf(key)
    expect(prefix).toHaveLength(API_KEY_PREFIX.length + 8)
    expect(key.startsWith(prefix)).toBe(true)
    /* 前缀必须远短于密钥本体，否则展示即泄漏。 */
    expect(prefix.length).toBeLessThan(key.length / 2)
  })
})

describe("integration api key indexing", () => {
  it("Given the same key and secret, when indexed twice, then the lookup index is stable", () => {
    const key = generateApiKey()
    const [, first] = apiKeyIndexesOf(key, SECRET)
    const [, second] = apiKeyIndexesOf(key, SECRET)
    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
  })

  it("Given different keys, when indexed, then the indexes differ", () => {
    const [, a] = apiKeyIndexesOf(generateApiKey(), SECRET)
    const [, b] = apiKeyIndexesOf(generateApiKey(), SECRET)
    expect(a).not.toBe(b)
  })

  it("Given a rotated secret, when the same key is indexed, then the index changes", () => {
    const key = generateApiKey()
    const [, withSecret] = apiKeyIndexesOf(key, SECRET)
    const [, withOther] = apiKeyIndexesOf(key, `${SECRET}-rotated`)
    expect(withSecret).not.toBe(withOther)
  })

  it("Given the stored index, when inspected, then it never contains the plaintext key", () => {
    const key = generateApiKey()
    const [sha1Index, sha256Index] = apiKeyIndexesOf(key, SECRET)
    expect(sha1Index).not.toContain(key)
    expect(sha256Index).not.toContain(key)
    expect(sha256Index).not.toContain(key.slice(API_KEY_PREFIX.length))
  })
})

describe("authorization header contract", () => {
  it("Given the documented header, when parsed, then the integration key is extracted verbatim", () => {
    const key = generateApiKey()
    expect(apiKeyFromAuthorization(`users API-Key ${key}`)).toBe(key)
  })

  it("Given a malformed or absent header, when parsed, then no key is extracted", () => {
    const key = generateApiKey()
    expect(apiKeyFromAuthorization(null)).toBeNull()
    expect(apiKeyFromAuthorization(`Bearer ${key}`)).toBeNull()
    expect(apiKeyFromAuthorization(`users api-key ${key}`)).toBeNull()
    expect(apiKeyFromAuthorization(key)).toBeNull()
  })
})
