import { buildCompileSnapshot } from "../../server/repositories/compile-snapshot"
import { publishedSiteHostsOf } from "../../server/repositories/edition-sites"
import { serverRuntime } from "../../server/runtime"
import { EditionWorkflowError } from "../../services/edition-workflow"
import { type InternalRequest, internalJsonResponse, withInternalGuards } from "./guards"

const siteIdOf = (req: InternalRequest): number => {
  const raw = req.routeParams["id"]
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new EditionWorkflowError("COMPILE_SNAPSHOT_SITE_INVALID", `route id ${String(raw)}`)
  }
  return parsed
}

export const handleGetCompileSnapshot = withInternalGuards(
  { bodySchema: null, operation: "getCompileSnapshot" },
  async (req, ctx) => {
    const snapshot = await buildCompileSnapshot(serverRuntime().db, {
      siteId: siteIdOf(req),
      user: req.user,
    })
    return internalJsonResponse(200, snapshot, ctx.requestId, null)
  },
)

// B2：worker 发布完成后取"已发布站点 × canonical 域名"清单，写全局
// routing manifest。只读、无站点参数（跨站点聚合），限流与审计沿用守卫层。
export const handleGetPublishedSites = withInternalGuards(
  { bodySchema: null, operation: "getPublishedSites" },
  async (_req, ctx) => {
    const sites = await publishedSiteHostsOf(serverRuntime().db)
    return internalJsonResponse(200, { sites }, ctx.requestId, null)
  },
)
