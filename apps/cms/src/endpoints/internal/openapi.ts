import { INTERNAL_PATHS } from "./contracts"

export const INTERNAL_API_VERSION = "1.0.0"

export type InternalOperationDescriptor = {
  readonly method: "get" | "post"
  readonly operationId: string
  readonly path: (typeof INTERNAL_PATHS)[keyof typeof INTERNAL_PATHS]
}

export const INTERNAL_OPERATIONS: readonly InternalOperationDescriptor[] = [
  { method: "get", operationId: "getEditionInput", path: INTERNAL_PATHS.input },
  { method: "get", operationId: "getCompileSnapshot", path: INTERNAL_PATHS.compileSnapshot },
  { method: "post", operationId: "writeDraftVersion", path: INTERNAL_PATHS.versions },
  { method: "post", operationId: "recordAssessment", path: INTERNAL_PATHS.assessments },
  { method: "post", operationId: "recordCompileResult", path: INTERNAL_PATHS.compileResults },
  { method: "post", operationId: "requestPublish", path: INTERNAL_PATHS.publishRequests },
  {
    method: "post",
    operationId: "consumeRollbackIntent",
    path: INTERNAL_PATHS.consumeRollbackIntent,
  },
  {
    method: "post",
    operationId: "recordPublishedRelease",
    path: INTERNAL_PATHS.recordPublishedRelease,
  },
  {
    method: "post",
    operationId: "recordRollbackReceipt",
    path: INTERNAL_PATHS.recordRollbackReceipt,
  },
  { method: "post", operationId: "storeEmbedding", path: INTERNAL_PATHS.embeddings },
  { method: "post", operationId: "findSimilarEditions", path: INTERNAL_PATHS.similarity },
  { method: "post", operationId: "submitOperation", path: INTERNAL_PATHS.operationSubmit },
  { method: "get", operationId: "getOperation", path: INTERNAL_PATHS.operationGet },
  {
    method: "post",
    operationId: "startOperationStage",
    path: INTERNAL_PATHS.operationStageStart,
  },
  {
    method: "post",
    operationId: "completeOperationStage",
    path: INTERNAL_PATHS.operationStageComplete,
  },
  { method: "post", operationId: "cancelOperation", path: INTERNAL_PATHS.operationCancel },
  {
    method: "get",
    operationId: "listNonTerminalOperations",
    path: INTERNAL_PATHS.operationsNonTerminal,
  },
]

const openApiPath = (routePath: string): string => routePath.replace(":id", "{id}")

const jsonSchemaRef = {
  content: { "application/json": { schema: { type: "object" } } },
}

const INTERNAL_SECURITY = [{ serviceApiKey: [] }]

const errorResponses = {
  "400": { description: "Malformed or schema-invalid body" },
  "401": { description: "Missing or invalid service identity" },
  "403": { description: "Non-service identity or tenant mismatch" },
  "413": { description: "Body exceeds the configured size limit" },
  "429": { description: "Rate limit exceeded" },
}

const getOperation = (descriptor: InternalOperationDescriptor) => ({
  operationId: descriptor.operationId,
  parameters: [{ $ref: "#/components/parameters/EditionId" }],
  responses: {
    ...errorResponses,
    "200": { description: "Success", ...jsonSchemaRef },
    "404": { description: "Unknown edition" },
    "409": { description: "Workflow state conflict" },
  },
  security: INTERNAL_SECURITY,
  tags: ["internal-editions"],
})

const pathsOfOperations = (): Record<string, Record<string, ReturnType<typeof getOperation>>> => {
  const paths: Record<string, Record<string, ReturnType<typeof getOperation>>> = {}
  for (const operation of INTERNAL_OPERATIONS) {
    const pathKey = openApiPath(operation.path)
    const pathItem = paths[pathKey] ?? {}
    pathItem[operation.method] = getOperation(operation)
    paths[pathKey] = pathItem
  }
  return paths
}

export const internalOpenApiDocument = {
  components: {
    parameters: {
      EditionId: {
        description: "Numeric ContentEdition id",
        in: "path",
        name: "id",
        required: true,
        schema: { type: "integer", minimum: 1 },
      },
    },
    securitySchemes: {
      serviceApiKey: {
        description: "Payload users API key of a tenant-scoped content-service identity",
        in: "header",
        name: "Authorization",
        type: "apiKey",
      },
    },
  },
  info: {
    description:
      "Zero-trust integration surface between the CMS and the content-service. Every call requires the content-service identity, is tenant-bound, and records correlated outbox events.",
    title: "Geo Foundry CMS Internal API",
    version: INTERNAL_API_VERSION,
  },
  openapi: "3.1.0",
  paths: pathsOfOperations(),
  servers: [{ url: "/api" }],
  tags: [{ description: "Edition integration operations", name: "internal-editions" }],
}
