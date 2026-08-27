import { APIError, type CollectionBeforeChangeHook, type CollectionConfig } from "payload"

import { collectionAccess } from "../access/functions"
import { CMS_RESOURCE } from "../access/policy"
import { localized, localizedFields } from "./shared/localized-labels"
import { tenantField } from "./shared/tenant-field"

const idOf = (reference: unknown): number | string | null => {
  if (typeof reference === "number" || typeof reference === "string") {
    return reference
  }
  if (typeof reference === "object" && reference !== null) {
    const id = (reference as Record<string, unknown>)["id"]
    return typeof id === "number" || typeof id === "string" ? id : null
  }
  return null
}

const fieldValue = (
  data: Record<string, unknown>,
  originalDoc: Record<string, unknown> | undefined,
  field: string,
): unknown => (Object.hasOwn(data, field) ? data[field] : originalDoc?.[field])

/** A connector can target only a Site in its own tenant. */
export const ensureConnectorTenantConsistency: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  req,
}) => {
  const connectorTenantId = idOf(fieldValue(data, originalDoc, "tenant"))
  const siteId = idOf(fieldValue(data, originalDoc, "site"))
  if (connectorTenantId === null || siteId === null) {
    return data
  }

  const site = await req.payload.findByID({
    collection: "sites",
    id: siteId,
    depth: 0,
    overrideAccess: true,
  })
  const siteTenantId = idOf(site.tenant)
  if (siteTenantId !== null && String(siteTenantId) !== String(connectorTenantId)) {
    throw new APIError("CMS_CONNECTOR_TENANT_MISMATCH", 400)
  }
  return data
}

/**
 * A configured intake channel. `secretReference` is deliberately a reference
 * (for example, a vault path or environment key), never a credential value.
 */
export const Connectors = {
  slug: "connectors",
  labels: {
    plural: localized("Connectors", "采集渠道"),
    singular: localized("Connector", "采集渠道"),
  },
  admin: {
    defaultColumns: ["name", "type", "status", "site", "tenant", "updatedAt"],
    group: localized("Sources", "稿源"),
    useAsTitle: "name",
  },
  access: collectionAccess(CMS_RESOURCE.CONNECTORS),
  hooks: {
    beforeChange: [ensureConnectorTenantConsistency],
  },
  fields: localizedFields([
    {
      name: "name",
      type: "text",
      required: true,
    },
    {
      name: "type",
      type: "select",
      options: ["manual", "url", "webhook", "rss"],
      required: true,
    },
    {
      name: "status",
      type: "select",
      options: ["active", "disabled"],
      required: true,
      defaultValue: "active",
    },
    {
      name: "site",
      label: localized("Target site", "目标站点"),
      type: "relationship",
      relationTo: "sites",
      required: true,
      index: true,
      admin: {
        components: {
          Cell: "/components/fields/SiteCell#SiteCell",
        },
      },
    },
    tenantField({ index: true }),
    {
      name: "sourceEndpoint",
      label: localized("Source endpoint", "来源端点"),
      type: "text",
      admin: {
        description: localized(
          "URL or provider endpoint; do not include credentials.",
          "URL 或提供方端点；不得包含凭据。",
        ),
      },
    },
    {
      name: "secretReference",
      label: localized("Secret reference", "密钥引用"),
      type: "text",
      admin: {
        description: localized(
          "Reference to externally managed secret material. Secret values are never stored here.",
          "指向外部托管密钥材料的引用。此处绝不存储密钥值。",
        ),
      },
    },
    {
      name: "lastPolledAt",
      label: localized("Last polled at", "上次轮询时间"),
      type: "date",
      index: true,
      admin: {
        readOnly: true,
        description: localized(
          "Set by the scheduled RSS poller; not editable by hand.",
          "由定时 RSS 轮询写入；不可手工编辑。",
        ),
      },
    },
  ]),
} satisfies CollectionConfig
