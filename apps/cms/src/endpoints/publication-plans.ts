import type { Endpoint, PayloadRequest } from "payload"
import { z } from "zod"

import { resolveSessionClaims } from "../access/session"
import { EditionWorkflowError } from "../services/edition-workflow"
import { cancelPublicationPlan, createPublicationPlan, PublicationPlansError } from "../services/publication-plans"

const createSchema = z.object({ editionId: z.number().int().positive(), scheduledFor: z.string(), timezone: z.string().min(1).max(100) }).strict()
const planIdOf = (req: PayloadRequest): string | null => {
  const value = req.routeParams?.["planId"]
  return typeof value === "string" && /^[A-Za-z0-9-]{8,128}$/.test(value) ? value : null
}
const response = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { headers: { "content-type": "application/json; charset=utf-8" }, status })
const errorOf = (error: unknown): Response => {
  if (error instanceof EditionWorkflowError) return response(error.code === "EDITION_WORKFLOW_PUBLISHER_REQUIRED" ? 403 : 409, { error: { code: error.code } })
  if (error instanceof PublicationPlansError) {
    const status = error.code === "PUBLICATION_PLAN_NOT_FOUND" ? 404 : error.code.includes("PUBLISHER") ? 403 : error.code.includes("CONFLICT") || error.code.includes("CANCELLABLE") ? 409 : 400
    return response(status, { error: { code: error.code } })
  }
  throw error
}

export const createPublicationPlanEndpoint: Endpoint = {
  handler: async (req) => {
    if (resolveSessionClaims(req.user) === null) return response(401, { error: { code: "PUBLICATION_PLAN_UNAUTHENTICATED" } })
    const parsed = createSchema.safeParse(await req.json?.().catch(() => null))
    if (!parsed.success) return response(400, { error: { code: "PUBLICATION_PLAN_BODY_INVALID" } })
    try {
      const plan = await createPublicationPlan(req.payload, { ...parsed.data, user: req.user })
      return response(201, { plan })
    } catch (error) { return errorOf(error) }
  },
  method: "post",
  path: "/publication-plans",
}

export const cancelPublicationPlanEndpoint: Endpoint = {
  handler: async (req) => {
    if (resolveSessionClaims(req.user) === null) return response(401, { error: { code: "PUBLICATION_PLAN_UNAUTHENTICATED" } })
    const planId = planIdOf(req)
    if (planId === null) return response(400, { error: { code: "PUBLICATION_PLAN_ID_INVALID" } })
    try {
      await cancelPublicationPlan(req.payload, { planId, user: req.user })
      return response(200, { cancelled: true, planId })
    } catch (error) { return errorOf(error) }
  },
  method: "post",
  path: "/publication-plans/:planId/cancel",
}
