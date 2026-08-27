import { describe, expect, it } from "vitest"

import {
  CONSOLE_RESOURCES,
  VISIBLE_RESOURCE_SLUGS,
  consoleRoute,
  isConsoleResourceSlug,
} from "../../src/console/lib/resources"

describe("Console resource registry", () => {
  it("Given the human Console, when resources are registered, then all 14 visible collections have an entry", () => {
    expect(VISIBLE_RESOURCE_SLUGS).toHaveLength(14)
    expect(Object.keys(CONSOLE_RESOURCES).sort()).toEqual([...VISIBLE_RESOURCE_SLUGS].sort())
  })

  it("Given service-owned diagnostic collections, when validating a Console path, then they are rejected", () => {
    expect(isConsoleResourceSlug("outbox-events")).toBe(false)
    expect(isConsoleResourceSlug("idempotency-records")).toBe(false)
    expect(isConsoleResourceSlug("reviewer-edition-decision-idempotency")).toBe(false)
  })

  it("Given a resource route, when it is generated, then it owns the public admin namespace", () => {
    expect(consoleRoute.dashboard).toBe("/admin")
    expect(consoleRoute.login).toBe("/admin/login")
    expect(consoleRoute.collection("content-editions")).toBe("/admin/collections/content-editions")
  })

  it("Given a list with relationship columns, when defining its display contract, then relationships are hydrated rather than rendered as IDs", () => {
    expect(CONSOLE_RESOURCES["content-editions"].relationshipColumns).toContain("site")
    expect(CONSOLE_RESOURCES.releases.relationshipColumns).toContain("site")
    expect(CONSOLE_RESOURCES.contents.relationshipColumns).toBeUndefined()
  })
})
