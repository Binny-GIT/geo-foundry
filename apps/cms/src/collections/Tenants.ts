import type { CollectionConfig } from "payload"

import { collectionAccess } from "../access/functions"
import { CMS_RESOURCE } from "../access/policy"

export const Tenants = {
  slug: "tenants",
  admin: {
    useAsTitle: "name",
  },
  access: collectionAccess(CMS_RESOURCE.TENANTS),
  fields: [
    {
      name: "name",
      type: "text",
      required: true,
      unique: true,
    },
  ],
} satisfies CollectionConfig
