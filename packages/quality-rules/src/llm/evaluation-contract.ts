import { z } from "zod"

import { QUALITY_SEVERITY } from "../deterministic/issue.js"

/** Bump when the evaluation output contract changes; runtime accepts v1 only. */
export const EVALUATION_OUTPUT_SCHEMA_VERSION = 1

export const EVALUATION_DIMENSIONS = ["geo", "originality", "quality", "seo", "siteFit"] as const
export type EvaluationDimension = (typeof EVALUATION_DIMENSIONS)[number]

const score = z.number().finite().min(0).max(100)

export const evaluationIssueSchema = z
  .object({
    code: z.string().min(1).max(200),
    message: z.string().min(1).max(2000),
    recommendation: z.string().min(1).max(2000).optional(),
    severity: z.enum(QUALITY_SEVERITY),
  })
  .strict()

const dimensionsSchema = z
  .object({
    geo: score,
    originality: score,
    quality: score,
    seo: score,
    siteFit: score,
  })
  .strict()

export const llmEvaluationOutputSchema = z
  .object({
    dimensions: dimensionsSchema,
    issues: z.array(evaluationIssueSchema).max(200),
    overall: score,
    recommendations: z.array(z.string().min(1).max(2000)).max(50),
    schemaVersion: z.literal(EVALUATION_OUTPUT_SCHEMA_VERSION),
  })
  .strict()

export type LlmEvaluationIssue = z.infer<typeof evaluationIssueSchema>
export type LlmEvaluationOutput = z.infer<typeof llmEvaluationOutputSchema>

export type LlmEvaluationParse =
  | { readonly issues: readonly string[]; readonly kind: "invalid" }
  | { readonly kind: "parsed"; readonly output: LlmEvaluationOutput }

/** Deterministic parse boundary: never throws, never repairs, never guesses. */
export const parseLlmEvaluationOutput = (raw: unknown): LlmEvaluationParse => {
  const parsed = llmEvaluationOutputSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map(
        (issue) => `${issue.path.map(String).join(".")}: ${issue.message}`,
      ),
      kind: "invalid",
    }
  }
  return { kind: "parsed", output: parsed.data }
}

export type LlmGateThresholds = {
  readonly dimensionMin: number
  readonly overallMin: number
}

/** PRD defaults: overall >= 80 and every dimension >= 75. */
export const DEFAULT_LLM_GATE_THRESHOLDS: LlmGateThresholds = {
  dimensionMin: 75,
  overallMin: 80,
}

export const llmGateThresholdsSchema = z
  .object({
    dimensionMin: z.number().finite().min(0).max(100),
    overallMin: z.number().finite().min(0).max(100),
  })
  .strict()
  .refine((value) => value.overallMin >= value.dimensionMin, {
    message: "overallMin must be at least dimensionMin",
    path: ["overallMin"],
  })

/** Canonical serialization; callers hash it (sha256) for assessment receipts. */
export const serializeLlmGateThresholds = (thresholds: LlmGateThresholds): string =>
  JSON.stringify({ dimensionMin: thresholds.dimensionMin, overallMin: thresholds.overallMin })
