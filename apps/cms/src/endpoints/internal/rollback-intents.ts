import { consumeRollbackIntent } from "../../services/rollback-intents"
import { type ConsumeRollbackIntentBody, consumeRollbackIntentBodySchema } from "./contracts"
import { internalJsonResponse, withInternalGuards } from "./guards"

const handleConsumeRollbackIntent = withInternalGuards(
  { bodySchema: consumeRollbackIntentBodySchema, operation: "consumeRollbackIntent" },
  async (req, ctx, body: ConsumeRollbackIntentBody) => {
    await consumeRollbackIntent(req.payload, { ...body, user: req.user })
    return internalJsonResponse(200, { consumed: true }, ctx.requestId, null)
  },
)

export const rollbackIntentHandlerByOperation: Record<string, typeof handleConsumeRollbackIntent> =
  {
    consumeRollbackIntent: handleConsumeRollbackIntent,
  }
