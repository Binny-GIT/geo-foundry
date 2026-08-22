import { describe, expect, it } from "vitest"

import {
  DEFAULT_QUEUE_PREFIX,
  faultQueuePrefixOf,
  parseQueuePrefix,
  QueuePrefixError,
} from "../src/index.js"

const runId = "todo39-abc123def456ghi789j0"

describe("queue prefixes", () => {
  it("keeps the production namespace when none is configured", () => {
    expect(parseQueuePrefix(undefined)).toBe(DEFAULT_QUEUE_PREFIX)
    expect(parseQueuePrefix(DEFAULT_QUEUE_PREFIX)).toBe(DEFAULT_QUEUE_PREFIX)
  })

  it("derives the only permitted fault namespace from an owned run id", () => {
    const prefix = `${DEFAULT_QUEUE_PREFIX}:${runId}`

    expect(faultQueuePrefixOf(runId)).toBe(prefix)
    expect(parseQueuePrefix(prefix)).toBe(prefix)
  })

  it("rejects arbitrary and malformed namespaces", () => {
    expect(() => parseQueuePrefix("other")).toThrow(QueuePrefixError)
    expect(() => parseQueuePrefix(`${DEFAULT_QUEUE_PREFIX}:shared`)).toThrow(QueuePrefixError)
    expect(() => faultQueuePrefixOf("todo39-INVALID")).toThrow(QueuePrefixError)
  })
})
