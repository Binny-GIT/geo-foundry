import type { CollectionConfig } from "payload"

import { collectionAccess } from "../access/functions"
import { CMS_RESOURCE } from "../access/policy"
import { localized, localizedFields } from "./shared/localized-labels"
import { tenantField } from "./shared/tenant-field"

/** Imported, immutable performance observations; raw analytics credentials stay outside Geo Foundry. */
export const PerformanceSnapshots = {
  slug: "performance-snapshots",
  timestamps: true,
  labels: {
    plural: localized("Performance snapshots", "表现快照"),
    singular: localized("Performance snapshot", "表现快照"),
  },
  admin: {
    defaultColumns: ["site", "edition", "source", "observedAt", "visits", "updatedAt"],
    group: localized("Quality & Release", "质量与发布"),
    useAsTitle: "importHash",
  },
  access: collectionAccess(CMS_RESOURCE.PERFORMANCE_SNAPSHOTS),
  fields: localizedFields([
    { name: "importHash", type: "text", required: true, unique: true, index: true },
    tenantField({ index: true }),
    {
      name: "site",
      type: "relationship",
      relationTo: "sites",
      required: true,
      index: true,
      admin: { components: { Cell: "/components/fields/SiteCell#SiteCell" } },
    },
    { name: "edition", type: "relationship", relationTo: "content-editions", index: true },
    { name: "url", type: "text", required: true, index: true },
    { name: "source", type: "text", required: true, index: true },
    { name: "observedAt", type: "date", required: true, index: true },
    { name: "visits", type: "number", min: 0 },
    { name: "engagement", type: "number", min: 0 },
    { name: "conversions", type: "number", min: 0 },
  ]),
} satisfies CollectionConfig
