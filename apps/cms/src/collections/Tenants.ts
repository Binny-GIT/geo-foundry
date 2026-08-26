import type { CollectionConfig } from "payload"

import { collectionAccess } from "../access/functions"
import { CMS_RESOURCE } from "../access/policy"
import { localized, localizedFields } from "./shared/localized-labels"

export const Tenants = {
  slug: "tenants",
  labels: {
    plural: localized("Tenants", "租户"),
    singular: localized("Tenant", "租户"),
  },
  admin: {
    defaultColumns: ["name", "updatedAt"],
    group: localized("Access", "访问控制"),
    useAsTitle: "name",
  },
  access: collectionAccess(CMS_RESOURCE.TENANTS),
  fields: localizedFields([
    {
      name: "name",
      type: "text",
      required: true,
      unique: true,
    },
  ]),
} satisfies CollectionConfig
