import { describe, expect, it } from "vitest"
import {
  createFixedClock,
  createFixedHasher,
  parseSha256Hash,
  parseTenantId,
} from "../src/index.js"
import { hash } from "./fixtures.js"

describe("domain primitives", () => {
  it.each([null, 42, "", " tenant-1", "tenant-1 ", "x".repeat(129)])(
    "returns a typed boundary error for malformed identifier %j",
    (input) => {
      // Given / When
      const result = parseTenantId(input)

      // Then
      expect(result).toMatchObject({ error: { code: "INVALID_IDENTIFIER" }, ok: false })
    },
  )

  it("throws a typed boundary error for a malformed fixed instant", () => {
    // Given / When / Then
    expect(() => createFixedClock("17 August 2026")).toThrowError(
      expect.objectContaining({ code: "INVALID_INSTANT", name: "InvalidInstantError" }),
    )
  })

  it("returns a typed boundary error for a malformed hash", () => {
    // Given / When
    const result = parseSha256Hash("ABC")

    // Then
    expect(result).toMatchObject({ error: { code: "INVALID_HASH" }, ok: false })
  })

  it("uses an injected fixed hash without input-dependent output", () => {
    // Given
    const hasher = createFixedHasher(hash)

    // When
    const first = hasher.hash("first input")
    const second = hasher.hash("misleading different input")

    // Then
    expect(first).toBe(hash)
    expect(second).toBe(hash)
  })
})
