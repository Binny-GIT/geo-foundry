import { describe, expect, it } from "vitest"

import type { AuthenticatedRequest } from "../../src/server/auth/session"
import { entityScopeOf } from "../../src/server/repositories/entities"
import { parseEntityListQuery } from "../../src/server/routes/entity-reads"

const authOf = (
  role: AuthenticatedRequest["claims"]["role"],
  tenantId: number | null,
  siteIds: readonly number[] = [],
): AuthenticatedRequest => ({
  claims: {
    kind: role === "content-service" ? "service" : "user",
    role,
    tenantId,
    userId: "1",
  },
  session: null,
  siteIds,
  user: {
    createdAt: new Date("2026-09-08T00:00:00.000Z"),
    email: "a@b.c",
    enableAPIToken: false,
    hash: null,
    id: 1,
    lockUntil: null,
    loginAttempts: 0,
    role,
    salt: null,
    tenantId,
    updatedAt: new Date("2026-09-08T00:00:00.000Z"),
  },
})

describe("entity read scope", () => {
  it("keeps super-admin global and tenant roles tenant-scoped", () => {
    expect(entityScopeOf(authOf("super-admin", null))).toEqual({ kind: "global" })
    expect(entityScopeOf(authOf("editor", 413, [10, 11]))).toEqual({
      kind: "tenant",
      tenantId: 413,
    })
  })

  it("only applies users.sites as an explicit UI narrowing, not a collection boundary", () => {
    expect(entityScopeOf(authOf("editor", 413, [10, 11]), { applySiteScope: true })).toEqual({
      kind: "site",
      siteIds: [10, 11],
      tenantId: 413,
    })
  })

  it("rejects tenant-bound identities without a valid tenant", () => {
    expect(entityScopeOf(authOf("editor", null))).toBeNull()
  })
})

describe("Payload-compatible entity list query", () => {
  it("parses the current Console query shapes", () => {
    expect(
      parseEntityListQuery(
        new URL(
          "https://example.test/api/sites?depth=0&limit=100&sort=name&where[tenant][equals]=413",
        ),
      ),
    ).toEqual({ limit: 100, page: 1, sort: "name", tenantId: 413 })
    expect(
      parseEntityListQuery(
        new URL(
          "https://example.test/api/contents?limit=20&page=2&sort=-updatedAt&where[id][in]=1,2",
        ),
      ),
    ).toEqual({ ids: [1, 2], limit: 20, page: 2, sort: "-updatedAt" })
  })

  it("returns null for unsupported filters/depth so the gateway falls back to Payload", () => {
    expect(
      parseEntityListQuery(new URL("https://example.test/api/sites?where[status][equals]=active")),
    ).toBeNull()
    expect(parseEntityListQuery(new URL("https://example.test/api/sites?depth=1"))).toBeNull()
    expect(parseEntityListQuery(new URL("https://example.test/api/sites?limit=101"))).toBeNull()
    expect(parseEntityListQuery(new URL("https://example.test/api/sites?sort=status"))).toBeNull()
  })
})
