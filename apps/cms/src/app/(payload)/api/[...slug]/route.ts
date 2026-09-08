import config from "@payload-config"
import {
  REST_DELETE,
  REST_GET,
  REST_OPTIONS,
  REST_PATCH,
  REST_POST,
  REST_PUT,
} from "@payloadcms/next/routes"

import { handleEntityListGet } from "@/server/routes/entity-reads"

const payloadGet = REST_GET(config)

type RouteContext = { readonly params: Promise<{ readonly slug?: string[] }> }

/**
 * 去 Payload 双栈分流：首批三个精确集合列表 GET 由 Drizzle 接管；不支持的
 * 查询形态、详情、auth/internal/delivery 等全部原样回退 Payload。
 * POST/PATCH/PUT/DELETE 在对应 service/repository 迁移前保持完全不变。
 */
export const GET = async (request: Request, context: RouteContext): Promise<Response> => {
  const params = await context.params
  const handled = await handleEntityListGet(request, params.slug)
  return handled ?? payloadGet(request, context)
}

export const POST = REST_POST(config)
export const DELETE = REST_DELETE(config)
export const PATCH = REST_PATCH(config)
export const PUT = REST_PUT(config)
export const OPTIONS = REST_OPTIONS(config)
