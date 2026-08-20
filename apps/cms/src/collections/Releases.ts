import type { CollectionConfig } from "payload"

import { collectionAccess } from "../access/functions"
import { CMS_RESOURCE } from "../access/policy"
import { forceTenantFromSession } from "../access/tenant-field"

/**
 * Immutable release registry. Object storage owns artifact bytes; this ledger
 * records the tenant-scoped lifecycle, operation correlation, and audit proof.
 */
export const Releases = {
  slug: "releases",
  timestamps: true,
  admin: {
    defaultColumns: ["releaseId", "state", "site", "tenant"],
    useAsTitle: "releaseId",
  },
  access: collectionAccess(CMS_RESOURCE.RELEASES),
  fields: [
    { name: "releaseId", type: "text", required: true, unique: true },
    { name: "manifestSha256", type: "text", required: true },
    { name: "runtimeSiteId", type: "text", required: true, index: true },
    {
      name: "tenant",
      type: "relationship",
      relationTo: "tenants",
      required: true,
      index: true,
      hooks: { beforeValidate: [forceTenantFromSession] },
    },
    { name: "site", type: "relationship", relationTo: "sites", required: true, index: true },
    {
      name: "state",
      type: "select",
      options: [
        "building",
        "validated",
        "uploaded",
        "current",
        "superseded",
        "rolled_back",
        "failed",
      ],
      required: true,
      defaultValue: "uploaded",
      access: { create: () => false, update: () => false },
    },
    {
      name: "revision",
      type: "number",
      required: true,
      defaultValue: 0,
      access: { create: () => false, update: () => false },
    },
    { name: "operationId", type: "text", access: { create: () => false, update: () => false } },
    { name: "receipt", type: "json", access: { create: () => false, update: () => false } },
    {
      name: "auditLog",
      type: "json",
      defaultValue: [],
      access: { create: () => false, update: () => false },
    },
  ],
} satisfies CollectionConfig
