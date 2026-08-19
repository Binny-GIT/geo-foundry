import { describe, expect, it } from "vitest"
import { z } from "zod"

import { ProviderError } from "../../src/providers/errors.js"
import {
  DRAFT_PROMPT_VERSION,
  EVALUATION_PROMPT_VERSION,
  OUTLINE_PROMPT_VERSION,
} from "../../src/providers/fixtures.js"
import type { LLMProvider, ProviderEvent } from "../../src/providers/types.js"

const outlineSchema = z
  .object({
    angle: z.string().min(1),
    sections: z
      .array(
        z.object({
          bullets: z.array(z.string().min(1)).min(1),
          heading: z.string().min(1),
        }),
      )
      .min(1),
  })
  .strict()

const draftSchema = z
  .object({
    blocks: z
      .array(z.object({ text: z.string().min(1), type: z.enum(["heading", "paragraph"]) }).strict())
      .min(1),
    title: z.string().min(1),
  })
  .strict()

const evaluationSchema = z
  .object({
    issues: z.array(
      z
        .object({
          code: z.string().min(1),
          message: z.string().min(1),
          severity: z.enum(["minor", "major", "critical"]),
        })
        .strict(),
    ),
    overall: z.number().min(0).max(1),
    recommendation: z.enum(["approve", "revise", "block"]),
  })
  .strict()

const chat = <T>(
  provider: LLMProvider,
  schema: z.ZodType<T>,
  promptVersion: string,
  requestId: string,
) =>
  provider.generate({
    maxOutputTokens: 512,
    promptVersion,
    requestId,
    schema,
    system: `Stage ${promptVersion}: produce strictly valid JSON.`,
    temperature: 0,
    user: "Produce the structured payload.",
  })

/**
 * The provider contract suite runs unchanged against the deterministic fake
 * and against the OpenAI-compatible adapter pointed at a local mock server,
 * proving both implementations satisfy the single narrow interface.
 */
export const runProviderContractSuite = (
  label: string,
  createProvider: () => LLMProvider,
  events: ProviderEvent[],
): void => {
  describe(`${label}: LLMProvider contract`, () => {
    it("returns a schema-valid stable outline", async () => {
      const provider = createProvider()
      const first = await chat(provider, outlineSchema, OUTLINE_PROMPT_VERSION, "req-outline-0001")
      const second = await chat(provider, outlineSchema, OUTLINE_PROMPT_VERSION, "req-outline-0002")
      expect(first.content.sections.length).toBeGreaterThan(0)
      expect(first.content).toEqual(second.content)
      expect(first.rawResponseHash).toBe(second.rawResponseHash)
      expect(first.modelId).toBe(provider.chatModelId)
      expect(first.providerId).toBe(provider.providerId)
    })

    it("returns a schema-valid draft", async () => {
      const provider = createProvider()
      const result = await chat(provider, draftSchema, DRAFT_PROMPT_VERSION, "req-draft-0001")
      expect(result.content.title.length).toBeGreaterThan(0)
      expect(result.content.blocks[0]?.type).toBe("heading")
    })

    it("returns a schema-valid evaluation", async () => {
      const provider = createProvider()
      const result = await chat(
        provider,
        evaluationSchema,
        EVALUATION_PROMPT_VERSION,
        "req-evaluation-0001",
      )
      expect(result.content.overall).toBeGreaterThanOrEqual(0)
      expect(["approve", "revise", "block"]).toContain(result.content.recommendation)
    })

    it("rejects schema-mismatched payloads terminally", async () => {
      const provider = createProvider()
      const hostileSchema = z.object({ definitelyMissing: z.string() }).strict()
      const failure = await chat(
        provider,
        hostileSchema,
        OUTLINE_PROMPT_VERSION,
        "req-hostile-0001",
      ).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(ProviderError)
      expect((failure as ProviderError).code).toBe("PROVIDER_MALFORMED_RESPONSE")
      expect((failure as ProviderError).retryability).toBe("terminal")
    })

    it("returns deterministic embeddings of the declared dimension", async () => {
      const provider = createProvider()
      const first = await provider.embed({ input: "duplicate topic", requestId: "req-embed-0001" })
      const second = await provider.embed({ input: "duplicate topic", requestId: "req-embed-0002" })
      expect(first.dimension).toBeGreaterThan(0)
      expect([...first.vector]).toEqual([...second.vector])
      expect(first.vector.every((component) => Math.abs(component) <= 1)).toBe(true)
      expect(first.modelId).toBe(provider.embeddingModelId)
    })

    it("emits correlated events that never contain secrets or content", async () => {
      const provider = createProvider()
      await chat(provider, outlineSchema, OUTLINE_PROMPT_VERSION, "req-events-0001")
      await provider.embed({ input: "event probe", requestId: "req-events-0002" })
      const requestIds = new Set(events.map((event) => event.requestId))
      expect(requestIds.has("req-events-0001")).toBe(true)
      expect(requestIds.has("req-events-0002")).toBe(true)
      const serialized = JSON.stringify(events)
      expect(serialized).not.toMatch(/sk-|Bearer|authorization/i)
      expect(serialized).not.toContain("Produce the structured payload")
      expect(serialized).not.toContain("duplicate topic")
    })
  })
}
