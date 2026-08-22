import { StalePointerEtagError } from "@geo/publisher"
import { describe, expect, it } from "vitest"

import { terminalPublishErrorOf } from "../../src/processors/triggers.js"

describe("publish gate error classification", () => {
  it("terminalizes a stale pointer CAS conflict", () => {
    const terminal = terminalPublishErrorOf(
      new StalePointerEtagError('"expected"' as never, '"actual"' as never),
    )

    expect(terminal).toMatchObject({
      code: "ARTIFACT_STORE_POINTER_ETAG_STALE",
      name: "TerminalJobError",
    })
  })

  it("leaves ordinary storage failures retryable", () => {
    expect(terminalPublishErrorOf(new Error("temporary S3 failure"))).toBeNull()
  })
})
