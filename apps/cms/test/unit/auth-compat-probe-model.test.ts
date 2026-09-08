import { describe, expect, it } from "vitest"

import { verifySessionTokenCompat } from "../../src/server/auth/compat"
import {
  issueCompatSessionToken,
  LOGIN_REJECTED_BODY,
} from "../../src/services/auth-compat-probe-model"

describe("auth compat probe model", () => {
  it("Given credentials, when issuing a compat session, then the token verifies through the compat layer", async () => {
    const configSecret = "probe-secret-that-is-long-enough-32chars"
    const session = await issueCompatSessionToken({
      configSecret,
      email: "gf-root-test@geo-foundry.dev",
      sid: "sid-1",
      userId: 1116,
    })
    const claims = await verifySessionTokenCompat(session.token, configSecret)
    expect(claims?.["id"]).toBe(1116)
    expect(claims?.["collection"]).toBe("users")
    expect(claims?.["email"]).toBe("gf-root-test@geo-foundry.dev")
    expect(claims?.["sid"]).toBe("sid-1")
    // 7 天有效期（允许 2 秒的取整误差）
    expect(claims?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000) + 604_700)
  })

  it("Given the login-rejected body, when inspecting, then it leaks no user-existence signal", () => {
    expect(LOGIN_REJECTED_BODY.error.code).toBe("AUTH_PROBE_LOGIN_REJECTED")
    expect(JSON.stringify(LOGIN_REJECTED_BODY)).not.toContain("user")
    expect(JSON.stringify(LOGIN_REJECTED_BODY)).not.toContain("email")
  })
})
