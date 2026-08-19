import { createHash } from "node:crypto"

import { PROVIDER_ERROR_CODE, ProviderError } from "./errors.js"
import {
  CHAT_FIXTURES,
  CHAT_FIXTURE_MODEL_ID,
  EMBEDDING_FIXTURE_MODEL_ID,
  deterministicEmbeddingVector,
} from "./fixtures.js"
import type {
  EmbeddingRequest,
  EmbeddingResult,
  LLMProvider,
  ProviderEvent,
  ProviderEventSink,
  StructuredChatRequest,
  StructuredChatResult,
} from "./types.js"

export const FAKE_PROVIDER_ID = "fake"

export type FakeProviderOptions = {
  readonly chatFixtures: Readonly<Record<string, unknown>>
  readonly chatModelId: string
  readonly dimension: number
  readonly embeddingModelId: string
  readonly onEvent: ProviderEventSink | undefined
}

const sha256Text = (input: string): string => createHash("sha256").update(input).digest("hex")

const stableFixtureText = (fixture: unknown): string => JSON.stringify(fixture)

export const createFakeProvider = (options: Partial<FakeProviderOptions> = {}): LLMProvider => {
  const chatFixtures = options.chatFixtures ?? CHAT_FIXTURES
  const chatModelId = options.chatModelId ?? CHAT_FIXTURE_MODEL_ID
  const dimension = options.dimension ?? 64
  const embeddingModelId = options.embeddingModelId ?? EMBEDDING_FIXTURE_MODEL_ID
  const emit = (event: ProviderEvent) => {
    options.onEvent?.(event)
  }

  return {
    chatModelId,
    embeddingModelId,
    providerId: FAKE_PROVIDER_ID,
    async generate<T>(request: StructuredChatRequest<T>): Promise<StructuredChatResult<T>> {
      const fixture = chatFixtures[request.promptVersion]
      emit({
        bytes: null,
        code: undefined,
        latencyMs: undefined,
        method: "chat",
        model: chatModelId,
        providerId: FAKE_PROVIDER_ID,
        requestId: request.requestId,
        status: null,
        type: "request",
      })
      if (fixture === undefined) {
        const error = new ProviderError(
          PROVIDER_ERROR_CODE.FAKE_FIXTURE_MISSING,
          "terminal",
          `no fake fixture registered for promptVersion ${request.promptVersion}`,
          null,
          undefined,
          request.requestId,
        )
        emit({
          bytes: null,
          code: error.code,
          latencyMs: 0,
          method: "chat",
          model: chatModelId,
          providerId: FAKE_PROVIDER_ID,
          requestId: request.requestId,
          status: null,
          type: "failure",
        })
        throw error
      }
      const raw = stableFixtureText(fixture)
      const validated = request.schema.safeParse(fixture)
      if (!validated.success) {
        throw new ProviderError(
          PROVIDER_ERROR_CODE.MALFORMED_RESPONSE,
          "terminal",
          "fake fixture failed the output schema",
          null,
          undefined,
          request.requestId,
        )
      }
      emit({
        bytes: raw.length,
        code: undefined,
        latencyMs: 0,
        method: "chat",
        model: chatModelId,
        providerId: FAKE_PROVIDER_ID,
        requestId: request.requestId,
        status: 200,
        type: "response",
      })
      return {
        content: validated.data,
        latencyMs: 0,
        modelId: chatModelId,
        providerId: FAKE_PROVIDER_ID,
        rawResponseHash: sha256Text(raw),
      }
    },
    async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
      emit({
        bytes: null,
        code: undefined,
        latencyMs: 0,
        method: "embed",
        model: embeddingModelId,
        providerId: FAKE_PROVIDER_ID,
        requestId: request.requestId,
        status: 200,
        type: "response",
      })
      return {
        dimension,
        modelId: embeddingModelId,
        providerId: FAKE_PROVIDER_ID,
        vector: deterministicEmbeddingVector(dimension),
      }
    },
  }
}
