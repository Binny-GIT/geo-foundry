import { readFile } from "node:fs/promises"

export type JsonObject = { readonly [key: string]: unknown }

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export async function readJsonObject(path: string): Promise<JsonObject> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"))
  if (!isJsonObject(parsed)) {
    throw new TypeError(`Expected JSON object at ${path}`)
  }
  return parsed
}

export function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((entry): entry is string => typeof entry === "string")
}

export function readStringRecord(value: unknown): Readonly<Record<string, string>> {
  if (!isJsonObject(value)) {
    return Object.freeze({})
  }
  const entries = Object.entries(value).filter((entry): entry is [string, string] => {
    return typeof entry[1] === "string"
  })
  return Object.freeze(Object.fromEntries(entries))
}

export function exportTargets(value: unknown): readonly string[] {
  if (typeof value === "string") {
    return [value]
  }
  if (!isJsonObject(value)) {
    return []
  }
  return Object.values(value).flatMap(exportTargets)
}
