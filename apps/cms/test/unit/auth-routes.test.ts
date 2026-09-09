import { describe, expect, it } from "vitest"

import { sessionTokenFromCookie } from "../../src/server/auth/session"
import { authCookie, compatAuthRouteOf } from "../../src/server/routes/auth"

describe("旧认证路由表面", () => {
  it("serializes the primary gf-session cookie and expires both cookie names", () => {
    const expiresAt = Math.floor(Date.parse("2026-09-15T00:00:00.000Z") / 1000)
    expect(authCookie.cookieOf("token-value", expiresAt)).toBe(
      "gf-session=token-value; Expires=Tue, 15 Sep 2026 00:00:00 GMT; Path=/; HttpOnly=true; SameSite=Lax",
    )
    expect(authCookie.expiredCookies()).toHaveLength(2)
    for (const expired of authCookie.expiredCookies()) {
      expect(expired).toContain("Path=/")
      expect(expired).toContain("HttpOnly=true")
      expect(expired).toContain("SameSite=Lax")
    }
    expect(authCookie.expiredCookies()[0]).toContain("gf-session=")
    expect(authCookie.expiredCookies()[1]).toContain("payload-token=")
  })

  it("prefers gf-session and falls back to the legacy cookie", () => {
    expect(sessionTokenFromCookie("payload-token=legacy-value")).toBe("legacy-value")
    expect(sessionTokenFromCookie("payload-token=legacy-value; gf-session=current-value")).toBe(
      "current-value",
    )
    expect(sessionTokenFromCookie(null)).toBeNull()
  })

  it("claims the migrated auth routes and leaves users CRUD to legacy fallback", () => {
    expect(compatAuthRouteOf("GET", ["users", "me"])).toBe("me")
    expect(compatAuthRouteOf("POST", ["users", "forgot-password"])).toBe("forgot-password")
    expect(compatAuthRouteOf("POST", ["users", "login"])).toBe("login")
    expect(compatAuthRouteOf("POST", ["users", "logout"])).toBe("logout")
    expect(compatAuthRouteOf("POST", ["users", "refresh-token"])).toBeNull()
    expect(compatAuthRouteOf("POST", ["users", "reset-password"])).toBe("reset-password")
    expect(compatAuthRouteOf("POST", ["account", "password"])).toBe("account-password")
    expect(compatAuthRouteOf("GET", ["users"])).toBeNull()
    expect(compatAuthRouteOf("GET", ["users", "123"])).toBeNull()
  })
})
