import { normalizeLocale, validateTimezone } from "@geo/domain"
import type { CollectionConfig } from "payload"

import { collectionAccess } from "../access/functions"
import { CMS_RESOURCE } from "../access/policy"
import { localized, localizedOption, localizedValidationMessage } from "./shared/localized-labels"
import { tenantField } from "./shared/tenant-field"

export const validateLocaleField = (
  value: unknown,
  { req }: { req?: Parameters<typeof localizedValidationMessage>[0] },
): true | string => {
  const locale = normalizeLocale(value)
  return locale.ok
    ? true
    : localizedValidationMessage(
        req,
        "Locale must be a canonical BCP-47 tag",
        "区域设置必须是规范的 BCP-47 标签",
      )
}

export const validateTimezoneField = (
  value: unknown,
  { req }: { req?: Parameters<typeof localizedValidationMessage>[0] },
): true | string => {
  const timezone = validateTimezone(value)
  return timezone.ok
    ? true
    : localizedValidationMessage(
        req,
        "Timezone must be a canonical IANA zone",
        "时区必须是规范的 IANA 时区名称",
      )
}

export const Sites = {
  slug: "sites",
  labels: {
    plural: localized("Sites", "站点"),
    singular: localized("Site", "站点"),
  },
  admin: {
    components: {
      beforeList: ["/components/sites/SitesOperationsWorkspace#SitesOperationsWorkspace"],
    },
    defaultColumns: ["name", "status", "locale", "timezone", "tenant", "updatedAt"],
    group: localized("Sites & Domains", "站点与域名"),
    useAsTitle: "name",
  },
  access: collectionAccess(CMS_RESOURCE.SITES),
  fields: [
    {
      name: "name",
      label: localized("Name", "名称"),
      type: "text",
      required: true,
    },
    tenantField(),
    {
      name: "locale",
      label: localized("Locale", "区域设置"),
      admin: {
        description: localized(
          "Canonical BCP-47 language tag, such as en-US.",
          "规范的 BCP-47 语言标签，例如 zh-CN。",
        ),
      },
      type: "text",
      required: true,
      validate: validateLocaleField,
    },
    {
      name: "timezone",
      label: localized("Timezone", "时区"),
      admin: {
        description: localized(
          "Canonical IANA timezone, such as America/New_York.",
          "规范的 IANA 时区名称，例如 Asia/Shanghai。",
        ),
      },
      type: "text",
      required: true,
      validate: validateTimezoneField,
    },
    {
      name: "status",
      label: localized("Status", "状态"),
      type: "select",
      options: [
        localizedOption("active", "Active", "启用"),
        localizedOption("disabled", "Disabled", "停用"),
      ],
      required: true,
      defaultValue: "active",
    },
    {
      name: "contentStrategy",
      label: localized("Content strategy", "内容策略"),
      type: "group",
      fields: [
        { name: "positioning", label: localized("Positioning", "定位"), type: "text" },
        { name: "tone", label: localized("Tone", "语调"), type: "text" },
        { name: "language", label: localized("Content language", "内容语言"), type: "text" },
        {
          name: "targetAudience",
          label: localized("Target audience", "目标受众"),
          type: "text",
          hasMany: true,
        },
        {
          name: "expertise",
          label: localized("Expertise", "专业领域"),
          type: "text",
          hasMany: true,
        },
        {
          name: "preferredTopics",
          label: localized("Preferred topics", "优先主题"),
          type: "text",
          hasMany: true,
        },
        {
          name: "prohibitedTopics",
          label: localized("Prohibited topics", "禁止主题"),
          type: "text",
          hasMany: true,
        },
        {
          name: "prohibitedExpressions",
          label: localized("Prohibited expressions", "禁止表达"),
          type: "text",
          hasMany: true,
        },
        {
          name: "contentAngles",
          label: localized("Content angles", "内容角度"),
          type: "text",
          hasMany: true,
        },
        {
          name: "cta",
          label: localized("Primary CTA", "主要行动号召"),
          type: "text",
        },
      ],
    },
    {
      name: "qualityThresholds",
      label: localized("Quality thresholds", "质量阈值"),
      type: "group",
      fields: [
        {
          name: "crossDomainBlock",
          label: localized("Cross-domain block", "跨域拦截阈值"),
          type: "number",
          min: 0,
          max: 1,
          defaultValue: 0.92,
        },
        {
          name: "crossDomainReview",
          label: localized("Cross-domain review", "跨域审核阈值"),
          type: "number",
          min: 0,
          max: 1,
          defaultValue: 0.85,
        },
        {
          name: "sameSiteTitleBlock",
          label: localized("Same-site title block", "同站标题拦截阈值"),
          type: "number",
          min: 0,
          max: 1,
          defaultValue: 0.9,
        },
        {
          name: "overallMinimum",
          label: localized("Overall minimum", "总体最低分"),
          type: "number",
          min: 0,
          max: 100,
          defaultValue: 80,
        },
        {
          name: "dimensionMinimum",
          label: localized("Dimension minimum", "维度最低分"),
          type: "number",
          min: 0,
          max: 100,
          defaultValue: 75,
        },
      ],
    },
    {
      name: "seoDefaults",
      label: localized("SEO defaults", "SEO 默认值"),
      type: "group",
      fields: [
        { name: "titleSuffix", label: localized("Title suffix", "标题后缀"), type: "text" },
        {
          name: "defaultDescription",
          label: localized("Default description", "默认描述"),
          type: "textarea",
        },
      ],
    },
  ],
} satisfies CollectionConfig
