import type { CollectionConfig } from "payload"

import { localized, localizedFields } from "./shared/localized-labels"

/**
 * Daily delivery-API usage aggregate. Written only by the delivery endpoints
 * through overrideAccess; the REST surface is read-only for authenticated
 * console sessions and never publicly writable.
 */
export const ApiUsageDaily = {
  slug: "api-usage-dailies",
  labels: {
    plural: localized("API Usage", "接口调用统计"),
    singular: localized("API Usage Entry", "接口调用统计"),
  },
  admin: {
    defaultColumns: ["date", "route", "siteId", "count"],
    group: localized("Quality & Release", "质量与发布"),
    useAsTitle: "date",
  },
  access: {
    create: () => false,
    delete: () => false,
    read: ({ req }) => req.user !== null && req.user !== undefined,
    update: () => false,
  },
  fields: localizedFields([
    {
      name: "date",
      type: "text",
      required: true,
      label: localized("Date (UTC)", "日期（UTC）"),
      validate: (value: unknown): true | string =>
        typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
          ? true
          : "Date must be YYYY-MM-DD",
    },
    {
      name: "route",
      type: "select",
      required: true,
      label: localized("Route", "路由"),
      options: [
        { label: localized("Article list", "文章列表"), value: "articles" },
        { label: localized("Article detail", "文章详情"), value: "article" },
      ],
    },
    { name: "siteId", type: "number", label: localized("Site ID", "站点 ID") },
    { name: "tenantId", type: "number", label: localized("Tenant ID", "租户 ID") },
    { name: "count", type: "number", label: localized("Request count", "调用次数") },
  ]),
} satisfies CollectionConfig
