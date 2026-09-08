import config from "@payload-config"
import {
  REST_DELETE,
  REST_GET,
  REST_OPTIONS,
  REST_PATCH,
  REST_POST,
  REST_PUT,
} from "@payloadcms/next/routes"

import { handleUsersAuthGet, handleUsersAuthPost } from "@/server/routes/auth"
import { handleEntityListGet } from "@/server/routes/entity-reads"

const payloadGet = REST_GET(config)
const payloadPost = REST_POST(config)

type RouteContext = { readonly params: Promise<{ readonly slug?: string[] }> }

/**
 * 去 Payload 双栈分流：compat auth + 三个基础集合列表 GET 由自建层接管；
 * 不支持的查询/路由仍原样回退 Payload。PATCH/PUT/DELETE 保持完全不变。
 */
export const GET = async (request: Request, context: RouteContext): Promise<Response> => {
  const params = await context.params
  const authResponse = await handleUsersAuthGet(request, params.slug)
  if (authResponse !== null) return authResponse
  const entityResponse = await handleEntityListGet(request, params.slug)
  return entityResponse ?? payloadGet(request, context)
}

export const POST = async (request: Request, context: RouteContext): Promise<Response> => {
  const params = await context.params
  const authResponse = await handleUsersAuthPost(request, params.slug)
  return authResponse ?? payloadPost(request, context)
}

export const DELETE = REST_DELETE(config)
export const PATCH = REST_PATCH(config)
export const PUT = REST_PUT(config)
export const OPTIONS = REST_OPTIONS(config)
