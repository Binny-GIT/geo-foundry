import type { CollectionConfig } from "payload"

import { collectionAccess } from "../access/functions"
import { CMS_RESOURCE } from "../access/policy"
import { localized, localizedFields } from "./shared/localized-labels"
import { tenantField } from "./shared/tenant-field"

/**
 * Immutable release registry. Object storage owns artifact bytes; this ledger
 * records the tenant-scoped lifecycle, operation correlation, and audit proof.
 */
export const Releases = {
  slug: "releases",
  timestamps: true,
  labels: {
    plural: localized("Releases", "发布版本"),
    singular: localized("Release", "发布版本"),
  },
  admin: {
    defaultColumns: ["releaseId", "state", "site", "tenant"],
    group: localized("Quality & Release", "质量与发布"),
    useAsTitle: "releaseId",
  },
  access: collectionAccess(CMS_RESOURCE.RELEASES),
  fields: localizedFields([
    { name: "releaseId", type: "text", required: true, unique: true },
    { name: "manifestSha256", type: "text", required: true },
    { name: "runtimeSiteId", type: "text", required: true, index: true },
    tenantField({ index: true }),
    {
      name: "site",
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
  ]),
} satisfies CollectionConfig
