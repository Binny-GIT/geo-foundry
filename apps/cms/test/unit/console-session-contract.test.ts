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

  it("uses Payload-verified sessions for human Console guards and routes invalid sessions to login", async () => {
    const session = await sourceOf("src/console/lib/session.server.ts")

    expect(session).toContain("payload.auth({ headers: await headers() })")
    expect(session).toContain("isHumanConsoleSession")
    expect(session).toContain("session.role !== CMS_ROLE.CONTENT_SERVICE")
    expect(session).toContain('redirect(`/admin/login?next=${encodeURIComponent(next)}`)')
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
