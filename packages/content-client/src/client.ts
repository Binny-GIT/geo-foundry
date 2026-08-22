import type { z } from "zod"

import {
  type AssessmentReceipt,
  assessmentReceiptSchema,
  type CancelOperationRequest,
  type CompileResultReceipt,
  type CompileSnapshot,
  type CompleteOperationStageRequest,
  type ConsumeRollbackIntentRequest,
  cancelOperationRequestSchema,
  compileResultReceiptSchema,
  compileSnapshotSchema,
  completeOperationStageRequestSchema,
  consumeRollbackIntentReceiptSchema,
  consumeRollbackIntentRequestSchema,
  type DraftWriteReceipt,
  draftWriteReceiptSchema,
  type EditionInput,
  type EmbeddingReceipt,
  editionInputSchema,
  embeddingReceiptSchema,
  internalErrorSchema,
  nonTerminalOperationsResponseSchema,
  type OperationSnapshot,
  operationResponseSchema,
  type PublishRequestReceipt,
  publishRequestReceiptSchema,
  type RecordAssessmentRequest,
  type RecordCompileResultRequest,
  type RecordReleaseReceiptRequest,
  type RequestPublishRequest,
  recordAssessmentRequestSchema,
  recordCompileResultRequestSchema,
  recordReleaseReceiptRequestSchema,
  recordReleaseReceiptSchema,
  requestPublishRequestSchema,
  type SimilarityMatch,
  type SimilarityQueryRequest,
  type StartOperationStageRequest,
  type StoreEmbeddingRequest,
  type SubmitOperationRequest,
  similarityQueryRequestSchema,
  similarityResponseSchema,
  startOperationStageRequestSchema,
  storeEmbeddingRequestSchema,
  submitOperationRequestSchema,
  submitOperationResponseSchema,
  type WriteDraftVersionRequest,
  writeDraftVersionRequestSchema,
} from "./schemas.js"

export class ContentClientError extends Error {
  override readonly name = "ContentClientError"

  constructor(
    readonly code: string,
    readonly status: number,
    readonly requestId: string | null,
    message?: string,
  ) {
    super(message ?? code)
  }
}

export type ContentClientConfig = {
  readonly apiKey: string
  readonly baseUrl: string
  readonly fetch?: typeof globalThis.fetch
}

export type CallOptions = {
  readonly operationId?: string
  readonly requestId?: string
}

export class ContentServiceClient {
  readonly #config: ContentClientConfig

  constructor(config: ContentClientConfig) {
    this.#config = config
  }

