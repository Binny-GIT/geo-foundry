import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const root = resolve(import.meta.dirname, "../..")
const sourceOf = (path: string): Promise<string> => readFile(resolve(root, path), "utf8")

describe("Console human session contract", () => {
  it("sets Payload human JWT and HTTP-only browser sessions to seven days without disabling API keys", async () => {
    const users = await sourceOf("src/collections/Users.ts")

    expect(users).toContain("tokenExpiration: 7 * 24 * 60 * 60")
    expect(users).toContain("useAPIKey: true")
  })

  it("uses Payload-verified sessions for human Console guards and normalizes invalid return locations", async () => {
    const [session, next] = await Promise.all([
      sourceOf("src/console/lib/session.server.ts"),
      sourceOf("src/console/lib/console-next.ts"),
    ])

    expect(session).toContain("payload.auth({ headers: await headers() })")
    expect(session).toContain("isHumanConsoleSession")
    expect(session).toContain("session.role !== CMS_ROLE.CONTENT_SERVICE")
    expect(session).toContain("encodeURIComponent(normalizeConsoleNext(next))")
    expect(next).toContain("/admin/_emergency")
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

  it("keeps reusable Console data context limited to human browser sessions", async () => {
    const payloadContext = await sourceOf("src/console/lib/payload.server.ts")

    expect(payloadContext).toContain("isHumanConsoleSession")
    expect(payloadContext).toContain("if (!isHumanConsoleSession(session)")
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
