import { describe, expect, it } from "vitest"

import { intakeJobIdOf } from "../src/index.js"

describe("intakeJobIdOf", () => {
  it("derives one stable colon-free job id per intake item", () => {
    expect(intakeJobIdOf(42)).toBe("intake-42")
    expect(intakeJobIdOf(42)).toBe(intakeJobIdOf(42))
    expect(intakeJobIdOf(42)).not.toContain(":")
  })

  it("rejects invalid intake ids", () => {
    expect(() => intakeJobIdOf(0)).toThrow(TypeError)
    expect(() => intakeJobIdOf(1.5)).toThrow(TypeError)
  })
})
