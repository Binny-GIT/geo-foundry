import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"

import { loadTenantKeyring, runForTenant, tenantClientProxy } from "../../src/config/tenant-keyring.js"

const fixtureOf = async (content: string): Promise<{
  readonly cleanup: () => Promise<void>
  readonly environment: Record<string, string>
}> => {
  const directory = await mkdtemp(join(tmpdir(), "geo-foundry-worker-keyring-"))
  const path = join(directory, "content-service-keyring.json")
  await writeFile(path, content, { mode: 0o600 })
  await chmod(path, 0o600)
  return {
    cleanup: () => rm(directory, { force: true, recursive: true }),
    environment: { CONTENT_SERVICE_KEYRING_FILE: path },
  }
}

const operationResponse = () =>
  new Response(
    JSON.stringify({
      operation: {
        attempt: 1,
        currentStage: null,
        endpoint: "/internal/operations/generate",
        error: null,
        operationId: "11111111-2222-3333-4444-555555555555",
        operationType: "generate",
        requestPayload: {},
        result: null,
        state: "queued",
        tenantId: 7,
      },
    }),
    { status: 200 },
  )

describe("Worker tenant keyring", () => {
  it("loads owner-only tenant keys and selects the scoped client", async () => {
    const fixture = await fixtureOf(JSON.stringify({ tenants: { "7": "key-seven", "8": "key-eight" } }))
    const originalFetch = globalThis.fetch
    const authorization: string[] = []
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      authorization.push(new Headers(init?.headers).get("authorization") ?? "")
      return operationResponse()
    }) as typeof globalThis.fetch
    try {
      const client = tenantClientProxy(loadTenantKeyring(fixture.environment), "http://cms.test")
      expect(() => client.getOperation("11111111-2222-3333-4444-555555555555")).toThrow(
        "WORKER_TENANT_CLIENT_UNAVAILABLE",
      )
      await runForTenant(7, async () => client.getOperation("11111111-2222-3333-4444-555555555555"))
      await runForTenant(8, async () => client.getOperation("11111111-2222-3333-4444-555555555555"))
      expect(authorization).toEqual(["users API-Key key-seven", "users API-Key key-eight"])
    } finally {
      globalThis.fetch = originalFetch
      await fixture.cleanup()
    }
  })

  it("rejects malformed keyrings", async () => {
    const fixture = await fixtureOf("not-json")
    try {
      expect(() => loadTenantKeyring(fixture.environment)).toThrow("WORKER_CONTENT_SERVICE_KEYRING_INVALID")
    } finally {
      await fixture.cleanup()
    }
  })
})
