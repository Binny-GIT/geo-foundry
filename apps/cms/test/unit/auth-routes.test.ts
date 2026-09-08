import { describe, expect, it } from "vitest"

import { authCookie, compatAuthRouteOf } from "../../src/server/routes/auth"

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

  it("claims the migrated auth routes and leaves users CRUD to Payload fallback", () => {
    expect(compatAuthRouteOf("GET", ["users", "me"])).toBe("me")
    expect(compatAuthRouteOf("POST", ["users", "forgot-password"])).toBe("forgot-password")
    expect(compatAuthRouteOf("POST", ["users", "login"])).toBe("login")
    expect(compatAuthRouteOf("POST", ["users", "logout"])).toBe("logout")
    expect(compatAuthRouteOf("POST", ["users", "refresh-token"])).toBe("refresh")
    expect(compatAuthRouteOf("POST", ["users", "reset-password"])).toBe("reset-password")
    expect(compatAuthRouteOf("POST", ["account", "password"])).toBe("account-password")
    expect(compatAuthRouteOf("GET", ["users"])).toBeNull()
    expect(compatAuthRouteOf("GET", ["users", "123"])).toBeNull()
  })
})
