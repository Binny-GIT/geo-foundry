import type { CollectionConfig } from "payload"

import { collectionAccess } from "../access/functions"
import { CMS_RESOURCE } from "../access/policy"
import { localized, localizedFields } from "./shared/localized-labels"
import { tenantField } from "./shared/tenant-field"

export const Contents = {
  slug: "contents",
  labels: {
    plural: localized("Contents", "内容"),
    singular: localized("Content", "内容"),
  },
  admin: {
    defaultColumns: ["topic", "intent", "createdBy", "tenant", "updatedAt"],
    group: localized("Content", "内容"),
    useAsTitle: "topic",
  },
  access: collectionAccess(CMS_RESOURCE.CONTENTS),
  fields: localizedFields([
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
    tenantField(),
    {
      name: "createdBy",
      type: "select",
      options: ["ai", "human", "hybrid"],
      required: true,
      defaultValue: "human",
    },
  ]),
} satisfies CollectionConfig
