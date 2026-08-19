import { createHash } from "node:crypto"
import { z } from "zod"

import { PROVIDER_ERROR_CODE, ProviderConfigurationError, ProviderError } from "./errors.js"
import type {
  EmbeddingRequest,
  EmbeddingResult,
  LLMProvider,
  ProviderEvent,
  ProviderEventSink,
  StructuredChatRequest,
  StructuredChatResult,
} from "./types.js"

const nonEmpty = z.string().min(1)
const positiveInt = z.coerce.number().int().positive()

const environmentSchema = z
  .object({
    AI_API_KEY: nonEmpty,
    AI_BASE_URL: z.url(),
    AI_CHAT_MODEL: nonEmpty,
    AI_EMBEDDING_DIMENSION: positiveInt.max(8192).optional(),
    AI_EMBEDDING_MODEL: nonEmpty,
    AI_MAX_RESPONSE_BYTES: positiveInt.max(64 * 1024 * 1024).optional(),
    AI_TIMEOUT_MS: positiveInt.max(600_000).optional(),
  })
  .strict()

export const AI_PROVIDER_ID = "openai-compatible"

export type AiProviderConfig = {
  readonly apiKey: string
  readonly baseUrl: string
  readonly chatModel: string
  readonly embeddingDimension: number | undefined
  readonly embeddingModel: string
  readonly maxResponseBytes: number
  readonly timeoutMs: number
}

export const parseAiProviderEnvironment = (
  env: Record<string, string | undefined>,
): AiProviderConfig => {
  const parsed = environmentSchema.safeParse(env)
  if (!parsed.success) {
    throw new ProviderConfigurationError(
      [...new Set(parsed.error.issues.map((issue) => issue.path.map(String).join(".")))].sort(),
    )
  }
  return {
    apiKey: parsed.data.AI_API_KEY,
    baseUrl: parsed.data.AI_BASE_URL,
    chatModel: parsed.data.AI_CHAT_MODEL,
    embeddingDimension: parsed.data.AI_EMBEDDING_DIMENSION,
    embeddingModel: parsed.data.AI_EMBEDDING_MODEL,
    maxResponseBytes: parsed.data.AI_MAX_RESPONSE_BYTES ?? 1_048_576,
    timeoutMs: parsed.data.AI_TIMEOUT_MS ?? 60_000,
  }
}

type ProviderDeps = {
  readonly fetch: typeof globalThis.fetch
  readonly now: () => number
  readonly onEvent: ProviderEventSink | undefined
}

const sha256Text = (input: string): string => createHash("sha256").update(input).digest("hex")

const RETRYABLE = "retryable" as const
const TERMINAL = "terminal" as const

const retryAfterMsOf = (header: string | null): number | undefined => {
  if (header === null) {
    return undefined
  }
  const seconds = Number(header)
  if (Number.isInteger(seconds) && seconds >= 0) {
    return seconds * 1000
  }
  const httpDate = Date.parse(header)
  if (Number.isFinite(httpDate)) {
    return Math.max(0, httpDate - Date.now())
  }
  return undefined
}

const statusErrorOf = (
  status: number,
  retryAfterMs: number | undefined,
  requestId: string | null,
): ProviderError => {
  if (status === 401 || status === 403) {
    return new ProviderError(
      PROVIDER_ERROR_CODE.AUTH_FAILED,
      TERMINAL,
      "provider rejected credentials",
      status,
      undefined,
      requestId,
    )
  }
  if (status === 408) {
    return new ProviderError(
      PROVIDER_ERROR_CODE.TIMEOUT,
      RETRYABLE,
      "provider reported request timeout",
      status,
      undefined,
      requestId,
    )
  }
  if (status === 429) {
    return new ProviderError(
      PROVIDER_ERROR_CODE.RATE_LIMITED,
      RETRYABLE,
      "provider rate limited the request",
      status,
      retryAfterMs,
      requestId,
    )
  }
  if (status >= 500) {
    return new ProviderError(
      PROVIDER_ERROR_CODE.SERVER_ERROR,
      RETRYABLE,
      "provider server error",
      status,
      undefined,
      requestId,
    )
  }
  if (status >= 400) {
    return new ProviderError(
      PROVIDER_ERROR_CODE.BAD_REQUEST,
      TERMINAL,
      "provider rejected the request",
      status,
      undefined,
      requestId,
    )
  }
  return new ProviderError(
    PROVIDER_ERROR_CODE.UNEXPECTED_STATUS,
    TERMINAL,
    `unexpected status ${status}`,
    status,
    undefined,
    requestId,
  )
}

