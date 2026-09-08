import { pollDueRssConnectors } from "../../server/repositories/connector-polling"
import { serverRuntime } from "../../server/runtime"
import { internalJsonResponse, withInternalGuards } from "./guards"

/*
 * RSS connector 轮询入口（worker cron 每分钟调用）：取代 CMS 进程内的
 * 60 秒定时器——后台任务不再住在 Next.js instrumentation 里。
 */
const handlePollDueConnectors = withInternalGuards(
  { bodySchema: null, operation: "pollDueConnectors" },
  async (req, ctx) => {
    const report = await pollDueRssConnectors(serverRuntime().db)
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
