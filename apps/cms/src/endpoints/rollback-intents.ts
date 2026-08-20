import type { Endpoint, PayloadRequest } from "payload"
import { z } from "zod"

import {
  createRollbackIntent,
  RollbackIntentApprovalError,
} from "../services/rollback-intent-approval"

const bodySchema = z
  .object({
    expectedCurrentManifestSha256: z.string().regex(/^[0-9a-f]{64}$/),
    expectedCurrentReleaseId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{5,127}$/),
    expectedManifestSha256: z.string().regex(/^[0-9a-f]{64}$/),
    reason: z.string().min(1).max(500).optional(),
    siteId: z.number().int().positive(),
    targetReleaseId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{5,127}$/),
  })
  .strict()

const response = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  })

export const createRollbackIntentEndpoint: Endpoint = {
  handler: async (req: PayloadRequest) => {
    let body: unknown
    try {
      body = await req.json?.()
    } catch {
      return response(400, { error: { code: "ROLLBACK_INTENT_BODY_INVALID" } })
    }
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return response(400, { error: { code: "ROLLBACK_INTENT_BODY_INVALID" } })
    }
    try {
      const { reason, ...input } = parsed.data
      const intent = await createRollbackIntent(req.payload, {
        ...input,
        ...(reason === undefined ? {} : { reason }),
        user: req.user,
      })
      return response(201, intent)
    } catch (error) {
      if (error instanceof RollbackIntentApprovalError) {
        const status = error.code === "ROLLBACK_RELEASE_STATE_MISMATCH" ? 409 : 403
        return response(status, { error: { code: error.code } })
      }
      throw error
    }
  },
  method: "post",
  path: "/rollback-intents",
}
