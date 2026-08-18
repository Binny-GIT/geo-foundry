import { normalizeSiteHost } from "@geo/domain"
import {
  APIError,
  type CollectionBeforeChangeHook,
  type CollectionConfig,
  type FieldHook,
} from "payload"

import { collectionAccess } from "../access/functions"
import { CMS_RESOURCE } from "../access/policy"
import { forceTenantFromSession } from "../access/tenant-field"

const normalizeHostnameHook: FieldHook = ({ value }) => {
  const hostname = normalizeSiteHost(value)
  return hostname.ok ? hostname.value.value : value
}

const validateHostnameField = (value: unknown): true | string => {
  const hostname = normalizeSiteHost(value)
  return hostname.ok ? true : "Hostname must be a valid dns hostname"
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
  admin: {
    useAsTitle: "hostname",
  },
  access: collectionAccess(CMS_RESOURCE.DOMAINS),
  hooks: {
    beforeChange: [ensureSiteTenantMatches],
  },
  fields: [
    {
      name: "hostname",
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
    {
      name: "tenant",
      type: "relationship",
      relationTo: "tenants",
      required: true,
      hooks: {
        beforeValidate: [forceTenantFromSession],
      },
    },
    {
      name: "role",
      type: "select",
      options: ["canonical", "alias"],
      required: true,
      defaultValue: "canonical",
    },
    {
      name: "status",
      type: "select",
      options: ["active", "disabled"],
      required: true,
      defaultValue: "active",
    },
  ],
} satisfies CollectionConfig
