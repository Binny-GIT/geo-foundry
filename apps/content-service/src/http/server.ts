import type {
  ContentServiceClient,
  OperationSnapshot,
  SubmitOperationRequest,
} from "@geo/content-client"
import { ContentClientError } from "@geo/content-client"
import { createServer, type Server } from "node:http"
import type { ZodType } from "zod"

import { canonicalJson, sha256Hex } from "@geo/content-pipeline"
import {
  CONTENT_SERVICE_ERROR_CODE,
  ENDPOINT,
  IDEMPOTENCY_KEY_PATTERN,
  OPERATION_ID_PATTERN,
  evaluateRequestSchema,
  generateRequestSchema,
  publishRequestSchema,
} from "./contracts.js"
import { contentServiceOpenApiDocument } from "./openapi.js"

type LedgerClient = Pick<ContentServiceClient, "getOperation" | "submitOperation">

export type ContentServiceServerConfig = {
  readonly apiKey: string
  readonly client: LedgerClient
  readonly host?: string
  readonly maxBodyBytes?: number
  readonly onOperationCreated?: (operation: OperationSnapshot) => Promise<void>
  readonly port?: number
}

export type ContentServiceServer = {
  close: () => Promise<void>
  listen: () => Promise<string>
}

const UPSTREAM_STATUS_BY_CODE: Readonly<Record<string, number>> = {
  IDEMPOTENCY_KEY_REUSED: 409,
  OPERATION_NOT_FOUND: 404,
}

const json = (status: number, body: unknown, extraHeaders: Record<string, string> = {}) => {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    ...extraHeaders,
  })
  return new Response(JSON.stringify(body), { headers, status })
}

const errorJson = (
  status: number,
  code: string,
  requestId: string,
  extra: Record<string, unknown> = {},
) => json(status, { error: { code, requestId, ...extra } }, { "x-request-id": requestId })

/**
 * Zero-trust HTTP surface for the content-service: operator API-key auth,
 * required Idempotency-Key on mutating endpoints, canonical request hashing
 * delegated to the CMS operation ledger, byte-capped JSON bodies, and a
 * fire-and-forget executor hook (the BullMQ worker subscribes in a later
 * task; until then operations simply stay queued).
 */
