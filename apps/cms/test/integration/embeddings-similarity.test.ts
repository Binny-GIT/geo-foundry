import { sql } from "@payloadcms/db-postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { DEFAULT_SEMANTIC_THRESHOLDS, decideSemantic } from "@geo/quality-rules"

import { explainSimilarityQuery } from "../../src/services/embedding-similarity"
import { setupEmbeddingsWorld, type EmbeddingWorld } from "./helpers/embeddings-world"
import { DIM, MODEL, SHA, queryVector, vectorWithSimilarity } from "./helpers/embeddings-world"

describe("pgvector semantic similarity gate", () => {
  let world: EmbeddingWorld

  beforeAll(async () => {
    world = await setupEmbeddingsWorld()
  })

  afterAll(async () => {
    await world.destroy()
  })

  it("returns measured cross-domain nearest matches and blocks a 0.93 duplicate", async () => {
    await world.seedContentVector(world.nearDuplicate, MODEL, 0.93, "c".repeat(64))
    await world.seedContentVector(world.distinctEdition, MODEL, 0.8, "d".repeat(64))
    await world.seedContentVector(world.sameSiteNeighbour, MODEL, 0.87, "e".repeat(64))
    const response = await world.similarQuery(world.serviceUser, {
      comparison: "cross-domain",
      scope: "content",
      vector: queryVector(),
    })
    expect(response.status).toBe(200)
    const { matches } = JSON.parse(await response.text()) as {
      matches: { editionId: number; similarity: number }[]
    }
    expect(matches.map((match) => match.editionId)).toEqual([
      world.nearDuplicate,
      world.distinctEdition,
    ])
    expect(matches[0]?.similarity).toBeCloseTo(0.93, 4)
    expect(matches[1]?.similarity).toBeCloseTo(0.8, 4)
    const decision = decideSemantic({
      matches: matches.map((match) => ({
        comparison: "cross-domain" as const,
        editionId: match.editionId,
        inputHash: SHA,
        scope: "content" as const,
        similarity: match.similarity,
        siteId: world.siteB.id,
        title: null,
      })),
      thresholds: DEFAULT_SEMANTIC_THRESHOLDS,
    })
    expect(decision.outcome).toBe("blocked")
    expect(decision.issues[0]?.code).toBe("SEMANTIC_CROSS_DOMAIN_DUPLICATE")
  })

  it("classifies a 0.86 cross-domain match as review-required", async () => {
    await world.seedContentVector(world.nearDuplicate, "review-model-v1", 0.86, "f".repeat(64))
    const response = await world.similarQuery(world.serviceUser, {
      comparison: "cross-domain",
      modelId: "review-model-v1",
      scope: "content",
      vector: queryVector(),
    })
    const { matches } = JSON.parse(await response.text()) as { matches: { similarity: number }[] }
    expect(matches).toHaveLength(1)
    expect(matches[0]?.similarity).toBeCloseTo(0.86, 4)
  })

  it("returns same-site title and content matches separately", async () => {
    await world.store(world.titleTwin, world.serviceUser, {
      dimension: DIM,
      inputHash: "1".repeat(64),
      modelId: MODEL,
      scope: "title",
      vector: vectorWithSimilarity(0.95),
    })
    const titles = await world.similarQuery(world.serviceUser, {
      comparison: "same-site",
      scope: "title",
      vector: queryVector(),
    })
    expect((JSON.parse(await titles.text()) as { matches: unknown[] }).matches).toHaveLength(1)
    const sameSiteContent = await world.similarQuery(world.serviceUser, {
      comparison: "same-site",
      scope: "content",
      vector: queryVector(),
    })
    const contentMatches = (
      JSON.parse(await sameSiteContent.text()) as {
        matches: { similarity: number }[]
      }
    ).matches
    expect(contentMatches[0]?.similarity).toBeCloseTo(0.87, 4)
  })

  it("never leaks cross-tenant candidates even for identical vectors", async () => {
    const foreignStore = await world.store(world.foreignEdition, world.foreignServiceUser, {
      dimension: DIM,
      inputHash: "2".repeat(64),
      modelId: MODEL,
      scope: "content",
      vector: queryVector(),
    })
    expect(foreignStore.status).toBe(200)
    const response = await world.similarQuery(world.serviceUser, {
      comparison: "cross-domain",
      limit: 50,
      scope: "content",
      vector: queryVector(),
    })
    const { matches } = JSON.parse(await response.text()) as { matches: { editionId: number }[] }
    expect(matches.length).toBeGreaterThan(0)
    const tenantEditions = new Set([
      world.nearDuplicate,
      world.distinctEdition,
      world.sameSiteNeighbour,
      world.titleTwin,
    ])
    expect(matches.every((match) => tenantEditions.has(match.editionId))).toBe(true)
    expect(matches.some((match) => match.editionId === world.foreignEdition)).toBe(false)
  })

  it("selects the hnsw index above the fixture scale threshold", async () => {
    const fillerEdition = await world.makeEdition(
      world.editor,
      world.siteB.id,
      world.tenant.id,
      "Scale filler edition",
    )
    const inserted = await world.payload.db.drizzle.execute(sql`
      INSERT INTO geo_foundry.embeddings
        (embedding_key, tenant_id, site_id, edition_id, scope, model_id, dimension, input_hash, embedding)
      SELECT 'scale-filler-' || g, ${world.tenant.id}, ${world.siteB.id}, ${fillerEdition}, 'content',
             'scale-filler-v1', ${DIM}, repeat(md5(g::text), 2),
             ('[' || repeat('0.02,', ${DIM - 1}) || '0.02]')::public.vector
      FROM generate_series(1, 2000) AS g
      ON CONFLICT (embedding_key) DO NOTHING`)
    expect(inserted.rowCount).toBe(2000)
    await world.payload.db.drizzle.execute(sql`ANALYZE geo_foundry.embeddings`)
    await world.payload.db.drizzle.execute(sql`SET enable_seqscan = off`)
    try {
      const plan = await explainSimilarityQuery(world.payload, {
        comparison: "cross-domain",
        dimension: DIM,
        editionId: world.queryEdition,
        limit: 5,
        modelId: "scale-filler-v1",
        scope: "content",
        user: world.serviceUser,
        vector: queryVector(),
      })
      const planText = JSON.stringify(plan)
      expect(planText).toContain("embeddings_embedding_hnsw_idx")
      expect(planText).toContain("Index Scan")
    } finally {
      await world.payload.db.drizzle.execute(sql`RESET enable_seqscan`)
    }
  })
})
