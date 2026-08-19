import { createHash } from "node:crypto"

/**
 * Canonical JSON: object keys sorted recursively so semantically identical
 * request bodies hash to the same idempotency fingerprint regardless of the
 * client's serialization order.
 */
export const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, item]) => item !== undefined,
    )
    const body = entries
      .sort(([left], [right]) => (left < right ? -1 : left === right ? 0 : 1))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")
    return `{${body}}`
  }
  return JSON.stringify(value)
}

export const sha256Hex = (input: string): string => createHash("sha256").update(input).digest("hex")
