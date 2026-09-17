import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import {
  INTEGRATION_OPERATIONS,
  integrationOpenApiDocument,
} from "../../src/endpoints/integration/openapi"
import { deliveryRouteOf } from "../../src/server/routes/delivery"
import { SUPPORTED as ENTITY_LIST_COLLECTIONS } from "../../src/server/routes/entity-reads"
import { intakeOpsActionOf } from "../../src/server/routes/intake-ops"
import { integrationOpenApiRouteOf } from "../../src/server/routes/integration-openapi"

const contractsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../contracts")
const apiRouteSourcePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../src/app/(api)/api/[...slug]/route.ts",
)

const stableStringify = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

type PathItem = Record<string, { operationId: string; responses?: unknown; security?: unknown }>

const pathItems = integrationOpenApiDocument.paths as Record<string, PathItem>

describe("integration API contract", () => {
  it("keeps the OpenAPI document in sync with the declared operation table", () => {
    const documented = INTEGRATION_OPERATIONS.map((operation) => {
      const pathItem = pathItems[operation.path]
      expect(pathItem, `openapi path ${operation.path}`).toBeDefined()
      expect(pathItem?.[operation.method]?.operationId).toBe(operation.operationId)
      return `${operation.method.toUpperCase()} ${operation.path}`
    })
    const allDocumented = Object.entries(pathItems).flatMap(([path, pathItem]) =>
      Object.entries(pathItem).map(([method]) => `${method.toUpperCase()} ${path}`),
    )
    expect(allDocumented.sort()).toEqual([...documented].sort())
    expect(Object.keys(pathItems).every((path) => !path.includes(":"))).toBe(true)
  })

  it("maps every documented path onto the real route recognizers", () => {
    expect(intakeOpsActionOf(["intake-operations"])).toBe("create")
    expect(integrationOpenApiRouteOf(["integration", "openapi.json"])).toBe(true)
    expect(deliveryRouteOf(["delivery", "sites", "www.example.com", "articles"])).toBe("articles")
    expect(deliveryRouteOf(["delivery", "articles", "123"])).toBe("article")
    expect(ENTITY_LIST_COLLECTIONS).toHaveProperty("sites")
    expect(ENTITY_LIST_COLLECTIONS).toHaveProperty("connectors")
    /* 反例：文档没有声明任何真实路由不认识的路径。 */
    expect(intakeOpsActionOf(["intake-operations", "1", "adopt"])).not.toBeNull()
    expect(deliveryRouteOf(["delivery", "tenants"])).toBeNull()
  })

  it("wires the document endpoint into the API gateway", async () => {
    const source = await readFile(apiRouteSourcePath, "utf8")
    expect(source).toMatch(/import \{ handleIntegrationOpenApiGet \}/)
    expect(source).toMatch(/\["integration-openapi-get", \(\) => handleIntegrationOpenApiGet/)
  })

  it("documents the security boundary: intake/reference authenticated, delivery public, adopt forbidden", () => {
    for (const path of ["/intake-operations", "/sites", "/connectors"]) {
      const operations = Object.values(pathItems[path] ?? {})
      expect(operations.length).toBeGreaterThan(0)
      for (const operation of operations) {
        expect(operation.security).toEqual([{ usersApiKey: [] }])
      }
    }
    for (const path of ["/delivery/sites/{domain}/articles", "/delivery/articles/{id}"]) {
      for (const operation of Object.values(pathItems[path] ?? {})) {
        expect(operation.security).toBeUndefined()
      }
    }
    const create = pathItems["/intake-operations"]?.["post"]
    expect(create?.responses).toHaveProperty("403")
    expect(JSON.stringify(integrationOpenApiDocument.info.description)).toContain("不能采纳成草稿")
  })

  it("commits byte-stable OpenAPI fixtures", async () => {
    await mkdir(contractsDirectory, { recursive: true })
    const content = stableStringify(integrationOpenApiDocument)
    const filePath = resolve(contractsDirectory, "integration-openapi.json")
    if (process.env["CONTRACTS_UPDATE"] === "1") {
      await writeFile(filePath, content, "utf8")
      return
    }
    const committed = await readFile(filePath, "utf8").catch(() => null)
    expect(
      committed,
      `${filePath} is stale or missing - run CONTRACTS_UPDATE=1 pnpm --filter @geo/cms exec vitest run --configLoader runner test/unit/integration-contracts.test.ts to regenerate`,
    ).toBe(content)
  })
})
