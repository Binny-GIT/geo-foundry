import {
  ContentClientError,
  type ContentServiceClient,
  type CallOptions,
  type CancelOperationRequest,
  type CompleteOperationStageRequest,
  type OperationSnapshot,
  type StartOperationStageRequest,
  type SubmitOperationRequest,
} from "@geo/content-client"

export { ContentClientError }

export type SubmitOutcome =
  | { readonly kind: "created"; readonly operation: OperationSnapshot }
  | { readonly kind: "replay"; readonly operation: OperationSnapshot }

export type LedgerCallOptions = CallOptions

/**
 * Thin operation-ledger facade over the CMS integration client. It maps the
 * wire semantics (202 created / 200 replay / 409 reused key) into a typed
 * discriminated union so pipeline code never string-matches status codes.
 */
export class OperationsLedger {
  readonly #client: ContentServiceClient

  constructor(client: ContentServiceClient) {
    this.#client = client
  }

  async submit(
    request: SubmitOperationRequest,
    options: LedgerCallOptions = {},
  ): Promise<SubmitOutcome> {
    const response = await this.#client.submitOperation(request, options)
    return response.created
      ? { kind: "created", operation: response.operation }
      : { kind: "replay", operation: response.operation }
  }

  async get(operationId: string): Promise<OperationSnapshot> {
    return this.#client.getOperation(operationId)
  }

  async startStage(
    operationId: string,
    request: StartOperationStageRequest,
    options: LedgerCallOptions = {},
  ): Promise<OperationSnapshot> {
    return this.#client.startOperationStage(operationId, request, options)
  }

  async completeStage(
    operationId: string,
    request: CompleteOperationStageRequest,
    options: LedgerCallOptions = {},
  ): Promise<OperationSnapshot> {
    return this.#client.completeOperationStage(operationId, request, options)
  }

  async cancel(
    operationId: string,
    request: CancelOperationRequest,
    options: LedgerCallOptions = {},
  ): Promise<OperationSnapshot> {
    return this.#client.cancelOperation(operationId, request, options)
  }
}
