import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

import { ContentServiceClient } from "../src/client.js"

type OperationFixture = {
  operations: readonly { method: string; operationId: string; path: string }[]
}

const readContractFixture = async <T>(fileName: string): Promise<T> =>
  JSON.parse(await readFile(new URL(`../contracts/${fileName}`, import.meta.url), "utf8")) as T

const clientMethodByOperation: Readonly<Record<string, string>> = {
  claimIntakeFetch: "claimIntakeFetch",
  cancelOperation: "cancelOperation",
  completeIntakeFetch: "completeIntakeFetch",
  dispatchDuePublicationPlans: "dispatchDuePublicationPlans",
  completeOperationStage: "completeOperationStage",
  consumeRollbackIntent: "consumeRollbackIntent",
  createRssEntries: "createRssEntries",
  evaluateOperation: "evaluateOperation",
  failIntakeFetch: "failIntakeFetch",
  findSimilarEditions: "findSimilarEditions",
  generateOperation: "generateOperation",
  getCompileSnapshot: "getCompileSnapshot",
  getEditionInput: "getEditionInput",
  getIntakeFetchInput: "getIntakeFetchInput",
  getOperation: "getOperation",
  listNonTerminalOperations: "listNonTerminalOperations",
  recordAssessment: "recordAssessment",
  recordCompileResult: "recordCompileResult",
  recordPublishedRelease: "recordPublishedRelease",
  recordRollbackReceipt: "recordRollbackReceipt",
  rollbackOperation: "rollbackOperation",
  startOperationStage: "startOperationStage",
  storeEmbedding: "storeEmbedding",
  submitOperation: "submitOperation",
  writeDraftVersion: "writeDraftVersion",
}

describe("content-client contract", () => {
  it("implements every committed client operation", async () => {
    const fixture = await readContractFixture<OperationFixture>("client-operations.json")
    expect(fixture.operations.length).toBeGreaterThanOrEqual(5)
    const client = new ContentServiceClient({ apiKey: "key", baseUrl: "http://cms.invalid" })
    for (const operation of fixture.operations) {
      const methodName = clientMethodByOperation[operation.operationId]
      expect(methodName, `client method for ${operation.operationId}`).toBeDefined()
      expect(typeof (client as unknown as Record<string, unknown>)[methodName ?? ""]).toBe(
        "function",
      )
    }
    for (const operationId of Object.keys(clientMethodByOperation)) {
      expect(
        fixture.operations.some((operation) => operation.operationId === operationId),
        `operation ${operationId} must stay in the committed contract`,
      ).toBe(true)
    }
  })

  it("stays free of control-plane database and queue dependencies", async () => {
    const packageManifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    const dependencies = Object.keys(packageManifest.dependencies ?? {})
    const forbidden = ["payload", "pg", "bullmq", "ioredis", "@payloadcms/db-postgres"]
    for (const dependency of forbidden) {
      expect(dependencies, `${dependency} must not be a runtime dependency`).not.toContain(
        dependency,
      )
    }
  })
})