const networkErrorOf = (error: unknown, requestId: string): ProviderError => {
  if (error instanceof DOMException && error.name === "AbortError") {
    return new ProviderError(
      PROVIDER_ERROR_CODE.TIMEOUT,
      RETRYABLE,
      "request exceeded the configured timeout",
      null,
      undefined,
      requestId,
    )
  }
  return new ProviderError(
    PROVIDER_ERROR_CODE.CONNECTION_DROPPED,
    RETRYABLE,
    "connection dropped while awaiting the provider response",
    null,
    undefined,
    requestId,
  )
}

const readBodyWithinLimit = async (
  response: Response,
  maxBytes: number,
  requestId: string,
): Promise<string> => {
  const declared = Number(response.headers.get("content-length") ?? "0")
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ProviderError(
      PROVIDER_ERROR_CODE.OVERSIZED_RESPONSE,
      TERMINAL,
      `declared body exceeds ${maxBytes} bytes`,
      response.status,
      undefined,
      requestId,
    )
  }
  const text = await response.text()
  if (text.length > maxBytes) {
    throw new ProviderError(
      PROVIDER_ERROR_CODE.OVERSIZED_RESPONSE,
      TERMINAL,
      `body exceeds ${maxBytes} bytes`,
      response.status,
      undefined,
      requestId,
    )
  }
  return text
}

