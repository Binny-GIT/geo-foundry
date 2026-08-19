export const OUTLINE_PROMPT_VERSION = "outline-v1"
export const DRAFT_PROMPT_VERSION = "draft-v1"
export const EVALUATION_PROMPT_VERSION = "evaluation-v1"
export const QUALITY_EVALUATION_PROMPT_VERSION = "quality-evaluation-v1"
export const EMBEDDING_FIXTURE_VERSION = "embedding-v1"

export const outlineFixture = {
  angle: "practitioner-playbook",
  sections: [
    {
      bullets: [
        "why deterministic pipelines beat one-shot prompting",
        "the three gates every edition passes",
      ],
      heading: "Why generated content needs a pipeline",
    },
    {
      bullets: ["brief to outline", "outline to draft", "draft to site adaptation"],
      heading: "How the pipeline is staged",
    },
  ],
} as const

export const draftFixture = {
  blocks: [
    { text: "The Practitioner Playbook for Deterministic Content", type: "heading" },
    { text: "Every published edition passes three gates before it ships.", type: "paragraph" },
  ],
  title: "The Practitioner Playbook for Deterministic Content",
} as const

export const evaluationFixture = {
  issues: [
    {
      code: "TITLE_TOO_GENERIC",
      message: "Title could name the concrete outcome",
      severity: "minor",
    },
  ],
  overall: 0.82,
  recommendation: "approve",
} as const

/** Golden output of the versioned quality-evaluation prompt contract. */
export const qualityEvaluationFixture = {
  dimensions: { geo: 88, originality: 86, quality: 90, seo: 87, siteFit: 85 },
  issues: [
    {
      code: "TITLE_TOO_GENERIC",
      message: "Title could name the concrete outcome",
      recommendation: "Name the measured outcome in the title",
      severity: "minor",
    },
  ],
  overall: 88,
  recommendations: ["Tighten the opening summary with the concrete outcome."],
  schemaVersion: 1,
} as const

export const CHAT_FIXTURES: Readonly<Record<string, unknown>> = {
  [DRAFT_PROMPT_VERSION]: draftFixture,
  [EVALUATION_PROMPT_VERSION]: evaluationFixture,
  [OUTLINE_PROMPT_VERSION]: outlineFixture,
  [QUALITY_EVALUATION_PROMPT_VERSION]: qualityEvaluationFixture,
}

export const CHAT_FIXTURE_MODEL_ID = "fake-chat-v1"
export const EMBEDDING_FIXTURE_MODEL_ID = "fake-embedding-v1"

/**
 * Deterministic unit-vector components from pure integer arithmetic - no
 * floating-point library calls - so CI vectors are byte-identical across
 * platforms and Node versions.
 */
export const deterministicEmbeddingVector = (dimension: number): readonly number[] =>
  Array.from({ length: dimension }, (_, index) => (((index * 37) % 101) - 50) / 127)
