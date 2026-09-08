import config from "@payload-config"
import {
  REST_DELETE,
  REST_GET,
  REST_OPTIONS,
  REST_PATCH,
  REST_POST,
  REST_PUT,
} from "@payloadcms/next/routes"

import {
  handleAccountAuthPost,
  handleUsersAuthGet,
  handleUsersAuthPost,
} from "@/server/routes/auth"
import { handleEditionDraftGet } from "@/server/routes/edition-reads"
import {
  handleEditionVersionGet,
  handleEditionVersionPost,
} from "@/server/routes/edition-versions"
import {
  handleEditionDraftPatch,
  handleEditionDraftPost,
} from "@/server/routes/edition-writes"
import { handleEditionWorkflowPost } from "@/server/routes/edition-workflow"
import { handleEditionOpsPost } from "@/server/routes/edition-ops"
import { handleIntakeOpsPost } from "@/server/routes/intake-ops"
import { handleEntityListGet } from "@/server/routes/entity-reads"
import { handleDeliveryGet } from "@/server/routes/delivery"
import { handleWorkspaceContextGet } from "@/server/routes/workspace-context"
import { handleArticleSourcePost } from "@/server/routes/article-sources"
import { handleReviewCommentPost } from "@/server/routes/review-comments"
import { handleReviewerDecisionPost } from "@/server/routes/reviewer-decisions"
import { logger } from "@/server/observability/logger"

const payloadGet = REST_GET(config)
const payloadPatch = REST_PATCH(config)
const payloadPost = REST_POST(config)

type RouteContext = { readonly params: Promise<{ readonly slug?: string[] }> }

/*
 * 自建层访问日志 + 500 捕获：记录命中的 handler、状态码与耗时；
 * 未知异常带 stack 落日志后再按原语义交给 Payload/返回 500。
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

/**
 * 去 Payload 双栈分流：compat auth + 三个基础集合列表 GET 由自建层接管；
 * 不支持的查询/路由仍原样回退 Payload。PATCH/PUT/DELETE 保持完全不变。
 */
export const GET = async (request: Request, context: RouteContext): Promise<Response> => {
  const params = await context.params
  const handled = await dispatch(request, params.slug, [
    ["users-auth-get", () => handleUsersAuthGet(request, params.slug)],
    ["edition-version-get", () => handleEditionVersionGet(request, params.slug)],
    ["workspace-context-get", () => handleWorkspaceContextGet(request, params.slug)],
    ["edition-draft-get", () => handleEditionDraftGet(request, params.slug)],
    ["entity-list-get", () => handleEntityListGet(request, params.slug)],
    ["delivery-get", () => handleDeliveryGet(request, params.slug)],
  ])
  if (handled !== undefined) return handled
  return payloadGet(request, context)
}

export const POST = async (request: Request, context: RouteContext): Promise<Response> => {
  const params = await context.params
  const handled = await dispatch(request, params.slug, [
    ["account-auth-post", () => handleAccountAuthPost(request, params.slug)],
    ["users-auth-post", () => handleUsersAuthPost(request, params.slug)],
    ["edition-version-post", () => handleEditionVersionPost(request, params.slug)],
    ["edition-workflow-post", () => handleEditionWorkflowPost(request, params.slug)],
    ["edition-ops-post", () => handleEditionOpsPost(request, params.slug)],
    ["intake-ops-post", () => handleIntakeOpsPost(request, params.slug)],
    ["article-source-post", () => handleArticleSourcePost(request, params.slug)],
    ["reviewer-decision-post", () => handleReviewerDecisionPost(request, params.slug)],
    ["review-comment-post", () => handleReviewCommentPost(request, params.slug)],
    ["edition-draft-post", () => handleEditionDraftPost(request, params.slug)],
  ])
  if (handled !== undefined) return handled
  return payloadPost(request, context)
}

export const DELETE = REST_DELETE(config)
export const PATCH = async (request: Request, context: RouteContext): Promise<Response> => {
  const params = await context.params
  const handled = await dispatch(request, params.slug, [
    ["edition-draft-patch", () => handleEditionDraftPatch(request, params.slug)],
  ])
  if (handled !== undefined) return handled
  return payloadPatch(request, context)
}
export const PUT = REST_PUT(config)
export const OPTIONS = REST_OPTIONS(config)
