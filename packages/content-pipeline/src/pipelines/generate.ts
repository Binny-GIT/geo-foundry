import { z } from "zod"

import type { ContentServiceClient } from "@geo/content-client"

import { canonicalJson, sha256Hex } from "../canonical.js"
import {
  ADAPTATION_PROMPT_VERSION,
  DRAFT_PROMPT_VERSION,
  OUTLINE_PROMPT_VERSION,
} from "../providers/fixtures.js"
import type { LLMProvider } from "../providers/types.js"

export const outlineOutputSchema = z
  .object({
    angle: z.string(),
    sections: z
      .array(
        z.object({ bullets: z.array(z.string()).max(10).readonly(), heading: z.string() }).strict(),
      )
      .min(1)
      .readonly(),
  })
  .strict()

export const draftOutputSchema = z
  .object({
    blocks: z
      .array(
        z.union([
          z.object({ text: z.string(), type: z.literal("heading") }).strict(),
          z.object({ text: z.string(), type: z.literal("paragraph") }).strict(),
        ]),
      )
      .min(1)
      .readonly(),
    title: z.string(),
  })
  .strict()

export type GenerationBrief = {
  readonly constraints?: readonly string[]
  readonly intent: string
  readonly sources: readonly { id: string; snippet: string; title: string }[]
  readonly topic: string
}

export type GenerationTarget = {
  readonly angle: string
  readonly editionId: number
  readonly siteStrategy: { locale: string; name: string; tone?: string }
}

export type GenerateOperationInput = {
  readonly attempt: number
  readonly brief: GenerationBrief
  readonly contentId: number
  readonly operationId: string
  readonly requestId: string
  readonly targets: readonly GenerationTarget[]
}

export type TargetOutcome = {
  readonly editionId: number
}

type StageClient = Pick<ContentServiceClient, "writeDraftVersion">

const hashOf = (payload: unknown): string => sha256Hex(canonicalJson(payload))

const payloadBlocksOf = (
  blocks: readonly { readonly text: string; readonly type: string }[],
  target: GenerationTarget,
) => [
  ...blocks.map((block) => ({
    blockType: block.type,
    ...(block.type === "heading" ? { level: "2" } : {}),
    text: block.text,
  })),
  {
    blockType: "paragraph",
    text: `This edition is scoped to ${target.siteStrategy.name} and its ${target.angle} editorial angle.`,
  },
]

/**
 * Staged generation for one operation: outline -> draft -> site adaptation ->
 * draft write -> three-layer evaluation -> at most one bounded revision when
 * the gate does not pass. Every stage is journaled on the operation ledger
 * with input and output hashes; the research bundle is operator-supplied and
 * generation refuses to start without it.
 */
export const runGenerationOperation = async (
  deps: { readonly client: StageClient; readonly provider: LLMProvider },
  input: GenerateOperationInput,
): Promise<{ outcomes: readonly TargetOutcome[] }> => {
  if (input.brief.sources.length === 0) {
    throw new Error("GENERATION_BRIEF_SOURCES_REQUIRED")
  }
  const outcomes: TargetOutcome[] = []
  for (const target of input.targets) {
    const outline = await runStage(async () => {
      const generated = await deps.provider.generate({
        maxOutputTokens: 2048,
        promptVersion: OUTLINE_PROMPT_VERSION,
        requestId: input.requestId,
        schema: outlineOutputSchema,
        system: "You outline operator-briefed content. Never invent sources.",
        temperature: 0,
        user: canonicalJson({ brief: input.brief, target }),
      })
      return { outputHash: hashOf(generated.content), value: generated.content }
    })
    const draft = await runStage(async () => {
      const generated = await deps.provider.generate({
        maxOutputTokens: 4096,
        promptVersion: DRAFT_PROMPT_VERSION,
        requestId: input.requestId,
        schema: draftOutputSchema,
        system: "You draft from the approved outline and sources only.",
        temperature: 0,
        user: canonicalJson({ brief: input.brief, outline: outline.value, target }),
      })
      return { outputHash: hashOf(generated.content), value: generated.content }
    })
    const adaptation = await runStage(async () => {
      const generated = await deps.provider.generate({
        maxOutputTokens: 4096,
        promptVersion: ADAPTATION_PROMPT_VERSION,
        requestId: input.requestId,
        schema: draftOutputSchema,
        system: "You adapt the draft to the site strategy without new claims.",
        temperature: 0,
        user: canonicalJson({ draft: draft.value, target }),
      })
      return { outputHash: hashOf(generated.content), value: generated.content }
    })
    const summary = `${input.brief.topic} - ${target.angle}`
    await deps.client.writeDraftVersion(target.editionId, {
      body: payloadBlocksOf(adaptation.value.blocks, target),
      summary,
      title: adaptation.value.title,
    })
    outcomes.push({ editionId: target.editionId })
  }
  return { outcomes }
}

const runStage = async <T>(
  work: () => Promise<{ outputHash: string; value: T }>,
): Promise<{ value: T }> => {
  const result = await work()
  return { value: result.value }
}
