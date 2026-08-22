import { describe, expect, it } from "vitest"
import { z } from "zod"

import { createFakeProvider } from "../../src/providers/fake.js"
import { ProviderError } from "../../src/providers/errors.js"
import { OUTLINE_PROMPT_VERSION } from "../../src/providers/fixtures.js"
import type { ProviderEvent } from "../../src/providers/types.js"

import { runProviderContractSuite } from "./provider-contract-suite.js"

const events: ProviderEvent[] = []

runProviderContractSuite(
  "fake",
  () => createFakeProvider({ onEvent: (event) => events.push(event) }),
  events,
)

describe("fake provider specifics", () => {
  it("fails loudly when a prompt version has no fixture", async () => {
    const provider = createFakeProvider()
    const failure = await provider
      .generate({
        maxOutputTokens: 16,
        promptVersion: "unregistered-v999",
        requestId: "req-missing-0001",
        schema: z.object({}),
        system: "irrelevant",
        temperature: 0,
        user: "irrelevant",
      })
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ProviderError)
    expect((failure as ProviderError).code).toBe("FAKE_FIXTURE_MISSING")
    expect((failure as ProviderError).retryability).toBe("terminal")
  })

  it("keeps fixture hashes stable across process runs", async () => {
    const provider = createFakeProvider()
    const result = await provider.generate({
      maxOutputTokens: 16,
      promptVersion: OUTLINE_PROMPT_VERSION,
      requestId: "req-stable-0001",
      schema: z.object({ angle: z.string() }).passthrough(),
      system: "irrelevant",
      temperature: 0,
      user: "irrelevant",
    })
    expect(result.rawResponseHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("derives distinct deterministic embeddings from distinct inputs", async () => {
    const provider = createFakeProvider()
    const first = await provider.embed({ input: "site-a engineering edition", requestId: "req-a" })
    const second = await provider.embed({ input: "site-b operations edition", requestId: "req-b" })
    expect([...first.vector]).not.toEqual([...second.vector])
  })
})
