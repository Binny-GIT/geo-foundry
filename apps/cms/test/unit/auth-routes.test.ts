import { describe, expect, it } from "vitest"

import { authCookie, handleUsersAuthGet, handleUsersAuthPost } from "../../src/server/routes/auth"

describe("compat auth route surface", () => {
  it("serializes the exact Payload cookie name and attributes", () => {
    const expiresAt = Math.floor(Date.parse("2026-09-15T00:00:00.000Z") / 1000)
    expect(authCookie.cookieOf("token-value", expiresAt)).toBe(
      "payload-token=token-value; Expires=Tue, 15 Sep 2026 00:00:00 GMT; Path=/; HttpOnly=true; SameSite=Lax",
    )
    const expired = authCookie.expiredCookie()
    expect(expired).toContain("payload-token=")
    expect(expired).toContain("Path=/")
    expect(expired).toContain("HttpOnly=true")
    expect(expired).toContain("SameSite=Lax")
  })

  it("only claims login/logout/me and leaves other users routes to Payload fallback", async () => {
    const request = new Request("https://example.test/api/users/forgot-password")
    await expect(handleUsersAuthGet(request, ["users", "forgot-password"])).resolves.toBeNull()
    await expect(handleUsersAuthPost(request, ["users", "forgot-password"])).resolves.toBeNull()
    await expect(handleUsersAuthGet(request, ["users"])).resolves.toBeNull()
    await expect(handleUsersAuthPost(request, ["users", "reset-password"])).resolves.toBeNull()
  })
})
