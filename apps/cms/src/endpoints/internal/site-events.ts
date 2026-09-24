import {
  recordSiteEventDelivery,
  SiteEventError,
} from "../../server/repositories/site-events"
import { serverRuntime } from "../../server/runtime"
import { type SiteEventDeliveryBody, siteEventDeliveryBodySchema } from "./contracts"
import { internalJsonResponse, withInternalGuards } from "./guards"

const handleRecordSiteEventDelivery = withInternalGuards(
  { bodySchema: siteEventDeliveryBodySchema, operation: "recordSiteEventDelivery" },
  async (_req, ctx, body: SiteEventDeliveryBody) => {
    // 租户绑定：content-service keyring 密钥按租户签发，跨租户回报一律拒绝。
    if (ctx.claims.tenantId !== null && String(ctx.claims.tenantId) !== String(body.tenantId)) {
      throw new SiteEventError("SITE_EVENT_TENANT_MISMATCH", String(body.tenantId))
    }
    await recordSiteEventDelivery(serverRuntime().db, body)
    return internalJsonResponse(200, { recorded: true }, ctx.requestId, null)
  },
)

export const siteEventHandlerByOperation: Record<string, typeof handleRecordSiteEventDelivery> = {
  recordSiteEventDelivery: handleRecordSiteEventDelivery,
}
