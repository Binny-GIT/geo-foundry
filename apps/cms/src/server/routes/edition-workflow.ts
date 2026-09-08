/*
 * 工作流三端点的 Drizzle 路由：workflow-transitions / draft-from-published /
 * publish-operations。契约（路径、状态码、错误码 envelope）与旧 Payload
 * endpoint 逐项一致；publish 复用 OperationsRepository 的同事务台账。
 */

import { z } from "zod"

import { authenticateRequest } from "../auth/session"
import { IdempotencyConflictError } from "../errors"
import {
  workflowActorOf,
  WorkflowRepository,
  WorkflowRepositoryError,
} from "../repositories/edition-workflow"
import { entityScopeOf } from "../repositories/entities"
import { submitEditionPublishOperation } from "../repositories/publish-operations"
import { serverRuntime } from "../runtime"

const reasonSchema = z.string().trim().min(1).max(500)

const transitionSchema = z
  .object({
    compiledReleaseId: z.string().min(6).max(128).optional(),
    reason: reasonSchema.optional(),
    target: z.enum(["draft", "generating", "review", "approved", "archived"]),
  })
  .strict()

const draftSchema = z.object({ reason: reasonSchema.optional() }).strict()
const publishSchema = z.object({ reason: reasonSchema.optional() }).strict()

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  })

const errorStatusOf = (code: string): number =>
  code.endsWith("ACTOR_INVALID") ||
  code.endsWith("TENANT_MISMATCH") ||
  code === "EDITION_WORKFLOW_PUBLISHER_REQUIRED"
    ? 403
    : 409

const editionIdOf = (slug: readonly string[] | undefined): number | null => {
  const id = slug?.[1]
  return id !== undefined && /^\d+$/.test(id) && Number(id) > 0 ? Number(id) : null
}

export type EditionWorkflowRoute = "transition" | "draft" | "publish"

export const editionWorkflowRouteOf = (
  slug: readonly string[] | undefined,
): EditionWorkflowRoute | null => {
  if (slug?.length !== 3 || slug[0] !== "editions") return null
  if (slug[2] === "workflow-transitions") return "transition"
  if (slug[2] === "draft-from-published") return "draft"
  if (slug[2] === "publish-operations") return "publish"
  return null
}

const workflowErrorResponse = (error: unknown): Response => {
  if (error instanceof WorkflowRepositoryError) {
    return json(errorStatusOf(error.code), { error: { code: error.code } })
  }
  if (error instanceof IdempotencyConflictError) {
    return json(409, { error: { code: "IDEMPOTENCY_KEY_REUSED" } })
  }
  return json(500, { error: { code: "EDITION_WORKFLOW_INTERNAL_ERROR" } })
}

export const handleEditionWorkflowPost = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> => {
  const route = editionWorkflowRouteOf(slug)
  if (route === null) return null
  const editionId = editionIdOf(slug)
  if (editionId === null) {
    return json(400, { error: { code: "EDITION_WORKFLOW_ID_INVALID" } })
  }
  const auth = await authenticateRequest(request.headers)
  if (auth === null) {
    return json(401, { error: { code: "EDITION_WORKFLOW_UNAUTHENTICATED" } })
  }
  const scope = entityScopeOf(auth)
  if (scope === null) {
    return json(403, { error: { code: "EDITION_WORKFLOW_ACTOR_INVALID" } })
  }
  const claims = {
    kind: auth.claims.kind,
    role: auth.claims.role,
    tenantId: auth.claims.tenantId === null ? null : Number(auth.claims.tenantId),
    userId: auth.claims.userId,
  }

  let raw: unknown
  if (route === "publish") {
    // 旧端点语义：JSON 解析失败按空 body 处理（strict schema 放行 {}）。
    raw = await request.json().catch(() => ({}))
  } else {
    try {
      raw = await request.json()
    } catch {
      return json(400, { error: { code: "EDITION_WORKFLOW_BODY_INVALID" } })
    }
  }

  if (route === "transition") {
    const parsed = transitionSchema.safeParse(raw)
    if (!parsed.success) {
      return json(400, { error: { code: "EDITION_WORKFLOW_BODY_INVALID" } })
    }
    try {
      const state = await new WorkflowRepository(serverRuntime().db).transition(scope, {
        actor: workflowActorOf(claims),
        ...(parsed.data.compiledReleaseId === undefined
          ? {}
          : { compiledReleaseId: parsed.data.compiledReleaseId }),
        ...(parsed.data.reason === undefined ? {} : { reason: parsed.data.reason }),
        editionId,
        target: parsed.data.target,
      })
      return json(200, { editionId, workflowStatus: state })
    } catch (error) {
      return workflowErrorResponse(error)
    }
  }

  if (route === "draft") {
    const parsed = draftSchema.safeParse(raw)
    if (!parsed.success) {
      return json(400, { error: { code: "EDITION_WORKFLOW_BODY_INVALID" } })
    }
    try {
      await new WorkflowRepository(serverRuntime().db).createDraftFromPublished(scope, {
        actor: workflowActorOf(claims),
        editionId,
        ...(parsed.data.reason === undefined ? {} : { reason: parsed.data.reason }),
      })
      return json(200, { editionId, workflowStatus: "draft" })
    } catch (error) {
      return workflowErrorResponse(error)
    }
  }

  const parsed = publishSchema.safeParse(raw)
  if (!parsed.success) {
    return json(400, { error: { code: "EDITION_WORKFLOW_BODY_INVALID" } })
  }
  try {
    const outcome = await submitEditionPublishOperation(serverRuntime().db, {
      claims,
      editionId,
      ...(parsed.data.reason === undefined ? {} : { reason: parsed.data.reason }),
    })
    return json(outcome.created ? 202 : 200, {
      editionId,
      operation: {
        created: outcome.created,
        operationId: outcome.operationId,
        releaseId: outcome.releaseId,
        state: outcome.state,
      },
    })
  } catch (error) {
    return workflowErrorResponse(error)
  }
}
