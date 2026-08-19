import { z } from "zod"

import type { ContentServiceClient, OperationSnapshot } from "@geo/content-client"

import { canonicalJson, sha256Hex } from "../canonical.js"
import {
  ADAPTATION_PROMPT_VERSION,
  DRAFT_PROMPT_VERSION,
  OUTLINE_PROMPT_VERSION,
  REVISION_PROMPT_VERSION,
} from "../providers/fixtures.js"
import type { LLMProvider } from "../providers/types.js"
import { draftDocumentOf } from "./draft-document.js"
import { evaluateEdition, type EditionEvaluation, type EvaluationDeps } from "./evaluate.js"

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
  readonly thresholds?: { dimensionMin: number; overallMin: number }
}

export type TargetOutcome = {
  readonly decision: EditionEvaluation["aggregate"]["decision"]
  readonly editionId: number
  readonly evaluation: EditionEvaluation
  readonly revised: boolean
}

type StageClient = Pick<
  ContentServiceClient,
  "completeOperationStage" | "startOperationStage" | "writeDraftVersion"
>

const hashOf = (payload: unknown): string => sha256Hex(canonicalJson(payload))

/**
 * Staged generation for one operation: outline -> draft -> site adaptation ->
 * draft write -> three-layer evaluation -> at most one bounded revision when
 * the gate does not pass. Every stage is journaled on the operation ledger
 * with input and output hashes; the research bundle is operator-supplied and
 * generation refuses to start without it.
 */
export const runGenerationOperation = async (
  deps: EvaluationDeps & { client: EvaluationDeps["client"] & StageClient; provider: LLMProvider },
  input: GenerateOperationInput,
): Promise<{ operation: OperationSnapshot; outcomes: readonly TargetOutcome[] }> => {
  if (input.brief.sources.length === 0) {
    throw new Error("GENERATION_BRIEF_SOURCES_REQUIRED")
  }
  const outcomes: TargetOutcome[] = []
  for (const target of input.targets) {
    const outline = await runStage(deps.client, input, target, "outline", async () => {
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
    const draft = await runStage(deps.client, input, target, "draft", async () => {
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
    const adaptation = await runStage(deps.client, input, target, "adaptation", async () => {
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
      body: adaptation.value.blocks as unknown as Record<string, unknown>[],
      summary,
      title: adaptation.value.title,
    })
    let evaluation = await evaluateTarget(deps, input, target, adaptation.value, summary)
    let revised = false
    if (evaluation.aggregate.decision !== "passed") {
      revised = true
      const revision = await runStage(deps.client, input, target, "revision", async () => {
        const generated = await deps.provider.generate({
          maxOutputTokens: 4096,
          promptVersion: REVISION_PROMPT_VERSION,
          requestId: input.requestId,
          schema: draftOutputSchema,
          system: "You revise once to clear the quality gate.",
          temperature: 0,
          user: canonicalJson({
            aggregate: evaluation.aggregate.gate.reasons,
            brief: input.brief,
            draft: adaptation.value,
          }),
        })
        return { outputHash: hashOf(generated.content), value: generated.content }
      })
      await deps.client.writeDraftVersion(target.editionId, {
        body: revision.value.blocks as unknown as Record<string, unknown>[],
        summary,
        title: revision.value.title,
      })
      evaluation = await evaluateTarget(deps, input, target, revision.value, summary)
    }
    outcomes.push({
      decision: evaluation.aggregate.decision,
      editionId: target.editionId,
      evaluation,
      revised,
    })
  }
  const operation = await deps.client.completeOperationStage(input.operationId, {
    attempt: input.attempt,
    outcome: "succeeded",
    result: {
      outcomes: outcomes.map((outcome) => ({
        decision: outcome.decision,
        editionId: outcome.editionId,
        revised: outcome.revised,
      })),
    },
    stage: "generation",
  })
  return { operation, outcomes }
}

const evaluateTarget = async (
  deps: EvaluationDeps,
  input: GenerateOperationInput,
  target: GenerationTarget,
  draft: z.infer<typeof draftOutputSchema>,
  summary: string,
): Promise<EditionEvaluation> =>
  evaluateEdition(deps, {
    document: draftDocumentOf({
      body: draft.blocks as unknown[],
      contentId: input.contentId,
      pathname: `/drafts/${target.editionId}`,
      siteId: target.siteStrategy.name,
      summary,
      title: draft.title,
    }),
    editionId: target.editionId,
    siteAngle: target.angle,
    siteName: target.siteStrategy.name,
    ...(input.thresholds === undefined ? {} : { thresholds: input.thresholds }),
  })

const runStage = async <T>(
  client: StageClient,
  input: GenerateOperationInput,
  target: GenerationTarget,
  stage: string,
  work: () => Promise<{ outputHash: string; value: T }>,
): Promise<{ value: T }> => {
  await client.startOperationStage(input.operationId, {
    attempt: input.attempt,
    stage: `${stage}-${target.editionId}`,
  })
  const result = await work()
  await client.completeOperationStage(input.operationId, {
    attempt: input.attempt,
    outcome: "succeeded",
    result: { outputHash: result.outputHash },
    stage: `${stage}-${target.editionId}`,
  })
  return { value: result.value }
}
