import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { allInternalEndpoints as internalEndpoints } from "../../src/endpoints/internal/index"
import { INTERNAL_OPERATIONS, internalOpenApiDocument } from "../../src/endpoints/internal/openapi"

const contractsDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/content-client/contracts",
)

const stableStringify = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

const openApiPathOf = (routePath: string): string =>
  routePath.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, "{$1}")

describe("internal API contract fixtures", () => {
  it("keeps the route table, internal endpoints, and OpenAPI document in sync", () => {
    expect(internalEndpoints).toHaveLength(INTERNAL_OPERATIONS.length)
    for (const operation of INTERNAL_OPERATIONS) {
      const endpoint = internalEndpoints.find(
        (candidate) => candidate.path === operation.path && candidate.method === operation.method,
      )
      expect(endpoint, `endpoint for ${operation.operationId}`).toBeDefined()
      const pathItem = internalOpenApiDocument.paths[openApiPathOf(operation.path)] as Record<
        string,
        { operationId: string; parameters?: readonly { $ref: string }[] }
      >
      expect(pathItem, `openapi path ${operation.path}`).toBeDefined()
      expect(pathItem[operation.method]?.operationId).toBe(operation.operationId)
      const parameters = pathItem[operation.method]?.parameters ?? []
      const hasId = operation.path.includes(":id")
      const hasOperationId = operation.path.includes(":operationId")
      expect(parameters.some((parameter) => parameter.$ref.endsWith("/ResourceId"))).toBe(hasId)
      expect(parameters.some((parameter) => parameter.$ref.endsWith("/OperationId"))).toBe(
        hasOperationId,
      )
      expect(parameters).toHaveLength(Number(hasId) + Number(hasOperationId))
    }
    const documentedOperations = Object.values(internalOpenApiDocument.paths).flatMap((pathItem) =>
      Object.values(pathItem as Record<string, { operationId: string }>).map(
        (method) => method.operationId,
      ),
    )
    expect(documentedOperations).toHaveLength(INTERNAL_OPERATIONS.length)
    expect(Object.keys(internalOpenApiDocument.paths).every((path) => !path.includes(":"))).toBe(
      true,
    )
  })

  it("commits byte-stable OpenAPI and client-operation fixtures", async () => {
    await mkdir(contractsDirectory, { recursive: true })
    const fixtures: Record<string, string> = {
      "client-operations.json": stableStringify({
        operations: [...INTERNAL_OPERATIONS].map((operation) => ({
          method: operation.method,
          operationId: operation.operationId,
          path: openApiPathOf(operation.path),
        })),
      }),
      "openapi.json": stableStringify(internalOpenApiDocument),
    }
    for (const [fileName, content] of Object.entries(fixtures)) {
      const filePath = resolve(contractsDirectory, fileName)
      if (process.env["CONTRACTS_UPDATE"] === "1") {
        await writeFile(filePath, content, "utf8")
        continue
      }
      const committed = await readFile(filePath, "utf8").catch(() => null)
      expect(
        committed,
        `${fileName} is stale - run CONTRACTS_UPDATE=1 pnpm --filter @geo/cms exec vitest run --configLoader runner test/unit/internal-contracts.test.ts to regenerate`,
      ).toBe(content)
    }
  })
})
