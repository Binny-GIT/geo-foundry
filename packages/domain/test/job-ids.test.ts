import { describe, expect, it } from "vitest"
import { operationJobIdOf, parseOperationId } from "../src/index.js"
import { operationId, unwrapResult } from "./fixtures.js"

describe("operationJobIdOf", () => {
  it("derives a deterministic colon-free jobId", () => {
    const id = unwrapResult(parseOperationId("op-260818-0001"))
    const first = operationJobIdOf(id, "generate-outline")
    const second = operationJobIdOf(id, "generate-outline")
    expect(first).toBe("op-op-260818-0001-generate-outline")
    expect(second).toBe(first)
    expect(first.includes(":")).toBe(false)
  })

  it("separates stages of the same operation", () => {
    expect(operationJobIdOf(operationId, "generate-outline")).not.toBe(
      operationJobIdOf(operationId, "generate-draft"),
    )
  })

  it("rejects malformed stages", () => {
    const id = unwrapResult(parseOperationId("op-260818-0002"))
    expect(() => operationJobIdOf(id, "bad stage")).toThrow(TypeError)
    expect(() => operationJobIdOf(id, "")).toThrow(TypeError)
    expect(() => operationJobIdOf(id, "UPPER")).toThrow(TypeError)
  })
})
