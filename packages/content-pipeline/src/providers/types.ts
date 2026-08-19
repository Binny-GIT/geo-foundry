import type { z } from "zod"

export interface StructuredChatRequest<T> {
  readonly maxOutputTokens: number | undefined
  readonly promptVersion: string
  readonly requestId: string
  readonly schema: z.ZodType<T>
  readonly system: string
  readonly temperature: number | undefined
  readonly user: string
}

export interface StructuredChatResult<T> {
  readonly content: T
  readonly latencyMs: number
  readonly modelId: string
  readonly providerId: string
  readonly rawResponseHash: string
}

export interface EmbeddingRequest {
  readonly input: string
  readonly requestId: string
}

export interface EmbeddingResult {
  readonly dimension: number
  readonly modelId: string
  readonly providerId: string
  readonly vector: readonly number[]
}

export type ProviderEvent = {
  readonly bytes: number | null
  readonly code: string | undefined
  readonly latencyMs: number | undefined
  readonly method: "chat" | "embed"
  readonly model: string
  readonly providerId: string
  readonly requestId: string
  readonly status: number | null
  readonly type: "failure" | "request" | "response"
}

export type ProviderEventSink = (event: ProviderEvent) => void

/**
 * The single narrow provider surface of the platform: structured chat
 * generation (Zod-validated JSON output) plus embeddings. Adapters must
 * classify failures as retryable or terminal and never retry internally -
 * the caller owns retry decisions because a retried billable submission is
 * a business decision, not a transport one.
 */
export interface LLMProvider {
  readonly chatModelId: string
  readonly embeddingModelId: string
  readonly providerId: string
  generate<T>(request: StructuredChatRequest<T>): Promise<StructuredChatResult<T>>
  embed(request: EmbeddingRequest): Promise<EmbeddingResult>
}
