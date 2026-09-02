import { describe, expect, it } from "vitest"

import {
  CONSOLE_NEXT_HEADER,
  normalizeConsoleNext,
  shouldForwardConsoleNext,
} from "../../src/console/lib/console-next"

describe("Console login return location", () => {
  it("keeps ordinary Console deep links and their query string", () => {
    expect(normalizeConsoleNext("/admin")).toBe("/admin")
    expect(normalizeConsoleNext("/admin/collections/content-editions?status=draft&page=2")).toBe(
      "/admin/collections/content-editions?status=draft&page=2",
    )
    expect(shouldForwardConsoleNext("/admin/collections/content-editions?status=draft&page=2")).toBe(
      true,
    )
  })

  it("rejects external, malformed, non-Console, and excluded destinations", () => {
    for (const value of [
      null,
      "",
      "https://evil.example",
      "//evil.example",
      "/administrator",
      "/admin\\evil",
      "/admin/%5Cevil",
      "/admin/login",
      "/admin/forgot-password",
      "/admin/reset-password",
      "/admin/_emergency/collections/users",
      "/console/work",
    ]) {
      expect(normalizeConsoleNext(value)).toBe("/admin")
    }
  })

  it("does not forward route trees with their own authentication boundary", () => {
    expect(shouldForwardConsoleNext("/admin/login")).toBe(false)
    expect(shouldForwardConsoleNext("/admin/_emergency")).toBe(false)
    expect(shouldForwardConsoleNext("/admin/workspace/editions/572")).toBe(false)
    expect(normalizeConsoleNext("/admin/workspace/editions/572")).toBe(
      "/admin/workspace/editions/572",
    )
  })

  it("keeps the internal request header name stable", () => {
    expect(CONSOLE_NEXT_HEADER).toBe("x-gf-console-next")
  })
})
