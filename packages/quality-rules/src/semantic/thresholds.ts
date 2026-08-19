import { z } from "zod"

export const CROSS_DOMAIN_REVIEW_THRESHOLD = 0.85
export const CROSS_DOMAIN_BLOCK_THRESHOLD = 0.92
export const SAME_SITE_TITLE_BLOCK_THRESHOLD = 0.9

export const DEFAULT_SEMANTIC_THRESHOLDS = {
  crossDomainBlock: CROSS_DOMAIN_BLOCK_THRESHOLD,
  crossDomainReview: CROSS_DOMAIN_REVIEW_THRESHOLD,
  sameSiteTitleBlock: SAME_SITE_TITLE_BLOCK_THRESHOLD,
} as const

const unitInterval = z.number().finite().min(0).max(1)

export const semanticThresholdsSchema = z
  .object({
    crossDomainBlock: unitInterval,
    crossDomainReview: unitInterval,
    sameSiteTitleBlock: unitInterval,
  })
  .strict()
  .refine((value) => value.crossDomainReview < value.crossDomainBlock, {
    message: "crossDomainReview must be below crossDomainBlock",
    path: ["crossDomainReview"],
  })

export type SemanticThresholds = z.infer<typeof semanticThresholdsSchema>

/**
 * Thresholds are persisted with each assessment, so callers need a stable
 * commitment to the exact values that produced a decision. This package
 * stays environment-free: hash the canonical serialization (sha256) at the
 * caller, never reorder or extend it.
 */
export const serializeSemanticThresholds = (thresholds: SemanticThresholds): string =>
  JSON.stringify({
    crossDomainBlock: thresholds.crossDomainBlock,
    crossDomainReview: thresholds.crossDomainReview,
    sameSiteTitleBlock: thresholds.sameSiteTitleBlock,
  })
