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
  type DispatchDuePublicationPlansRequest,
  dispatchDuePublicationPlansRequestSchema,
  dispatchDuePublicationPlansResponseSchema,
  type CompleteIntakeFetchRequest,
  completeIntakeFetchRequestSchema,
  type CreateRssEntriesRequest,
  createRssEntriesRequestSchema,
  type EditionInput,
  type EmbeddingReceipt,
  type FailIntakeFetchRequest,
  failIntakeFetchRequestSchema,
  intakeClaimReceiptSchema,
  intakeFailureReceiptSchema,
  type IntakeFetchInput,
  intakeFetchInputSchema,
  intakeFetchReceiptSchema,
  rssEntriesReceiptSchema,
  editionInputSchema,
  embeddingReceiptSchema,
  type EvaluateRequest,
  evaluateRequestSchema,
  type GenerateRequest,
  generateRequestSchema,
  idempotencyKeySchema,
  internalErrorSchema,
  nonTerminalOperationsResponseSchema,
  type OperationSnapshot,
  operationResponseSchema,
  type RecordAssessmentRequest,
  type RecordCompileResultRequest,
  type RecordReleaseReceiptRequest,
  recordAssessmentRequestSchema,
  recordCompileResultRequestSchema,
  recordReleaseReceiptRequestSchema,
  recordReleaseReceiptSchema,
  type RollbackRequest,
  rollbackRequestSchema,
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
  readonly idempotencyKey?: string
  readonly operationId?: string
  readonly requestId?: string
}

type IdempotentCallOptions = CallOptions & {
  readonly idempotencyKey: string
}

export class ContentServiceClient {
  readonly #config: ContentClientConfig

  constructor(config: ContentClientConfig) {
    this.#config = config
  }

  async dispatchDuePublicationPlans(
    request: DispatchDuePublicationPlansRequest,
    options: CallOptions = {},
  ): Promise<readonly { operationId: string; planId: string }[]> {
    const response = await this.#call(
      "POST",
      "/internal/publication-plans/dispatch-due",
      dispatchDuePublicationPlansRequestSchema,
      request,
      dispatchDuePublicationPlansResponseSchema,
      options,
    )
    return response.plans
  }

  async claimIntakeFetch(intakeItemId: number, options: CallOptions = {}): Promise<void> {
    await this.#call(
      "POST",
      `/internal/intake-items/${intakeItemId}/fetch-start`,
      null,
      null,
      intakeClaimReceiptSchema,
      options,
    )
  }

  async getIntakeFetchInput(intakeItemId: number): Promise<IntakeFetchInput> {
    return this.#call(
      "GET",
      `/internal/intake-items/${intakeItemId}/fetch-input`,
      null,
      null,
      intakeFetchInputSchema,
    )
  }

  async completeIntakeFetch(
    intakeItemId: number,
    request: CompleteIntakeFetchRequest,
    options: CallOptions = {},
  ): Promise<{ readonly intakeItemId: number; readonly snapshotId: number }> {
    return this.#call(
      "POST",
      `/internal/intake-items/${intakeItemId}/fetch-complete`,
      completeIntakeFetchRequestSchema,
      request,
      intakeFetchReceiptSchema,
      options,
    )
  }

  async failIntakeFetch(
    intakeItemId: number,
    request: FailIntakeFetchRequest,
    options: CallOptions = {},
  ): Promise<void> {
    await this.#call(
      "POST",
      `/internal/intake-items/${intakeItemId}/fetch-failed`,
      failIntakeFetchRequestSchema,
      request,
      intakeFailureReceiptSchema,
      options,
    )
  }

  async createRssEntries(
    intakeItemId: number,
    request: CreateRssEntriesRequest,
    options: CallOptions = {},
  ): Promise<readonly number[]> {
    const response = await this.#call(
      "POST",
      `/internal/intake-items/${intakeItemId}/rss-entries`,
      createRssEntriesRequestSchema,
      request,
      rssEntriesReceiptSchema,
      options,
    )
    return response.intakeItemIds
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

  async generateOperation(
    request: GenerateRequest,
    options: IdempotentCallOptions,
  ): Promise<{ created: boolean; operation: OperationSnapshot }> {
    return this.#call(
      "POST",
      "/internal/operations/generate",
      generateRequestSchema,
      request,
      submitOperationResponseSchema,
      options,
    )
  }

  async evaluateOperation(
    request: EvaluateRequest,
    options: IdempotentCallOptions,
  ): Promise<{ created: boolean; operation: OperationSnapshot }> {
    return this.#call(
      "POST",
      "/internal/operations/evaluate",
      evaluateRequestSchema,
      request,
      submitOperationResponseSchema,
      options,
    )
  }

  async rollbackOperation(
    request: RollbackRequest,
    options: IdempotentCallOptions,
  ): Promise<{ created: boolean; operation: OperationSnapshot }> {
    return this.#call(
      "POST",
      "/internal/operations/rollback",
      rollbackRequestSchema,
      request,
      submitOperationResponseSchema,
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
    const headers = new Headers({ authorization: `users API-Key ${this.#config.apiKey}` })
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
    if (options.idempotencyKey !== undefined) {
      const validatedIdempotencyKey = idempotencyKeySchema.safeParse(options.idempotencyKey)
      if (!validatedIdempotencyKey.success) {
        throw new ContentClientError(
          "CLIENT_REQUEST_INVALID",
          0,
          null,
          validatedIdempotencyKey.error.issues
            .map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`)
            .join("; "),
        )
      }
      headers.set("idempotency-key", validatedIdempotencyKey.data)
    }
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
