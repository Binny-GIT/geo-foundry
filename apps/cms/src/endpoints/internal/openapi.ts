import { INTERNAL_PATHS } from "./contracts"

export const INTERNAL_API_VERSION = "1.0.0"

export type InternalOperationDescriptor = {
  readonly method: "get" | "post"
  readonly operationId: string
  readonly path: (typeof INTERNAL_PATHS)[keyof typeof INTERNAL_PATHS]
}

export const INTERNAL_OPERATIONS: readonly InternalOperationDescriptor[] = [
  { method: "get", operationId: "getEditionInput", path: INTERNAL_PATHS.input },
  {
    method: "post",
    operationId: "dispatchDuePublicationPlans",
    path: INTERNAL_PATHS.publicationPlansDispatchDue,
  },
  {
    method: "post",
    operationId: "pollDueConnectors",
    path: INTERNAL_PATHS.pollDueConnectors,
  },
  { method: "get", operationId: "getIntakeFetchInput", path: INTERNAL_PATHS.intakeFetchInput },
  { method: "post", operationId: "claimIntakeFetch", path: INTERNAL_PATHS.intakeFetchStart },
  { method: "post", operationId: "completeIntakeFetch", path: INTERNAL_PATHS.intakeFetchComplete },
  { method: "post", operationId: "failIntakeFetch", path: INTERNAL_PATHS.intakeFetchFailed },
  { method: "post", operationId: "createRssEntries", path: INTERNAL_PATHS.intakeRssEntries },
  { method: "get", operationId: "getCompileSnapshot", path: INTERNAL_PATHS.compileSnapshot },
  { method: "post", operationId: "writeDraftVersion", path: INTERNAL_PATHS.versions },
  { method: "post", operationId: "recordAssessment", path: INTERNAL_PATHS.assessments },
  { method: "post", operationId: "recordCompileResult", path: INTERNAL_PATHS.compileResults },
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
]

const openApiPath = (routePath: string): string =>
  routePath.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, "{$1}")

const jsonSchemaRef = {
  content: { "application/json": { schema: { type: "object" } } },
}

const INTERNAL_SECURITY = [{ serviceApiKey: [] }]

const errorResponses = {
  "400": { description: "Malformed or schema-invalid request" },
  "401": { description: "Missing or invalid service identity" },
  "403": { description: "Non-service identity or tenant mismatch" },
  "404": { description: "Requested resource was not found or is outside the tenant scope" },
  "413": { description: "Body exceeds the configured size limit" },
  "429": { description: "Rate limit exceeded" },
}

const parameterByName = {
  id: { $ref: "#/components/parameters/ResourceId" },
  operationId: { $ref: "#/components/parameters/OperationId" },
} as const

const parametersOf = (routePath: string) =>
  [...routePath.matchAll(/:([A-Za-z][A-Za-z0-9_]*)/g)].map((match) => {
    const name = match[1]
    if (name === "id" || name === "operationId") return parameterByName[name]
    throw new Error(`missing OpenAPI parameter definition for ${name ?? "unknown"}`)
  })

const getOperation = (descriptor: InternalOperationDescriptor) => {
  const parameters = parametersOf(descriptor.path)
  return {
    operationId: descriptor.operationId,
    ...(parameters.length === 0 ? {} : { parameters }),
    responses: {
      ...errorResponses,
      "200": { description: "Success", ...jsonSchemaRef },
      "409": { description: "Workflow state conflict" },
    },
    security: INTERNAL_SECURITY,
    tags: ["internal"],
  }
}

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
      OperationId: {
        description: "Operation identifier",
        in: "path",
        name: "operationId",
        required: true,
        schema: { type: "string", minLength: 1, maxLength: 128 },
      },
      ResourceId: {
        description: "Numeric resource identifier",
        in: "path",
        name: "id",
        required: true,
        schema: { type: "integer", minimum: 1 },
      },
    },
    securitySchemes: {
      serviceApiKey: {
        description: "Tenant-scoped content-service API key",
        in: "header",
        name: "Authorization",
        type: "apiKey",
      },
    },
  },
  info: {
    description:
      "Zero-trust integration surface between the CMS and the content-service. Every call requires a tenant-scoped content-service identity.",
    title: "Geo Foundry CMS Internal API",
    version: INTERNAL_API_VERSION,
  },
  openapi: "3.1.0",
  paths: pathsOfOperations(),
  servers: [{ url: "/api" }],
  tags: [{ description: "Internal worker integration operations", name: "internal" }],
}