export const createContentServiceServer = (
  config: ContentServiceServerConfig,
): ContentServiceServer => {
  const maxBodyBytes = config.maxBodyBytes ?? 1_048_576
  let server: Server | null = null

  const submit = async (
    requestId: string,
    endpoint: string,
    operationType: SubmitOperationRequest["operationType"],
    idempotencyKey: string,
    body: unknown,
    requestHash: string,
  ): Promise<Response> => {
    let outcome: Awaited<ReturnType<LedgerClient["submitOperation"]>>
    try {
      outcome = await config.client.submitOperation({
        endpoint,
        idempotencyKey,
        operationType,
        requestPayload: { body, requestHash },
      })
    } catch (error) {
      if (error instanceof ContentClientError) {
        const status = UPSTREAM_STATUS_BY_CODE[error.code] ?? 502
        return errorJson(status, error.code, requestId, {
          message: error.message === error.code ? undefined : error.message,
        })
      }
      return errorJson(502, CONTENT_SERVICE_ERROR_CODE.UPSTREAM, requestId)
    }
    if (outcome.created) {
      void Promise.resolve(config.onOperationCreated?.(outcome.operation)).catch(() => {})
    }
    return json(
      outcome.created ? 202 : 200,
      { operation: outcome.operation },
      {
        "x-request-id": requestId,
        ...(outcome.created ? { location: `/v1/operations/${outcome.operation.operationId}` } : {}),
      },
    )
  }

  const handleMutating = async (
    requestId: string,
    endpoint: string,
    operationType: SubmitOperationRequest["operationType"],
    schema: ZodType<unknown>,
    rawBody: string,
    headers: Headers,
  ): Promise<Response> => {
    if (rawBody.length > maxBodyBytes) {
      return errorJson(413, CONTENT_SERVICE_ERROR_CODE.BODY_TOO_LARGE, requestId)
    }
    const idempotencyKey = headers.get("idempotency-key")
    if (idempotencyKey === null || idempotencyKey.length === 0) {
      return errorJson(400, CONTENT_SERVICE_ERROR_CODE.IDEMPOTENCY_KEY_REQUIRED, requestId)
    }
    if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      return errorJson(400, CONTENT_SERVICE_ERROR_CODE.IDEMPOTENCY_KEY_INVALID, requestId)
    }
    let parsedBody: unknown
    try {
      parsedBody = rawBody.length === 0 ? {} : JSON.parse(rawBody)
    } catch {
      return errorJson(400, CONTENT_SERVICE_ERROR_CODE.BODY_INVALID, requestId)
    }
    const validated = schema.safeParse(parsedBody)
    if (!validated.success) {
      return errorJson(400, CONTENT_SERVICE_ERROR_CODE.BODY_INVALID, requestId, {
        issues: validated.error.issues.map((issue) => ({
          message: issue.message,
          path: issue.path.map(String),
        })),
      })
    }
    return submit(
      requestId,
      endpoint,
      operationType,
      idempotencyKey,
      validated.data,
      sha256Hex(canonicalJson(validated.data)),
    )
  }

  const requestHandler = async (incoming: {
    headers: Headers
    method: string
    readBody: () => Promise<string>
    url: string
  }): Promise<Response> => {
    const requestId = crypto.randomUUID()
    const { headers, method } = incoming
    const url = new URL(incoming.url, "http://content-service.local")
    const path = url.pathname

    if (method === "GET" && path === "/healthz") {
      return json(200, { status: "alive" }, { "x-request-id": requestId })
    }
    if (method === "GET" && path === "/v1/openapi.json") {
      return json(200, contentServiceOpenApiDocument, { "x-request-id": requestId })
    }

    const auth = headers.get("authorization")
    if (auth !== `Bearer ${config.apiKey}`) {
      return errorJson(401, CONTENT_SERVICE_ERROR_CODE.UNAUTHENTICATED, requestId)
    }

    if (method === "GET" && path.startsWith("/v1/operations/")) {
      const operationId = decodeURIComponent(path.slice("/v1/operations/".length))
      if (!OPERATION_ID_PATTERN.test(operationId)) {
        return errorJson(404, CONTENT_SERVICE_ERROR_CODE.NOT_FOUND, requestId)
      }
      try {
        const operation = await config.client.getOperation(operationId)
        return json(200, { operation }, { "x-request-id": requestId })
      } catch (error) {
        if (error instanceof ContentClientError) {
          return errorJson(error.code === "OPERATION_NOT_FOUND" ? 404 : 502, error.code, requestId)
        }
        return errorJson(502, CONTENT_SERVICE_ERROR_CODE.UPSTREAM, requestId)
      }
    }

    if (method === "POST" && path === ENDPOINT.generate) {
      return handleMutating(
        requestId,
        ENDPOINT.generate,
        "generate",
        generateRequestSchema,
        await incoming.readBody(),
        headers,
      )
    }
    if (method === "POST" && path === ENDPOINT.evaluate) {
      return handleMutating(
        requestId,
        ENDPOINT.evaluate,
        "evaluate",
        evaluateRequestSchema,
        await incoming.readBody(),
        headers,
      )
    }
    if (method === "POST" && path === ENDPOINT.publish) {
      return handleMutating(
        requestId,
        ENDPOINT.publish,
        "publish",
        publishRequestSchema,
        await incoming.readBody(),
        headers,
      )
    }

    return errorJson(404, CONTENT_SERVICE_ERROR_CODE.NOT_FOUND, requestId)
  }

  return {
    close: () =>
      new Promise((resolve, reject) => {
        if (server === null) {
          resolve()
          return
        }
        server.close((error) => (error === undefined ? resolve() : reject(error)))
      }),
    listen: async () => {
      const created = createServer((req, res) => {
        const chunks: Buffer[] = []
        req.on("data", (chunk: Buffer) => chunks.push(chunk))
        const readBody = () => Promise.resolve(Buffer.concat(chunks).toString("utf8"))
        const headerRecord: Record<string, string> = {}
        for (const [key, value] of Object.entries(req.headers)) {
          headerRecord[key] = Array.isArray(value) ? value.join(",") : (value ?? "")
        }
        const headers = new Headers(headerRecord)
        const declaredLength = Number(headers.get("content-length") ?? "0")
        const tooLarge = Number.isFinite(declaredLength) && declaredLength > maxBodyBytes
        req.on("end", () => {
          void (async () => {
            let response: Response
            if (tooLarge) {
              response = errorJson(
                413,
                CONTENT_SERVICE_ERROR_CODE.BODY_TOO_LARGE,
                crypto.randomUUID(),
              )
            } else {
              try {
                response = await requestHandler({
                  headers,
                  method: (req.method ?? "GET").toUpperCase(),
                  readBody,
                  url: req.url ?? "/",
                })
              } catch {
                response = errorJson(502, CONTENT_SERVICE_ERROR_CODE.UPSTREAM, crypto.randomUUID())
              }
            }
            const bytes = Buffer.from(await response.arrayBuffer())
            res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
            res.end(bytes)
          })()
        })
      })
      server = created
      const port = await new Promise<number>((resolve, reject) => {
        created.once("error", reject)
        created.listen(config.port ?? 0, config.host ?? "127.0.0.1", () => {
          const address = created.address()
          resolve(typeof address === "object" && address !== null ? address.port : 0)
        })
      })
      return `http://127.0.0.1:${port}`
    },
  }
}
