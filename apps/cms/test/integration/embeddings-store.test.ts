import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { setupEmbeddingsWorld, type EmbeddingWorld } from "./helpers/embeddings-world"
import { DIM, MODEL, SHA, errorCodeOf, queryVector } from "./helpers/embeddings-world"

describe("pgvector embedding store persistence", () => {
  let world: EmbeddingWorld

  beforeAll(async () => {
    world = await setupEmbeddingsWorld()
  })

  afterAll(async () => {
    await world.destroy()
  })

  it("stores embeddings idempotently per canonical key", async () => {
    const body = {
      dimension: DIM,
      inputHash: SHA,
      modelId: MODEL,
      scope: "content",
      vector: queryVector(),
    }
    const first = JSON.parse(
      await (await world.store(world.queryEdition, world.serviceUser, body)).text(),
    ) as { created: boolean; embeddingKey: string }
    expect(first.created).toBe(true)
    expect(first.embeddingKey).toHaveLength(64)
    const replay = JSON.parse(
      await (await world.store(world.queryEdition, world.serviceUser, body)).text(),
    ) as { created: boolean; embeddingId: number }
    expect(replay.created).toBe(false)
    const changedInput = await world.seedContentVector(
      world.queryEdition,
      MODEL,
      0.5,
      "b".repeat(64),
    )
    expect((JSON.parse(await changedInput.text()) as { created: boolean }).created).toBe(true)
    const changedModel = await world.seedContentVector(
      world.queryEdition,
      "other-model-v9",
      0.5,
      "b".repeat(64),
    )
    expect((JSON.parse(await changedModel.text()) as { created: boolean }).created).toBe(true)
  })

  it("rejects wrong dimensions, mismatched vector lengths, and unauthorized identities", async () => {
    const wrongDimension = await world.store(world.queryEdition, world.serviceUser, {
      dimension: 64,
      inputHash: SHA,
      modelId: MODEL,
      scope: "content",
      vector: Array.from({ length: 64 }, () => 0.1),
    })
    expect(wrongDimension.status).toBe(400)
    expect(await errorCodeOf(wrongDimension)).toBe("EMBEDDING_DIMENSION_MISMATCH")
    const mismatchedLength = await world.store(world.queryEdition, world.serviceUser, {
      dimension: DIM,
      inputHash: SHA,
      modelId: MODEL,
      scope: "content",
      vector: [0.5, 0.5],
    })
    expect(await errorCodeOf(mismatchedLength)).toBe("EMBEDDING_VECTOR_INVALID")
    const foreignTenantCall = await world.store(world.queryEdition, world.foreignServiceUser, {
      dimension: DIM,
      inputHash: SHA,
      modelId: MODEL,
      scope: "content",
      vector: queryVector(),
    })
    // Cross-tenant edition access is obfuscated as not-found (workflowErrorToResponse),
    // matching the same-shape-for-foreign-and-unknown contract asserted in
    // internal-endpoints.test.ts, so it never confirms a foreign edition exists.
    expect(foreignTenantCall.status).toBe(404)
    expect(await errorCodeOf(foreignTenantCall)).toBe("EDITION_WORKFLOW_NOT_FOUND")
    const anonymous = await world.store(world.queryEdition, null, {
      dimension: DIM,
      inputHash: SHA,
      modelId: MODEL,
      scope: "content",
      vector: queryVector(),
    })
    expect(anonymous.status).toBe(401)
    const human = await world.store(world.queryEdition, world.editor, {
      dimension: DIM,
      inputHash: SHA,
      modelId: MODEL,
      scope: "content",
      vector: queryVector(),
    })
    expect(human.status).toBe(403)
    expect(await errorCodeOf(human)).toBe("INTERNAL_FORBIDDEN")
  })

  it("answers safely when the model has no stored embeddings", async () => {
    const response = await world.similarQuery(world.serviceUser, {
      comparison: "cross-domain",
      modelId: "missing-model-v1",
      scope: "content",
      vector: queryVector(),
    })
    expect(response.status).toBe(200)
    expect((JSON.parse(await response.text()) as { matches: unknown[] }).matches).toEqual([])
  })

  it("does not reuse embeddings across models or changed inputs", async () => {
    const response = await world.similarQuery(world.serviceUser, {
      comparison: "cross-domain",
      modelId: "other-model-v9",
      scope: "content",
      vector: queryVector(),
    })
    expect((JSON.parse(await response.text()) as { matches: unknown[] }).matches).toEqual([])
  })
})
