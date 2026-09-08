import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { editionVersionRouteOf } from "../../src/server/routes/edition-versions"

const root = resolve(import.meta.dirname, "../..")
const sourceOf = (path: string): Promise<string> => readFile(resolve(root, path), "utf8")

describe("edition version Drizzle routes", () => {
  it("claims only the exact history and restore routes", () => {
    expect(editionVersionRouteOf("GET", ["workspaces", "editions", "101", "version-history"])).toBe(
      "history",
    )
    expect(editionVersionRouteOf("POST", ["workspaces", "editions", "101", "restore-draft"])).toBe(
      "restore",
    )
    expect(editionVersionRouteOf("POST", ["workspaces", "editions", "101", "version-history"])).toBeNull()
    expect(editionVersionRouteOf("GET", ["workspaces", "editions", "101", "restore-draft"])).toBeNull()
    expect(editionVersionRouteOf("GET", ["content-editions", "101"])).toBeNull()
    expect(editionVersionRouteOf("GET", undefined)).toBeNull()
  })

  it("removes the Payload version endpoint and service registrations", async () => {
    const [config, gateway] = await Promise.all([
      sourceOf("src/payload.config.ts"),
      sourceOf("src/app/(payload)/api/[...slug]/route.ts"),
    ])
    expect(config).not.toContain("editionVersionHistoryEndpoint")
    expect(config).not.toContain("restoreEditionDraftEndpoint")
    expect(gateway).toContain("handleEditionVersionGet")
    expect(gateway).toContain("handleEditionVersionPost")
  })
})
