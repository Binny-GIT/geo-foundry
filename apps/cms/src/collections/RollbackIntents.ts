import type { CollectionConfig } from "payload"

import { collectionAccess } from "../access/functions"
import { CMS_RESOURCE } from "../access/policy"
import { localized, localizedFields } from "./shared/localized-labels"
import { tenantField } from "./shared/tenant-field"

/** Publisher-approved rollback commands consumed only by the worker. */
export const RollbackIntents = {
  slug: "rollback-intents",
  timestamps: true,
  labels: {
    plural: localized("Rollback intents", "回滚意图"),
    singular: localized("Rollback intent", "回滚意图"),
  },
  admin: {
    defaultColumns: ["intentId", "site", "targetReleaseId", "consumedAt"],
    group: localized("Quality & Release", "质量与发布"),
    useAsTitle: "intentId",
  },
  access: collectionAccess(CMS_RESOURCE.RELEASES),
  fields: localizedFields([
    { name: "intentId", type: "text", required: true, unique: true },
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
    { name: "runtimeSiteId", type: "text", required: true },
    { name: "targetReleaseId", type: "text", required: true },
    { name: "expectedManifestSha256", type: "text", required: true },
    { name: "expectedCurrentReleaseId", type: "text", required: true },
    { name: "expectedCurrentManifestSha256", type: "text", required: true },
    { name: "fromReleaseId", type: "text", required: true },
    { name: "fromManifestSha256", type: "text", required: true },
    { name: "reason", type: "textarea" },
    { name: "approvedBy", type: "json", required: true },
    { name: "operationId", type: "text", index: true },
    { name: "consumedAt", type: "date" },
  ]),
} satisfies CollectionConfig