  async getEditionInput(editionId: number): Promise<EditionInput> {
    return this.#call(
      "GET",
      `/internal/editions/${editionId}/input`,
      null,
      null,
      editionInputSchema,
    )
  }

  async getCompileSnapshot(siteId: number): Promise<CompileSnapshot> {
    return this.#call(
      "GET",
      `/internal/sites/${siteId}/compile-snapshot`,
      null,
      null,
      compileSnapshotSchema,
    )
  }

  async writeDraftVersion(
    editionId: number,
    request: WriteDraftVersionRequest,
    options: CallOptions = {},
  ): Promise<DraftWriteReceipt> {
    return this.#call(
      "POST",
      `/internal/editions/${editionId}/versions`,
      writeDraftVersionRequestSchema,
      request,
      draftWriteReceiptSchema,
      options,
    )
  }

  async recordAssessment(
    editionId: number,
    request: RecordAssessmentRequest,
    options: CallOptions = {},
  ): Promise<AssessmentReceipt> {
    return this.#call(
      "POST",
      `/internal/editions/${editionId}/assessments`,
      recordAssessmentRequestSchema,
      request,
      assessmentReceiptSchema,
      options,
    )
  }

  async recordCompileResult(
    editionId: number,
    request: RecordCompileResultRequest,
    options: CallOptions = {},
  ): Promise<CompileResultReceipt> {
    return this.#call(
      "POST",
      `/internal/editions/${editionId}/compile-results`,
      recordCompileResultRequestSchema,
      request,
      compileResultReceiptSchema,
      options,
    )
  }

  async consumeRollbackIntent(
    request: ConsumeRollbackIntentRequest,
    options: CallOptions = {},
  ): Promise<void> {
    await this.#call(
      "POST",
      "/internal/rollback-intents/consume",
      consumeRollbackIntentRequestSchema,
      request,
      consumeRollbackIntentReceiptSchema,
      options,
    )
  }

  async recordPublishedRelease(
    siteId: number,
    request: RecordReleaseReceiptRequest,
    options: CallOptions = {},
  ): Promise<void> {
    await this.#call(
      "POST",
      `/internal/sites/${siteId}/releases/published`,
      recordReleaseReceiptRequestSchema,
      request,
      recordReleaseReceiptSchema,
      options,
    )
  }

  async recordRollbackReceipt(
    request: RecordReleaseReceiptRequest,
    options: CallOptions = {},
  ): Promise<void> {
    await this.#call(
      "POST",
      "/internal/releases/rollback-receipt",
      recordReleaseReceiptRequestSchema,
      request,
      recordReleaseReceiptSchema,
      options,
    )
  }

  async requestPublish(
    editionId: number,
    request: RequestPublishRequest = {},
    options: CallOptions = {},
  ): Promise<PublishRequestReceipt> {
    return this.#call(
      "POST",
      `/internal/editions/${editionId}/publish-requests`,
      requestPublishRequestSchema,
      request,
      publishRequestReceiptSchema,
      options,
    )
  }

  async submitOperation(
    request: SubmitOperationRequest,
    options: CallOptions = {},
  ): Promise<{ created: boolean; operation: OperationSnapshot }> {
    return this.#call(
      "POST",
      "/internal/operations/submit",
      submitOperationRequestSchema,
      request,
      submitOperationResponseSchema,
      options,
    )
  }

  async getOperation(operationId: string): Promise<OperationSnapshot> {
    return (
      await this.#call(
        "GET",
        `/internal/operations/${encodeURIComponent(operationId)}`,
        null,
        null,
        operationResponseSchema,
      )
    ).operation
  }

  async startOperationStage(
    operationId: string,
    request: StartOperationStageRequest,
    options: CallOptions = {},
  ): Promise<OperationSnapshot> {
    return (
      await this.#call(
        "POST",
        `/internal/operations/${encodeURIComponent(operationId)}/stages/start`,
        startOperationStageRequestSchema,
        request,
        operationResponseSchema,
        options,
      )
    ).operation
  }

  async completeOperationStage(
    operationId: string,
    request: CompleteOperationStageRequest,
    options: CallOptions = {},
  ): Promise<OperationSnapshot> {
    return (
      await this.#call(
        "POST",
        `/internal/operations/${encodeURIComponent(operationId)}/stages/complete`,
        completeOperationStageRequestSchema,
        request,
        operationResponseSchema,
        options,
      )
    ).operation
  }

  async cancelOperation(
    operationId: string,
    request: CancelOperationRequest,
    options: CallOptions = {},
  ): Promise<OperationSnapshot> {
    return (
      await this.#call(
        "POST",
        `/internal/operations/${encodeURIComponent(operationId)}/cancel`,
        cancelOperationRequestSchema,
        request,
        operationResponseSchema,
        options,
      )
    ).operation
  }

  async listNonTerminalOperations(): Promise<readonly OperationSnapshot[]> {
    return (
      await this.#call(
        "GET",
        "/internal/operations/non-terminal",
        null,
        null,
        nonTerminalOperationsResponseSchema,
      )
    ).operations
  }

  async storeEmbedding(
    editionId: number,
    request: StoreEmbeddingRequest,
    options: CallOptions = {},
  ): Promise<EmbeddingReceipt> {
    return this.#call(
      "POST",
      `/internal/editions/${editionId}/embeddings`,
      storeEmbeddingRequestSchema,
      request,
      embeddingReceiptSchema,
      options,
    )
  }

  async findSimilarEditions(
    editionId: number,
    request: SimilarityQueryRequest,
    options: CallOptions = {},
  ): Promise<readonly SimilarityMatch[]> {
    const response = await this.#call(
      "POST",
      `/internal/editions/${editionId}/similarity`,
      similarityQueryRequestSchema,
      request,
      similarityResponseSchema,
      options,
    )
    return response.matches
  }

  async #call<TResponse>(
    method: "GET" | "POST",
    path: string,
    requestSchema: z.ZodType<unknown> | null,
    request: unknown,
    responseSchema: z.ZodType<TResponse>,
    options: CallOptions = {},
  ): Promise<TResponse> {
    const headers = new Headers({ authorization: `Bearer ${this.#config.apiKey}` })
    let body: string | null = null
    if (requestSchema !== null) {
      const validatedRequest = requestSchema.safeParse(request)
      if (!validatedRequest.success) {
        throw new ContentClientError(
          "CLIENT_REQUEST_INVALID",
          0,
          null,
          validatedRequest.error.issues
            .map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`)
            .join("; "),
        )
      }
      headers.set("content-type", "application/json")
      body = JSON.stringify(validatedRequest.data)
    }
    const requestId = options.requestId ?? crypto.randomUUID()
    headers.set("x-request-id", requestId)
    if (options.operationId !== undefined) {
      headers.set("x-operation-id", options.operationId)
    }
    const fetcher = this.#config.fetch ?? globalThis.fetch
    const response = await fetcher(`${this.#config.baseUrl}/api${path}`, {
      body,
      headers,
      method,
    })
    const rawText = await response.text()
    const parsedJson: unknown = rawText.length === 0 ? {} : JSON.parse(rawText)
    if (!response.ok) {
      const errorShape = internalErrorSchema.safeParse(parsedJson)
      if (errorShape.success) {
        throw new ContentClientError(
          errorShape.data.error.code,
          response.status,
          errorShape.data.error.requestId,
          errorShape.data.error.message,
        )
      }
      throw new ContentClientError(
        "CLIENT_RESPONSE_UNEXPECTED",
        response.status,
        response.headers.get("x-request-id"),
      )
    }
    const validatedResponse = responseSchema.safeParse(parsedJson)
    if (!validatedResponse.success) {
      throw new ContentClientError(
        "CLIENT_RESPONSE_SCHEMA_MISMATCH",
        response.status,
        response.headers.get("x-request-id"),
      )
    }
    return validatedResponse.data
  }
}
