import { createHmac } from "node:crypto"
import { describe, expect, it } from "vitest"

import { verifyCrawlSignature } from "../../src/server/routes/crawl-callbacks"

describe("crawl 回调 HMAC", () => {
  const timestamp = "1800000000"
  const raw = '{"jobId":"job_1234567890abcdef"}'
  const signature = `sha256=${createHmac("sha256", "fixture-secret").update(`${timestamp}.${raw}`).digest("hex")}`

  it("Given a signed raw body, when checked within the window, then verification succeeds", () => {
    expect(
      verifyCrawlSignature("fixture-secret", timestamp, signature, raw, 1_800_000_000_000),
    ).toBe(true)
  })
  it("Given a stale timestamp, when checked, then verification fails", () => {
    expect(
      verifyCrawlSignature("fixture-secret", timestamp, signature, raw, 1_800_000_301_000),
    ).toBe(false)
  })
  it("Given a tampered body, when checked, then verification fails", () => {
    expect(
      verifyCrawlSignature("fixture-secret", timestamp, signature, `${raw} `, 1_800_000_000_000),
    ).toBe(false)
  })
  it("Given a wrong secret, when checked, then verification fails", () => {
    expect(verifyCrawlSignature("other-secret", timestamp, signature, raw, 1_800_000_000_000)).toBe(
      false,
    )
  })
  it("Given a bad signature prefix, when checked, then verification fails", () => {
    expect(
      verifyCrawlSignature(
        "fixture-secret",
        timestamp,
        signature.replace("sha256=", "sha512="),
        raw,
        1_800_000_000_000,
      ),
    ).toBe(false)
  })
})
