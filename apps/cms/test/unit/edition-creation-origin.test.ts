import { beforeEach, describe, expect, it, vi } from "vitest"

import { contentEditions, editionVersions } from "../../src/server/db/edition-schema"
import { sites } from "../../src/server/db/entity-schema"

const state = vi.hoisted(() => ({
  root: null as null | Record<string, unknown>,
  versions: [] as Record<string, unknown>[],
}))

const db = {
  transaction: async (run: (tx: unknown) => Promise<unknown>) => run(db),
  execute: async () => [],
  select: (selection: Record<string, unknown>) => {
    let table: unknown
    const rows = () => {
      if (table === sites) return [{ id: 7, tenantId: 4 }]
      if (table === contentEditions) {
        if ("version" in selection) {
          const version = state.versions.findLast((row) => row["latest"])
          return version === undefined ? [] : [{ editionId: 42, version }]
        }
        return state.root === null ? [] : [{ editionId: 42 }]
      }
      return []
    }
    const query = {
      from(value: unknown) {
        table = value
        return query
      },
      innerJoin: () => query,
      where: () => query,
      orderBy: () => query,
      offset: () => query,
      limit: () => query,
      // biome-ignore lint/suspicious/noThenProperty: 模拟 Drizzle 可等待的查询构建器。
      then: (resolve: (result: ReturnType<typeof rows>) => unknown) =>
        Promise.resolve(resolve(rows())),
    }
    return query
  },
  insert: (table: unknown) => ({
    values: (values: Record<string, unknown>) => ({
      returning: async () => {
        if (table === contentEditions) {
          state.root = { ...values, id: 42 }
          return [{ id: 42 }]
        }
        state.versions.push({ ...values, id: state.versions.length + 1, updatedAt: new Date() })
        return [{ id: state.versions.length }]
      },
    }),
  }),
  update: (table: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: async () => {
        if (table === editionVersions) {
          const version = state.versions.findLast((row) => row["latest"])
          if (version !== undefined) Object.assign(version, values)
        }
        if (table === contentEditions && state.root !== null) Object.assign(state.root, values)
      },
    }),
  }),
}

vi.mock("../../src/server/runtime", () => ({ serverRuntime: () => ({ db }) }))
vi.mock("../../src/server/auth/session", () => ({
  authenticateRequest: async () => ({
    claims: { kind: "user", role: "editor", tenantId: 4, userId: "7" },
    session: null,
    siteIds: [],
    user: {},
  }),
}))
vi.mock("../../src/server/repositories/entities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/server/repositories/entities")>()),
  entityScopeOf: () => ({ kind: "tenant", tenantId: 4 }),
}))
vi.mock("../../src/server/repositories/edition-sites", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/server/repositories/edition-sites")>()),
  syncEditionSitesWithinTx: async () => undefined,
}))

import { handleEditionDraftGet } from "../../src/server/routes/edition-reads"
import {
  handleEditionDraftPatch,
  handleEditionDraftPost,
} from "../../src/server/routes/edition-writes"

const request = (method: "POST" | "PATCH", body: unknown) =>
  new Request(
    `http://local/api/content-editions${method === "PATCH" ? "/42" : ""}?draft=true&depth=0`,
    {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method,
    },
  )

describe("edition creationOrigin writes", () => {
  beforeEach(() => {
    state.root = null
    state.versions = []
  })

  it("persists hybrid in both tables on create and exposes it in GET draft", async () => {
    const response = await handleEditionDraftPost(
      request("POST", { site: 7, creationOrigin: "hybrid" }),
      ["content-editions"],
    )
    expect(response?.status).toBe(201)
    expect(state.root?.["creationOrigin"]).toBe("hybrid")
    expect(state.versions[0]?.["creationOrigin"]).toBe("hybrid")
    const read = await handleEditionDraftGet(
      new Request("http://local/api/content-editions/42?draft=true&depth=0"),
      ["content-editions", "42"],
    )
    expect((await read?.json())?.creationOrigin).toBe("hybrid")
  })

  it("persists a human-to-hybrid patch on root and newest revision", async () => {
    await handleEditionDraftPost(request("POST", { site: 7 }), ["content-editions"])
    const response = await handleEditionDraftPatch(request("PATCH", { creationOrigin: "hybrid" }), [
      "content-editions",
      "42",
    ])
    expect(response?.status).toBe(200)
    expect(state.root?.["creationOrigin"]).toBe("hybrid")
    expect(state.versions).toHaveLength(2)
    expect(state.versions[1]?.["creationOrigin"]).toBe("hybrid")
    expect(state.versions[1]?.["contentModifiedAt"]).toEqual(
      state.versions[0]?.["contentModifiedAt"],
    )
    expect(state.versions[1]?.["workflowRevision"]).toBe(state.versions[0]?.["workflowRevision"])
  })

  it("rejects an invalid origin with the write validation status", async () => {
    const response = await handleEditionDraftPost(
      request("POST", { site: 7, creationOrigin: "robot" }),
      ["content-editions"],
    )
    expect(response?.status).toBe(400)
    expect(state.root).toBeNull()
  })

  it("rejects an invalid origin on PATCH without creating a revision", async () => {
    await handleEditionDraftPost(request("POST", { site: 7 }), ["content-editions"])
    const response = await handleEditionDraftPatch(request("PATCH", { creationOrigin: "robot" }), [
      "content-editions",
      "42",
    ])
    expect(response?.status).toBe(400)
    expect(state.versions).toHaveLength(1)
  })

  it("preserves an existing origin when PATCH omits the field", async () => {
    await handleEditionDraftPost(request("POST", { site: 7, creationOrigin: "hybrid" }), [
      "content-editions",
    ])
    const response = await handleEditionDraftPatch(request("PATCH", { title: "新标题" }), [
      "content-editions",
      "42",
    ])
    expect(response?.status).toBe(200)
    expect(state.root?.["creationOrigin"]).toBe("hybrid")
    expect(state.versions[1]?.["creationOrigin"]).toBe("hybrid")
  })

  it("keeps the plain-create human default when the field is absent", async () => {
    const response = await handleEditionDraftPost(request("POST", { site: 7 }), [
      "content-editions",
    ])
    expect(response?.status).toBe(201)
    expect(state.root?.["creationOrigin"]).toBe("human")
  })
})
