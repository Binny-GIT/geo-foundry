export const CONTENT_SERVICE_API_VERSION = "1.0.0"

const errorResponses = {
  "400": { description: "Missing idempotency key or schema-invalid body" },
  "401": { description: "Missing or invalid operator API key" },
  "409": { description: "Idempotency key reused with a different request fingerprint" },
  "413": { description: "Body exceeds the configured size limit" },
}

const acceptedResponse = {
  "202": {
    description: "Operation created; poll the Location URL for progress",
    headers: { Location: { schema: { type: "string" }, description: "Operation URL" } },
  },
  "200": { description: "Exact replay of a previously accepted request" },
}

export const contentServiceOpenApiDocument = {
  info: {
    description:
      "Staged content generation and evaluation API. Every mutating request requires an Idempotency-Key; work is asynchronous and observed through the operation resource.",
    title: "Geo Foundry Content Service API",
    version: CONTENT_SERVICE_API_VERSION,
  },
  openapi: "3.1.0",
  paths: {
    "/v1/evaluate": {
      post: {
        operationId: "createEvaluation",
        requestBody: { required: true },
        responses: { ...errorResponses, ...acceptedResponse },
        summary: "Run the three-layer quality gate for an edition",
      },
    },
    "/v1/generate": {
      post: {
        operationId: "createGeneration",
        requestBody: { required: true },
        responses: { ...errorResponses, ...acceptedResponse },
        summary: "Create a staged generation operation from an operator brief",
      },
    },
    "/v1/publish": {
      post: {
        operationId: "createPublish",
        requestBody: { required: true },
        responses: { ...errorResponses, ...acceptedResponse },
        summary: "Publish the release built from an approved edition",
      },
    },
    "/v1/openapi.json": {
      get: {
        operationId: "getOpenApiDocument",
        responses: { "200": { description: "This document" } },
        summary: "OpenAPI document",
      },
    },
    "/v1/operations/{operationId}": {
      get: {
        operationId: "getOperation",
        parameters: [
          {
            in: "path",
            name: "operationId",
            required: true,
            schema: { type: "string", pattern: "^[A-Za-z0-9._-]{4,128}$" },
          },
        ],
        responses: {
          "200": { description: "Operation snapshot" },
          "401": errorResponses["401"],
          "404": { description: "Unknown operation" },
        },
        summary: "Fetch an operation snapshot",
      },
    },
  },
  servers: [{ url: "/" }],
} as const
