import { dispatchDuePublicationPlans, PublicationPlansError } from "../../services/publication-plans"
import { dispatchDuePublicationPlansBodySchema, type DispatchDuePublicationPlansBody } from "./contracts"
import { internalJsonResponse, withInternalGuards } from "./guards"

const handleDispatchDuePublicationPlans = withInternalGuards(
  { bodySchema: dispatchDuePublicationPlansBodySchema, operation: "dispatchDuePublicationPlans" },
  async (req, ctx, body: DispatchDuePublicationPlansBody) => {
    const plans = await dispatchDuePublicationPlans(req.payload, { ...body, user: req.user })
    return internalJsonResponse(200, { plans }, ctx.requestId, null)
  },
)

export const publicationPlanHandlerByOperation: Record<
  string,
  typeof handleDispatchDuePublicationPlans
> = {
  dispatchDuePublicationPlans: handleDispatchDuePublicationPlans,
}

void PublicationPlansError
