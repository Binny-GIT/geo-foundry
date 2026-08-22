import { normalizeLocale, validateTimezone } from "@geo/domain"
import type { CollectionConfig } from "payload"

import { collectionAccess } from "../access/functions"
import { CMS_RESOURCE } from "../access/policy"
import { tenantField } from "./shared/tenant-field"

const validateLocaleField = (value: unknown): true | string => {
  const locale = normalizeLocale(value)
  return locale.ok ? true : "Locale must be a canonical BCP-47 tag"
}

const validateTimezoneField = (value: unknown): true | string => {
  const timezone = validateTimezone(value)
  return timezone.ok ? true : "Timezone must be a canonical IANA zone"
}

export const Sites = {
  slug: "sites",
  admin: {
    useAsTitle: "name",
  },
  access: collectionAccess(CMS_RESOURCE.SITES),
  fields: [
    {
      name: "name",
      type: "text",
      required: true,
    },
    tenantField(),
    {
      name: "locale",
      type: "text",
      required: true,
      validate: validateLocaleField,
    },
    {
      name: "timezone",
      type: "text",
      required: true,
      validate: validateTimezoneField,
    },
    {
      name: "status",
      type: "select",
      options: ["active", "disabled"],
      required: true,
      defaultValue: "active",
    },
    {
      name: "contentStrategy",
      type: "group",
      fields: [
        { name: "positioning", type: "text" },
        { name: "tone", type: "text" },
        { name: "language", type: "text" },
        { name: "targetAudience", type: "text", hasMany: true },
        { name: "expertise", type: "text", hasMany: true },
        { name: "preferredTopics", type: "text", hasMany: true },
        { name: "prohibitedTopics", type: "text", hasMany: true },
        { name: "contentAngles", type: "text", hasMany: true },
      ],
    },
    {
      name: "qualityThresholds",
      type: "group",
      fields: [
        { name: "crossDomainBlock", type: "number", min: 0, max: 1, defaultValue: 0.92 },
        { name: "crossDomainReview", type: "number", min: 0, max: 1, defaultValue: 0.85 },
        { name: "sameSiteTitleBlock", type: "number", min: 0, max: 1, defaultValue: 0.9 },
        { name: "overallMinimum", type: "number", min: 0, max: 100, defaultValue: 80 },
        { name: "dimensionMinimum", type: "number", min: 0, max: 100, defaultValue: 75 },
      ],
    },
    {
      name: "seoDefaults",
      type: "group",
      fields: [
        { name: "titleSuffix", type: "text" },
        { name: "defaultDescription", type: "textarea" },
      ],
    },
  ],
} satisfies CollectionConfig
