import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const root = resolve(import.meta.dirname, "../..")
const sourceOf = (path: string): Promise<string> => readFile(resolve(root, path), "utf8")

describe("Console human session contract", () => {
  it("sets human browser sessions to seven days and keeps the users API-Key strategy", async () => {
    const [authRoute, users] = await Promise.all([
      sourceOf("src/server/routes/auth.ts"),
      sourceOf("src/server/repositories/users.ts"),
    ])

    expect(authRoute).toContain("7 * 24 * 60 * 60")
    expect(users).toContain("findAuthByApiKey")
  })

  it("uses compat-verified active sessions for human Console guards and normalizes invalid return locations", async () => {
    const [session, compat, next] = await Promise.all([
      sourceOf("src/console/lib/session.server.ts"),
      sourceOf("src/server/auth/session.ts"),
      sourceOf("src/console/lib/console-next.ts"),
    ])

    expect(session).toContain("authenticateRequest(await headers())")
    expect(session).not.toContain("payload.auth(")
    expect(compat).toContain("verifySessionTokenCompat")
    expect(compat).toContain("hasActiveSession")
    expect(session).toContain("isHumanConsoleSession")
    expect(session).toContain("session.role !== CMS_ROLE.CONTENT_SERVICE")
    expect(session).toContain("encodeURIComponent(normalizeConsoleNext(next))")
    expect(next).toContain('pathname === "/admin/login"')
    expect(next).toContain('pathname === "/admin" || pathname.startsWith("/admin/")')
  })

  it("forwards only an internally normalized Console deep link into the authenticated layout", async () => {
    const [proxy, layout] = await Promise.all([
      sourceOf("src/proxy.ts"),
      sourceOf("src/app/(console)/admin/(authenticated)/layout.tsx"),
    ])

    expect(proxy).toContain('matcher: ["/admin/:path*"]')
    expect(proxy).toContain("requestHeaders.delete(CONSOLE_NEXT_HEADER)")
    expect(proxy).toContain("requestHeaders.set(CONSOLE_NEXT_HEADER, next)")
    expect(proxy).not.toContain("getPayload")
    expect(proxy).not.toContain("payload.auth")
    expect(layout).toContain("headers()")
    expect(layout).toContain("requestHeaders.get(CONSOLE_NEXT_HEADER)")
    expect(layout).toContain("requireConsoleSession(")
  })

  it("derives the Console data scope from the verified compat session, never from Payload", async () => {
    const consoleContext = await sourceOf("src/console/lib/console-context.server.ts")

    expect(consoleContext).toContain("isHumanConsoleSession")
    expect(consoleContext).toContain("if (!isHumanConsoleSession(session)")
    expect(consoleContext).toContain("entityScopeFor(")
    expect(consoleContext).not.toContain("getPayload")
    expect(consoleContext).not.toContain("payload.auth(")
  })

  it("only redirects an existing human session from login to the dashboard", async () => {
    const login = await sourceOf("src/app/(console)/admin/login/page.tsx")

    expect(login).toContain("getConsoleSession, isHumanConsoleSession")
    expect(login).toContain("if (isHumanConsoleSession(session)) redirect(consoleRoute.dashboard)")
    expect(login).not.toContain("if (session !== null) redirect(consoleRoute.dashboard)")
  })

  it("keeps Worker service authentication on the independent users API-Key strategy", async () => {
    const client = await sourceOf("../../packages/content-client/src/client.ts")

    expect(client).toContain("users API-Key")
  })
})
