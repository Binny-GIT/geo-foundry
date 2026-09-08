/*
 * /api/internal/* 自建网关：按 INTERNAL_OPERATIONS 的路径模板匹配 slug，
 * 提取 :param，用自建认证层解析 users API-Key，再交给 withInternalGuards
 * 包装的处理器（其余零信任检查：租户绑定、限流、CORS、体积、schema）。
 */

import { allInternalEndpoints, type InternalEndpoint } from "../../endpoints/internal"
import type { InternalRequest } from "../../endpoints/internal/guards"
import { authenticateRequest } from "../auth/session"

type Route = Readonly<{ endpoint: InternalEndpoint; segments: readonly string[] }>

const ROUTES: readonly Route[] = allInternalEndpoints.map((endpoint) => ({
  endpoint,
  segments: endpoint.path.split("/").filter((segment) => segment.length > 0),
}))

const matchRoute = (
  method: string,
  slug: readonly string[],
): Readonly<{ endpoint: InternalEndpoint; params: Record<string, string> }> | null => {
  for (const route of ROUTES) {
    if (route.endpoint.method.toUpperCase() !== method) continue
    if (route.segments.length !== slug.length) continue
    const params: Record<string, string> = {}
    let matched = true
    for (let index = 0; index < route.segments.length; index += 1) {
      const pattern = route.segments[index] ?? ""
      const actual = slug[index] ?? ""
      if (pattern.startsWith(":")) {
        params[pattern.slice(1)] = decodeURIComponent(actual)
      } else if (pattern !== actual) {
        matched = false
        break
      }
    }
    if (matched) return { endpoint: route.endpoint, params }
  }
  return null
}

export const handleInternalRequest = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> => {
  if (slug === undefined || slug[0] !== "internal") return null
  const method = request.method.toUpperCase()
  const route = matchRoute(method === "OPTIONS" ? "POST" : method, slug)
  if (route === null) {
    return Response.json({ error: { code: "INTERNAL_ROUTE_NOT_FOUND" } }, { status: 404 })
  }
  const auth = await authenticateRequest(request.headers)
  const internalRequest: InternalRequest = {
    headers: request.headers,
    method,
    routeParams: route.params,
    text: () => request.text(),
    url: request.url,
    user:
      auth === null
        ? null
        : {
            collection: "users",
            email: auth.user.email,
            id: auth.user.id,
            role: auth.claims.role,
            tenant: auth.claims.tenantId,
          },
  }
  return route.endpoint.handler(internalRequest)
}
