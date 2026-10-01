import { pollDueRssConnectors } from "../../server/repositories/connector-polling"
import {
  crawlTenantOf,
  pollDueCrawlConnectors,
  reconcileCrawlJobs,
} from "../../server/repositories/crawl-dispatch"
import { serverRuntime } from "../../server/runtime"
import { internalJsonResponse, withInternalGuards } from "./guards"

/* RSS connector 轮询入口，由 worker 的每分钟维护任务调用。 */
const handlePollDueConnectors = withInternalGuards(
  { bodySchema: null, operation: "pollDueConnectors" },
  async (_req, ctx) => {
    const report = await pollDueRssConnectors(serverRuntime().db)
    const tenantId = crawlTenantOf(_req.user)
    await reconcileCrawlJobs(serverRuntime().db, tenantId)
    await pollDueCrawlConnectors(serverRuntime().db, tenantId)
    return internalJsonResponse(
      200,
      {
        errors: report.errors,
        polled: report.polled,
        skipped: report.skipped,
      },
      ctx.requestId,
      null,
    )
  },
)

export const connectorHandlerByOperation: Record<string, typeof handlePollDueConnectors> = {
  pollDueConnectors: handlePollDueConnectors,
}
