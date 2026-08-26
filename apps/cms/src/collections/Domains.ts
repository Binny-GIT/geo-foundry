import { normalizeSiteHost } from "@geo/domain"
import {
  APIError,
  type CollectionBeforeChangeHook,
  type CollectionConfig,
  type FieldHook,
} from "payload"

import { collectionAccess } from "../access/functions"
import { CMS_RESOURCE } from "../access/policy"
import {
  localized,
  localizedFields,
  localizedOption,
  localizedValidationMessage,
} from "./shared/localized-labels"
import { tenantField } from "./shared/tenant-field"

const normalizeHostnameHook: FieldHook = ({ value }) => {
  const hostname = normalizeSiteHost(value)
  return hostname.ok ? hostname.value.value : value
}

export const validateHostnameField = (
  value: unknown,
  { req }: { req?: Parameters<typeof localizedValidationMessage>[0] },
): true | string => {
  const hostname = normalizeSiteHost(value)
  return hostname.ok
    ? true
    : localizedValidationMessage(
        req,
        "Hostname must be a valid DNS hostname",
        "主机名必须是有效的 DNS 主机名",
      )
}

const idOf = (reference: unknown): number | string | null =>
  typeof reference === "number" || typeof reference === "string" ? reference : null

const ensureSiteTenantMatches: CollectionBeforeChangeHook = async ({ data, req }) => {
  const siteId = idOf(data["site"])
  if (siteId === null) {
    return data
  }
  const site = await req.payload.findByID({
    collection: "sites",
    id: siteId,
    depth: 0,
    overrideAccess: true,
  })
  const siteTenantId = idOf(site.tenant)
  const domainTenantId = idOf(data["tenant"])
  if (
    siteTenantId !== null &&
    domainTenantId !== null &&
    String(siteTenantId) !== String(domainTenantId)
  ) {
    throw new APIError("CMS_DOMAIN_TENANT_MISMATCH", 400)
  }
  return data
}

export const Domains = {
  slug: "domains",
  labels: {
    plural: localized("Domains", "域名"),
    singular: localized("Domain", "域名"),
  },
  admin: {
    defaultColumns: ["hostname", "status", "role", "site", "tenant", "updatedAt"],
    group: localized("Sites & Domains", "站点与域名"),
    useAsTitle: "hostname",
  },
  access: collectionAccess(CMS_RESOURCE.DOMAINS),
  hooks: {
    beforeChange: [ensureSiteTenantMatches],
  },
  fields: localizedFields([
    {
      name: "hostname",
      label: localized("Hostname", "主机名"),
      admin: {
        description: localized(
          "A valid DNS hostname, without a protocol or path.",
          "有效的 DNS 主机名，不含协议或路径。",
        ),
      },
      type: "text",
      required: true,
      unique: true,
      hooks: {
        beforeValidate: [normalizeHostnameHook],
      },
      validate: validateHostnameField,
    },
    {
      name: "site",
      type: "relationship",
      relationTo: "sites",
      required: true,
    },
    tenantField(),
    {
      name: "role",
      type: "select",
      options: [
        localizedOption("canonical", "Canonical", "规范域名"),
        localizedOption("alias", "Alias", "别名"),
      ],
      required: true,
      defaultValue: "canonical",
    },
    {
      name: "status",
      type: "select",
      options: [
        localizedOption("active", "Active", "启用"),
        localizedOption("disabled", "Disabled", "停用"),
      ],
      required: true,
      defaultValue: "active",
    },
  ]),
} satisfies CollectionConfig
