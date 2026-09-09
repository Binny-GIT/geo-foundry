import { pollDueRssConnectors } from "../../server/repositories/connector-polling"
import { serverRuntime } from "../../server/runtime"
import { internalJsonResponse, withInternalGuards } from "./guards"

/* RSS connector 轮询入口，由 worker 的每分钟维护任务调用。 */
const handlePollDueConnectors = withInternalGuards(
  { bodySchema: null, operation: "pollDueConnectors" },
  async (_req, ctx) => {
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
