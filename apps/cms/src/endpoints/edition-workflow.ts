import type { Endpoint, PayloadRequest } from "payload"
import { z } from "zod"

import { resolveSessionClaims } from "../access/session"
import {
  createDraftFromPublished,
  EditionWorkflowError,
  transitionEdition,
} from "../services/edition-workflow"

const bodySchema = z
  .object({
    compiledReleaseId: z.string().min(6).max(128).optional(),
    reason: z.string().min(1).max(500).optional(),
    target: z.enum([
      "draft",
      "generating",
      "review",
      "approved",
      "compiled",
      "published",
      "archived",
    ]),
  })
  .strict()

const editionIdOf = (req: PayloadRequest): number | null => {
  const value = Number(req.routeParams?.["id"])
  return Number.isInteger(value) && value > 0 ? value : null
}

const response = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  })

const errorStatusOf = (error: EditionWorkflowError): number =>
  error.code.endsWith("ACTOR_INVALID") || error.code.endsWith("TENANT_MISMATCH") ? 403 : 409

export const createDraftFromPublishedEndpoint: Endpoint = {
  handler: async (req) => {
    const editionId = editionIdOf(req)
    const claims = resolveSessionClaims(req.user)
    if (editionId === null) {
      return response(400, { error: { code: "EDITION_WORKFLOW_ID_INVALID" } })
    }
    if (claims === null) {
      return response(401, { error: { code: "EDITION_WORKFLOW_UNAUTHENTICATED" } })
    }
    let body: unknown
    try {
      body = await req.json?.()
    } catch {
      return response(400, { error: { code: "EDITION_WORKFLOW_BODY_INVALID" } })
    }
    const parsed = z
      .object({ reason: z.string().min(1).max(500).optional() })
      .strict()
      .safeParse(body)
    if (!parsed.success) {
      return response(400, { error: { code: "EDITION_WORKFLOW_BODY_INVALID" } })
    }
    try {
      await createDraftFromPublished(req.payload, editionId, req.user, parsed.data.reason)
      return response(200, { editionId, workflowStatus: "draft" })
    } catch (error) {
      if (error instanceof EditionWorkflowError) {
        return response(errorStatusOf(error), { error: { code: error.code } })
      }
      throw error
    }
  },
  method: "post",
  path: "/editions/:id/draft-from-published",
}

export const transitionEditionEndpoint: Endpoint = {
  handler: async (req) => {
    const editionId = editionIdOf(req)
    if (editionId === null) {
      return response(400, { error: { code: "EDITION_WORKFLOW_ID_INVALID" } })
    }
    if (resolveSessionClaims(req.user) === null) {
      return response(401, { error: { code: "EDITION_WORKFLOW_UNAUTHENTICATED" } })
    }
    let body: unknown
    try {
      body = await req.json?.()
    } catch {
      return response(400, { error: { code: "EDITION_WORKFLOW_BODY_INVALID" } })
    }
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return response(400, { error: { code: "EDITION_WORKFLOW_BODY_INVALID" } })
    }
    try {
      const state = await transitionEdition(req.payload, {
        editionId,
        ...(parsed.data.compiledReleaseId === undefined
          ? {}
          : { compiledReleaseId: parsed.data.compiledReleaseId }),
        ...(parsed.data.reason === undefined ? {} : { reason: parsed.data.reason }),
        target: parsed.data.target,
        user: req.user,
      })
      return response(200, { editionId, workflowStatus: state })
    } catch (error) {
      if (error instanceof EditionWorkflowError) {
        return response(errorStatusOf(error), { error: { code: error.code } })
      }
      throw error
    }
  },
  method: "post",
  path: "/editions/:id/workflow-transitions",
}
