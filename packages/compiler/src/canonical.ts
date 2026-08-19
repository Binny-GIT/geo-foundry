/** Canonical JSON: recursively sorted object keys, stable byte output. */
export const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`
  }
  if (value !== null && typeof value === "object") {
    const body = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left === right ? 0 : 1))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")
    return `{${body}}`
  }
  return JSON.stringify(value)
}

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")

/** sha256 over UTF-8 text via WebCrypto; the compiler stays environment-free. */
export const sha256Hex = async (input: string): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))
  return toHex(new Uint8Array(digest))
}
