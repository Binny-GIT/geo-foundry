import type { Endpoint, PayloadRequest } from "payload"
import { z } from "zod"

import { resolveSessionClaims } from "../access/session"
import { enqueueIntakeFetchFromEnvironment } from "../services/intake-queue"
import {
  adoptIntakeItem,
  createIntakeItem,
  ignoreIntakeItem,
  IntakeError,
  markIntakeQueueUnavailable,
  mergeIntakeItems,
  scheduleIntakeFetch,
  type IntakeChannel,
} from "../services/intake"

const idSchema = z.coerce.number().int().positive()
const channelSchema = z.enum(["manual", "url", "webhook", "rss"])

const createBodySchema = z
  .object({
    channel: channelSchema,
    connectorId: idSchema.optional(),
    contentHash: z.string().trim().min(1).max(512).optional(),
    sourceUrl: z.string().trim().min(1).max(4_000).optional(),
    suggestedSiteId: idSchema.optional(),
    summary: z.string().trim().min(1).max(20_000).optional(),
    title: z.string().trim().min(1).max(1_000),
  })
  .strict()

const mergeBodySchema = z.object({ targetIntakeItemId: idSchema }).strict()
const adoptBodySchema = z.object({ siteId: idSchema.optional() }).strict()

const response = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  })

const intakeItemIdOf = (req: PayloadRequest): number | null => {
  const value = Number(req.routeParams?.["id"])
  return Number.isInteger(value) && value > 0 ? value : null
}

const editableClaims = (req: PayloadRequest) => {
  const claims = resolveSessionClaims(req.user)
  if (claims === null) return null
  if (claims.role === "editor" || claims.role === "tenant-admin" || claims.role === "content-service") {
    return claims
  }
  return false
}

const bodyOf = async (req: PayloadRequest): Promise<unknown | null> => {
  try {
    return await req.json?.()
  } catch {
    return null
  }
}

const intakeErrorResponse = (error: IntakeError): Response => {
  const status =
    error.code === "INTAKE_ITEM_NOT_FOUND"
      ? 404
      : error.code === "INTAKE_TENANT_MISMATCH" ||
          error.code === "INTAKE_EDITOR_REQUIRED" ||
          error.code === "INTAKE_ACTOR_INVALID"
        ? 403
          : error.code === "INTAKE_MERGE_SELF_REFERENCE" ||
              error.code === "INTAKE_FETCH_STATE_INVALID"
            ? 409
            : 400
  return response(status, { error: { code: error.code } })
}

const requireEditable = (req: PayloadRequest): Response | null => {
  const claims = editableClaims(req)
  if (claims === null) return response(401, { error: { code: "INTAKE_UNAUTHENTICATED" } })
  if (claims === false) return response(403, { error: { code: "INTAKE_EDITOR_REQUIRED" } })
  return null
}

