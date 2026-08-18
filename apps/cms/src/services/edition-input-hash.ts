import { createHash } from "node:crypto"

export const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((sorted, key) => {
        sorted[key] = canonicalize(record[key])
        return sorted
      }, {})
  }
  return value
}

export type EditionContentSnapshot = {
  readonly title: unknown
  readonly summary: unknown
  readonly body: unknown
  readonly primaryTopic: unknown
  readonly secondaryTopics: unknown
}

/**
 * Deterministic content hash of every quality-relevant edition field.
 * The approval gate compares this against the assessment's inputHash, so an
 * edition edited after assessment can never be approved on stale evidence.
 */
export function hashEditionContent(snapshot: EditionContentSnapshot): string {
  const canonical = JSON.stringify(canonicalize(snapshot))
  return createHash("sha256").update(canonical).digest("hex")
}
