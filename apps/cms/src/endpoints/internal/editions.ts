import type { PayloadRequest } from "payload"

import { findSimilarEditions } from "../../services/embedding-similarity"
import { storeEditionEmbedding } from "../../services/embedding-store"
import {
  readEditionInput,
  recordCompileResult,
  writeGeneratedDraft,
} from "../../services/edition-integration"
import { EditionWorkflowError, recordAssessment } from "../../services/edition-workflow"
import {
  assessmentBodySchema,
  compileResultBodySchema,
  draftVersionBodySchema,
  embeddingStoreBodySchema,
  similarityQueryBodySchema,
  type AssessmentBody,
  type CompileResultBody,
  type DraftVersionBody,
  type EmbeddingStoreBody,
  type SimilarityQueryBody,
} from "./contracts"
import { internalJsonResponse, withInternalGuards } from "./guards"

const editionIdOf = (req: PayloadRequest): number => {
  const raw = req.routeParams?.["id"]
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new EditionWorkflowError("EDITION_WORKFLOW_ROW_INVALID", `route id ${String(raw)}`)
  }
  return parsed
}

const handleGetEditionInput = withInternalGuards(
  { bodySchema: null, operation: "getEditionInput" },
  async (req, ctx) => {
    const snapshot = await readEditionInput(req.payload, {
      editionId: editionIdOf(req),
      user: req.user,
    })
    return internalJsonResponse(200, snapshot, ctx.requestId, null)
  },
)

const handleWriteDraftVersion = withInternalGuards(
  { bodySchema: draftVersionBodySchema, operation: "writeDraftVersion" },
  async (req, ctx, body: DraftVersionBody) => {
    const receipt = await writeGeneratedDraft(req.payload, {
      editionId: editionIdOf(req),
      ...(ctx.operationId === null ? {} : { operationId: ctx.operationId }),
      patch: {
        ...(body.body === undefined ? {} : { body: body.body }),
        ...(body.primaryTopic === undefined ? {} : { primaryTopic: body.primaryTopic }),
        ...(body.secondaryTopics === undefined ? {} : { secondaryTopics: body.secondaryTopics }),
        ...(body.summary === undefined ? {} : { summary: body.summary }),
        ...(body.title === undefined ? {} : { title: body.title }),
      },
      requestId: ctx.requestId,
      user: req.user,
    })
    return internalJsonResponse(200, receipt, ctx.requestId, null)
  },
)

const handleRecordAssessment = withInternalGuards(
  { bodySchema: assessmentBodySchema, operation: "recordAssessment" },
  async (req, ctx, body: AssessmentBody) => {
    const assessmentId = await recordAssessment(req.payload, {
      editionId: editionIdOf(req),
      inputHash: body.inputHash,
      issues: body.issues,
      modelId: body.modelId,
      ...(ctx.operationId === null ? {} : { operationId: ctx.operationId }),
      promptVersion: body.promptVersion,
      provider: body.provider,
      requestId: ctx.requestId,
      state: body.state,
      thresholdsHash: body.thresholdsHash,
      user: req.user,
    })
    return internalJsonResponse(200, { assessmentId }, ctx.requestId, null)
  },
)

const handleRecordCompileResult = withInternalGuards(
  { bodySchema: compileResultBodySchema, operation: "recordCompileResult" },
  async (req, ctx, body: CompileResultBody) => {
    const receipt = await recordCompileResult(req.payload, {
      editionId: editionIdOf(req),
      manifestSha256: body.manifestSha256,
      objectCount: body.objectCount,
      ...(ctx.operationId === null ? {} : { operationId: ctx.operationId }),
      releaseId: body.releaseId,
      requestId: ctx.requestId,
      totalBytes: body.totalBytes,
      user: req.user,
    })
    return internalJsonResponse(200, receipt, ctx.requestId, null)
  },
)

const handleStoreEmbedding = withInternalGuards(
  { bodySchema: embeddingStoreBodySchema, operation: "storeEmbedding" },
  async (req, ctx, body: EmbeddingStoreBody) => {
    const receipt = await storeEditionEmbedding(req.payload, {
      dimension: body.dimension,
      editionId: editionIdOf(req),
      inputHash: body.inputHash,
      modelId: body.modelId,
      scope: body.scope,
      user: req.user,
      vector: body.vector,
    })
    return internalJsonResponse(200, receipt, ctx.requestId, null)
  },
)

const handleFindSimilarEditions = withInternalGuards(
  { bodySchema: similarityQueryBodySchema, operation: "findSimilarEditions" },
  async (req, ctx, body: SimilarityQueryBody) => {
    const matches = await findSimilarEditions(req.payload, {
      comparison: body.comparison,
      dimension: body.dimension,
      editionId: editionIdOf(req),
      limit: body.limit,
      modelId: body.modelId,
      scope: body.scope,
      user: req.user,
      vector: body.vector,
    })
    return internalJsonResponse(200, { matches }, ctx.requestId, null)
  },
)

export const editionHandlerByOperation: Record<string, typeof handleGetEditionInput> = {
  getEditionInput: handleGetEditionInput,
  findSimilarEditions: handleFindSimilarEditions,
  recordAssessment: handleRecordAssessment,
  recordCompileResult: handleRecordCompileResult,
  storeEmbedding: handleStoreEmbedding,
  writeDraftVersion: handleWriteDraftVersion,
}
