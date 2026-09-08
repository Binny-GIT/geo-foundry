import { dispatchDuePublicationPlans } from "../../server/repositories/publication-dispatch"
import { serverRuntime } from "../../server/runtime"
import {
  type DispatchDuePublicationPlansBody,
  dispatchDuePublicationPlansBodySchema,
} from "./contracts"
import { internalJsonResponse, withInternalGuards } from "./guards"

const handleDispatchDuePublicationPlans = withInternalGuards(
  { bodySchema: dispatchDuePublicationPlansBodySchema, operation: "dispatchDuePublicationPlans" },
  async (req, ctx, body: DispatchDuePublicationPlansBody) => {
    const plans = await dispatchDuePublicationPlans(serverRuntime().db, {
      ...body,
      user: req.user,
    })
    return internalJsonResponse(200, { plans }, ctx.requestId, null)
  },
)

export const publicationPlanHandlerByOperation: Record<
  string,
  typeof handleDispatchDuePublicationPlans
> = {
  dispatchDuePublicationPlans: handleDispatchDuePublicationPlans,
}
