import {
  handleAccountAuthPost,
  handleUsersAuthGet,
  handleUsersAuthPost,
} from "@/server/routes/auth"
import { handleEditionDraftGet } from "@/server/routes/edition-reads"
import { handleEditionVersionGet, handleEditionVersionPost } from "@/server/routes/edition-versions"
import { handleEditionDraftPatch, handleEditionDraftPost } from "@/server/routes/edition-writes"
import { handleEditionWorkflowPost } from "@/server/routes/edition-workflow"
import { handleEditionAiChatPost } from "@/server/routes/edition-ai-chat"
import { handleInternalRequest } from "@/server/routes/internal"
import { handleEditionOpsPost } from "@/server/routes/edition-ops"
import { handleIntakeOpsPost } from "@/server/routes/intake-ops"
import { handleEntityListGet } from "@/server/routes/entity-reads"
import { handleEntityCreatePost, handleEntityUpdatePatch } from "@/server/routes/entity-writes"
import { handleMediaFileGet, handleMediaUploadPost } from "@/server/routes/media"
import { handleDeliveryGet } from "@/server/routes/delivery"
import { handleWorkspaceContextGet } from "@/server/routes/workspace-context"
import { handleArticleSourcePost } from "@/server/routes/article-sources"
import { handlePublicationPlanPost } from "@/server/routes/publication-plans"
import { handleEvaluationPost, handleRollbackIntentPost } from "@/server/routes/release-ops"
import { handleUrlRecordsPost } from "@/server/routes/url-records"
import { handleReviewCommentPost } from "@/server/routes/review-comments"
import { handleReviewerDecisionPost } from "@/server/routes/reviewer-decisions"
import { logger } from "@/server/observability/logger"

type RouteContext = { readonly params: Promise<{ readonly slug?: string[] }> }

/*
 * 自建层访问日志 + 500 捕获：记录命中的 handler、状态码与耗时；
 * 未知异常带 stack 落日志后返回 500。
 */
const dispatch = async (
  request: Request,
  slug: readonly string[] | undefined,
  handlers: readonly (readonly [name: string, () => Promise<Response | null>])[],
): Promise<Response | undefined> => {
  const startedAt = Date.now()
  for (const [name, handle] of handlers) {
    try {
      const response = await handle()
      if (response !== null) {
        logger.info(
          {
            durationMs: Date.now() - startedAt,
            handler: name,
            method: request.method,
            path: `/${(slug ?? []).join("/")}`,
            status: response.status,
          },
          "api handled",
        )
        return response
      }
    } catch (error) {
      logger.error(
        {
          durationMs: Date.now() - startedAt,
          err: error,
          handler: name,
          method: request.method,
          path: `/${(slug ?? []).join("/")}`,
        },
        "api handler error",
      )
      return Response.json(
        { error: { code: "CMS_INTERNAL_ERROR" } },
        { status: 500, headers: { "x-request-id": crypto.randomUUID() } },
      )
    }
  }
  return undefined
}

const notFound = (): Response =>
  Response.json({ error: { code: "API_ROUTE_NOT_FOUND" } }, { status: 404 })

const methodNotAllowed = (): Response =>
  Response.json({ error: { code: "API_METHOD_NOT_ALLOWED" } }, { status: 405 })

/** 全部 API 由自建层处理；未匹配的路由一律 404，不再回退任何通用 CRUD。 */
export const GET = async (request: Request, context: RouteContext): Promise<Response> => {
  const params = await context.params
  const handled = await dispatch(request, params.slug, [
    ["internal", () => handleInternalRequest(request, params.slug)],
    ["users-auth-get", () => handleUsersAuthGet(request, params.slug)],
    ["edition-version-get", () => handleEditionVersionGet(request, params.slug)],
    ["workspace-context-get", () => handleWorkspaceContextGet(request, params.slug)],
    ["edition-draft-get", () => handleEditionDraftGet(request, params.slug)],
    ["entity-list-get", () => handleEntityListGet(request, params.slug)],
    ["media-file-get", () => handleMediaFileGet(request, params.slug)],
    ["delivery-get", () => handleDeliveryGet(request, params.slug)],
  ])
  return handled ?? notFound()
}

export const POST = async (request: Request, context: RouteContext): Promise<Response> => {
  const params = await context.params
  const handled = await dispatch(request, params.slug, [
    ["internal", () => handleInternalRequest(request, params.slug)],
    ["account-auth-post", () => handleAccountAuthPost(request, params.slug)],
    ["users-auth-post", () => handleUsersAuthPost(request, params.slug)],
    ["edition-version-post", () => handleEditionVersionPost(request, params.slug)],
    ["edition-workflow-post", () => handleEditionWorkflowPost(request, params.slug)],
    ["edition-ops-post", () => handleEditionOpsPost(request, params.slug)],
    ["intake-ops-post", () => handleIntakeOpsPost(request, params.slug)],
    ["article-source-post", () => handleArticleSourcePost(request, params.slug)],
    ["publication-plan-post", () => handlePublicationPlanPost(request, params.slug)],
    ["rollback-intent-post", () => handleRollbackIntentPost(request, params.slug)],
    ["evaluation-post", () => handleEvaluationPost(request, params.slug)],
    ["url-records-post", () => handleUrlRecordsPost(request, params.slug)],
    ["reviewer-decision-post", () => handleReviewerDecisionPost(request, params.slug)],
    ["review-comment-post", () => handleReviewCommentPost(request, params.slug)],
    ["edition-draft-post", () => handleEditionDraftPost(request, params.slug)],
    ["entity-create-post", () => handleEntityCreatePost(request, params.slug)],
    ["media-upload-post", () => handleMediaUploadPost(request, params.slug)],
    ["edition-ai-chat-post", () => handleEditionAiChatPost(request, params.slug)],
  ])
  return handled ?? notFound()
}

export const DELETE = (): Response => methodNotAllowed()
export const PATCH = async (request: Request, context: RouteContext): Promise<Response> => {
  const params = await context.params
  const handled = await dispatch(request, params.slug, [
    ["edition-draft-patch", () => handleEditionDraftPatch(request, params.slug)],
    ["entity-update-patch", () => handleEntityUpdatePatch(request, params.slug)],
  ])
  return handled ?? notFound()
}
export const PUT = (): Response => methodNotAllowed()
export const OPTIONS = async (request: Request, context: RouteContext): Promise<Response> => {
  const params = await context.params
  const handled = await dispatch(request, params.slug, [
    ["internal", () => handleInternalRequest(request, params.slug)],
  ])
  return handled ?? new Response(null, { status: 204 })
}