export const createOpenAICompatibleProvider = (
  config: AiProviderConfig,
  deps: Partial<ProviderDeps> = {},
): LLMProvider => {
  const fetcher = deps.fetch ?? globalThis.fetch
  const now = deps.now ?? performance.now.bind(performance)
  const emit = (event: ProviderEvent) => {
    deps.onEvent?.(event)
  }

  const postJson = async <T>(
    path: string,
    method: "chat" | "embed",
    model: string,
    body: Record<string, unknown>,
    requestId: string,
  ): Promise<{ parsed: T; raw: string; responseRequestId: string | null; status: number }> => {
    emit({
      bytes: null,
      code: undefined,
      latencyMs: undefined,
      method,
      model,
      providerId: AI_PROVIDER_ID,
      requestId,
      status: null,
      type: "request",
    })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.timeoutMs)
    let response: Response
    try {
      response = await fetcher(new URL(path, config.baseUrl), {
        body: JSON.stringify(body),
        headers: {
          accept: "application/json",
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
          "x-request-id": requestId,
        },
        method: "POST",
        signal: controller.signal,
      })
    } catch (error) {
      throw networkErrorOf(error, requestId)
    } finally {
      clearTimeout(timer)
    }
    if (!response.ok) {
      const retryAfterMs = retryAfterMsOf(response.headers.get("retry-after"))
      throw statusErrorOf(
        response.status,
        retryAfterMs,
        response.headers.get("x-request-id") ?? requestId,
      )
    }
    const raw = await readBodyWithinLimit(response, config.maxResponseBytes, requestId)
    let parsed: unknown
    try {
      parsed = raw.length === 0 ? {} : JSON.parse(raw)
    } catch {
      throw new ProviderError(
        PROVIDER_ERROR_CODE.MALFORMED_RESPONSE,
        TERMINAL,
        "provider body is not valid JSON",
        response.status,
        undefined,
        requestId,
      )
    }
    return {
      parsed: parsed as T,
      raw,
      responseRequestId: response.headers.get("x-request-id"),
      status: response.status,
    }
  }

  return {
    chatModelId: config.chatModel,
    embeddingModelId: config.embeddingModel,
    providerId: AI_PROVIDER_ID,
    async generate<T>(request: StructuredChatRequest<T>): Promise<StructuredChatResult<T>> {
      const startedAt = now()
      try {
        const { parsed, raw, responseRequestId } = await postJson<unknown>(
          "/chat/completions",
          "chat",
          config.chatModel,
          {
            messages: [
              { content: request.system, role: "system" },
              { content: request.user, role: "user" },
            ],
            model: config.chatModel,
            ...(request.maxOutputTokens === undefined
              ? {}
              : { max_tokens: request.maxOutputTokens }),
            response_format: { type: "json_object" },
            ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          },
          request.requestId,
        )
        const content = (parsed as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]
          ?.message?.content
        if (typeof content !== "string") {
          throw new ProviderError(
            PROVIDER_ERROR_CODE.MALFORMED_RESPONSE,
            TERMINAL,
            "chat completion has no string content",
            null,
            undefined,
            request.requestId,
          )
        }
        let decoded: unknown
        try {
          decoded = JSON.parse(content)
        } catch {
          throw new ProviderError(
            PROVIDER_ERROR_CODE.MALFORMED_RESPONSE,
            TERMINAL,
            "chat content is not valid JSON",
            null,
            undefined,
            request.requestId,
          )
        }
        const validated = request.schema.safeParse(decoded)
        if (!validated.success) {
          throw new ProviderError(
            PROVIDER_ERROR_CODE.MALFORMED_RESPONSE,
            TERMINAL,
            "chat content failed the output schema",
            null,
            undefined,
            request.requestId,
          )
        }
        const latencyMs = now() - startedAt
        emit({
          bytes: raw.length,
          code: undefined,
          latencyMs,
          method: "chat",
          model: config.chatModel,
          providerId: AI_PROVIDER_ID,
          requestId: responseRequestId ?? request.requestId,
          status: 200,
          type: "response",
        })
        return {
          content: validated.data,
          latencyMs,
          modelId: config.chatModel,
          providerId: AI_PROVIDER_ID,
          rawResponseHash: sha256Text(raw),
        }
      } catch (error) {
        const providerError =
          error instanceof ProviderError ? error : networkErrorOf(error, request.requestId)
        emit({
          bytes: null,
          code: providerError.code,
          latencyMs: now() - startedAt,
          method: "chat",
          model: config.chatModel,
          providerId: AI_PROVIDER_ID,
          requestId: request.requestId,
          status: providerError.status,
          type: "failure",
        })
        throw providerError
      }
    },
    async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
      const startedAt = now()
      try {
        const { parsed, raw } = await postJson<unknown>(
          "/embeddings",
          "embed",
          config.embeddingModel,
          { input: request.input, model: config.embeddingModel },
          request.requestId,
        )
        const vector = (parsed as { data?: { embedding?: unknown }[] }).data?.[0]?.embedding
        if (
          !Array.isArray(vector) ||
          vector.some((component) => typeof component !== "number" || !Number.isFinite(component))
        ) {
          throw new ProviderError(
            PROVIDER_ERROR_CODE.MALFORMED_RESPONSE,
            TERMINAL,
            "embedding response has no numeric vector",
            null,
            undefined,
            request.requestId,
          )
        }
        if (
          config.embeddingDimension !== undefined &&
          vector.length !== config.embeddingDimension
        ) {
          throw new ProviderError(
            PROVIDER_ERROR_CODE.DIMENSION_MISMATCH,
            TERMINAL,
            `expected dimension ${config.embeddingDimension} but received ${vector.length}`,
            null,
            undefined,
            request.requestId,
          )
        }
        const latencyMs = now() - startedAt
        emit({
          bytes: raw.length,
          code: undefined,
          latencyMs,
          method: "embed",
          model: config.embeddingModel,
          providerId: AI_PROVIDER_ID,
          requestId: request.requestId,
          status: 200,
          type: "response",
        })
        return {
          dimension: vector.length,
          modelId: config.embeddingModel,
          providerId: AI_PROVIDER_ID,
          vector,
        }
      } catch (error) {
        const providerError =
          error instanceof ProviderError ? error : networkErrorOf(error, request.requestId)
        emit({
          bytes: null,
          code: providerError.code,
          latencyMs: now() - startedAt,
          method: "embed",
          model: config.embeddingModel,
          providerId: AI_PROVIDER_ID,
          requestId: request.requestId,
          status: providerError.status,
          type: "failure",
        })
        throw providerError
      }
    },
  }
}
