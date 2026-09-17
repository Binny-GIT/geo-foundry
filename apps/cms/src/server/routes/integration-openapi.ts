/*
 * 投稿面 OpenAPI 的公开只读端点：GET /api/integration/openapi.json。
 * 无需认证——文档本身就是给还没拿到 key 的接入方（和 LLM）读的，
 * 不含任何租户数据。与 delivery 同级公开，带短缓存头。
 */

import { integrationOpenApiDocument } from "../../endpoints/integration/openapi"

export const integrationOpenApiRouteOf = (slug: readonly string[] | undefined): boolean =>
  slug?.length === 2 && slug[0] === "integration" && slug[1] === "openapi.json"

export const handleIntegrationOpenApiGet = async (
  _request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> => {
  if (!integrationOpenApiRouteOf(slug)) return null
  return new Response(JSON.stringify(integrationOpenApiDocument), {
    headers: {
      "cache-control": "public, max-age=300",
      "content-type": "application/json; charset=utf-8",
    },
    status: 200,
  })
}
