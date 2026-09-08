/* content-editions draft=true&depth=0 的 Markdown-first Drizzle 写入接管。 */

import { z } from "zod"

import { CMS_ACTION, CMS_RESOURCE, decideAccess } from "../../access/policy"
import { markdownToBlocks } from "../../editor/block-markdown"
import { validateEditionBody } from "../../editor/validate-body"
import { authenticateRequest } from "../auth/session"
import {
  type EditionDraftPatch,
  EditionsRepository,
  EditionWriteError,
} from "../repositories/editions"
import { entityScopeOf } from "../repositories/entities"
import { serverRuntime } from "../runtime"

const patchSchema = z
  .object({
    angle: z.string().max(2_000).optional(),
    bodyMarkdown: z.string().max(2_000_000).optional(),
    citations: z.unknown().optional(),
    content: z.number().int().positive().optional(),
    dueAt: z.string().datetime().nullable().optional(),
    editorialStatus: z.enum(["unassigned", "assigned", "in-progress", "blocked"]).optional(),
    entities: z.unknown().optional(),
    expectedUpdatedAt: z.string().datetime().optional(),
    owner: z.number().int().positive().nullable().optional(),
    primaryTopic: z.string().max(500).optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    secondaryTopics: z.array(z.string().max(200)).max(100).optional(),
    site: z.number().int().positive().nullable().optional(),
    sites: z.array(z.number().int().positive()).max(100).optional(),
    summary: z.string().max(20_000).optional(),
    tenant: z.number().int().positive().optional(),
    title: z.string().max(1_000).optional(),
  })
  .strict()

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  })

const errorResponse = (error: unknown): Response => {
  if (error instanceof EditionWriteError) {
    return json(error.status, { errors: [{ message: error.code }], error: { code: error.code } })
  }
  return json(500, {
    errors: [{ message: "EDITION_DRAFT_WRITE_FAILED" }],
    error: { code: "EDITION_DRAFT_WRITE_FAILED" },
  })
}

export const handleEditionDraftPatch = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> => {
  if (slug?.length !== 2 || slug[0] !== "content-editions") return null
  const id = slug[1]
  if (id === undefined || !/^\d+$/.test(id) || Number(id) <= 0) return null
  const url = new URL(request.url)
  if (url.searchParams.get("draft") !== "true") return null
  const depth = url.searchParams.get("depth")
  if (depth !== null && depth !== "0") return null

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return json(400, { errors: [{ message: "EDITION_DRAFT_BODY_INVALID" }] })
  }
  const parsed = patchSchema.safeParse(raw)
  if (!parsed.success) {
    return json(400, { errors: [{ message: "EDITION_DRAFT_BODY_INVALID" }] })
  }
  if (parsed.data.bodyMarkdown !== undefined) {
    const validation = validateEditionBody(markdownToBlocks(parsed.data.bodyMarkdown))
    if (validation !== true) {
      return json(400, { errors: [{ message: validation }] })
    }
  }

  const auth = await authenticateRequest(request.headers)
  if (auth === null) return json(401, { errors: [{ message: "Unauthorized" }] })
  if (!decideAccess(auth.claims, CMS_RESOURCE.EDITIONS, CMS_ACTION.UPDATE)) {
    return json(403, { errors: [{ message: "You are not allowed to perform this action." }] })
  }
  const scope = entityScopeOf(auth)
  if (scope === null) return json(403, { errors: [{ message: "Forbidden" }] })

  try {
    const doc = await new EditionsRepository(serverRuntime().db).saveDraft(
      scope,
      Number(id),
      parsed.data as EditionDraftPatch,
    )
    return json(200, { doc, message: "草稿成功保存。" })
  } catch (error) {
    return errorResponse(error)
  }
}
