import type { CollectionConfig } from "payload"

import { collectionAccess } from "../access/functions"
import { CMS_RESOURCE } from "../access/policy"
import { forceTenantFromSession } from "../access/tenant-field"

export const Contents = {
  slug: "contents",
  admin: {
    useAsTitle: "topic",
  },
  access: collectionAccess(CMS_RESOURCE.CONTENTS),
  fields: [
    {
      name: "topic",
      type: "text",
      required: true,
    },
    {
      name: "intent",
      type: "text",
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
      name: "createdBy",
      type: "select",
      options: ["ai", "human", "hybrid"],
      required: true,
      defaultValue: "human",
    },
  ],
} satisfies CollectionConfig