/** Tenant-scoped, normalized intake creation; no source fetching occurs here. */
export const createIntakeItemEndpoint: Endpoint = {
  handler: async (req) => {
    const denied = requireEditable(req)
    if (denied !== null) return denied
    const claims = resolveSessionClaims(req.user)
    const body = await bodyOf(req)
    const parsed = createBodySchema.safeParse(body)
    if (!parsed.success || claims === null || claims.tenantId === null) {
      return response(400, { error: { code: "INTAKE_CREATE_BODY_INVALID" } })
    }
    try {
      const result = await createIntakeItem(
        req.payload,
        {
          channel: parsed.data.channel as IntakeChannel,
          tenantId: Number(claims.tenantId),
          title: parsed.data.title,
          ...(parsed.data.connectorId === undefined ? {} : { connectorId: parsed.data.connectorId }),
          ...(parsed.data.contentHash === undefined ? {} : { contentHash: parsed.data.contentHash }),
          ...(parsed.data.sourceUrl === undefined ? {} : { sourceUrl: parsed.data.sourceUrl }),
          ...(parsed.data.suggestedSiteId === undefined
            ? {}
            : { suggestedSiteId: parsed.data.suggestedSiteId }),
          ...(parsed.data.summary === undefined ? {} : { summary: parsed.data.summary }),
        },
        req.user,
      )
      const shouldFetch =
        result.duplicates.length === 0 &&
        (parsed.data.channel === "url" || parsed.data.channel === "rss")
      if (!shouldFetch) {
        return response(result.duplicates.length === 0 ? 201 : 200, {
          duplicateIds: result.duplicates.map((item) => item.id),
          fetchQueued: false,
          intakeItem: result.intakeItem,
        })
      }
      try {
        const intakeItem = await scheduleIntakeFetch(
          req.payload,
          result.intakeItem.id,
          req.user,
          enqueueIntakeFetchFromEnvironment,
        )
        return response(201, {
          duplicateIds: [],
          fetchQueued: true,
          intakeItem,
        })
      } catch (error) {
        if (error instanceof IntakeError) return intakeErrorResponse(error)
        return response(202, {
          duplicateIds: [],
          fetchQueued: false,
          intakeItem: await markIntakeQueueUnavailable(req.payload, result.intakeItem.id, req.user),
        })
      }
    } catch (error) {
      if (error instanceof IntakeError) return intakeErrorResponse(error)
      throw error
    }
  },
  method: "post",
  path: "/intake-operations",
}

export const ignoreIntakeItemEndpoint: Endpoint = {
  handler: async (req) => {
    const denied = requireEditable(req)
    if (denied !== null) return denied
    const intakeItemId = intakeItemIdOf(req)
    if (intakeItemId === null) return response(400, { error: { code: "INTAKE_ITEM_ID_INVALID" } })
    try {
      return response(200, { intakeItem: await ignoreIntakeItem(req.payload, intakeItemId, req.user) })
    } catch (error) {
      if (error instanceof IntakeError) return intakeErrorResponse(error)
      throw error
    }
  },
  method: "post",
  path: "/intake-operations/:id/ignore",
}

export const mergeIntakeItemEndpoint: Endpoint = {
  handler: async (req) => {
    const denied = requireEditable(req)
    if (denied !== null) return denied
    const intakeItemId = intakeItemIdOf(req)
    if (intakeItemId === null) return response(400, { error: { code: "INTAKE_ITEM_ID_INVALID" } })
    const parsed = mergeBodySchema.safeParse(await bodyOf(req))
    if (!parsed.success) return response(400, { error: { code: "INTAKE_MERGE_BODY_INVALID" } })
    try {
      return response(200, {
        intakeItem: await mergeIntakeItems(
          req.payload,
          intakeItemId,
          parsed.data.targetIntakeItemId,
          req.user,
        ),
      })
    } catch (error) {
      if (error instanceof IntakeError) return intakeErrorResponse(error)
      throw error
    }
  },
  method: "post",
  path: "/intake-operations/:id/merge",
}

export const adoptIntakeItemEndpoint: Endpoint = {
  handler: async (req) => {
    const denied = requireEditable(req)
    if (denied !== null) return denied
    const intakeItemId = intakeItemIdOf(req)
    if (intakeItemId === null) return response(400, { error: { code: "INTAKE_ITEM_ID_INVALID" } })
    const parsed = adoptBodySchema.safeParse(await bodyOf(req))
    if (!parsed.success) return response(400, { error: { code: "INTAKE_ADOPT_BODY_INVALID" } })
    try {
      const result = await adoptIntakeItem(req.payload, {
        intakeItemId,
        ...(parsed.data.siteId === undefined ? {} : { siteId: parsed.data.siteId }),
        user: req.user,
      })
      return response(result.sourceLinked ? 201 : 409, result)
    } catch (error) {
      if (error instanceof IntakeError) return intakeErrorResponse(error)
      throw error
    }
  },
  method: "post",
  path: "/intake-operations/:id/adopt",
}
