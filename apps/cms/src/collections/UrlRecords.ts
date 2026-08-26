import type { CollectionConfig } from "payload"

import { collectionAccess } from "../access/functions"
import { CMS_RESOURCE } from "../access/policy"
import { localized, localizedFields } from "./shared/localized-labels"
import { tenantField } from "./shared/tenant-field"

/**
 * URL Registry persistence. All writes flow through the transaction-bound
 * url-registry service (reserved/active/redirected/gone lifecycle); the
 * collection exposes read paths and the schema only - every API create,
 * update, and delete is denied by the access matrix.
 */
export const UrlRecords = {
  slug: "url-records",
  labels: {
    plural: localized("URL records", "URL 记录"),
    singular: localized("URL record", "URL 记录"),
  },
  admin: {
    defaultColumns: ["pathname", "locale", "state"],
    group: localized("Content", "内容"),
    useAsTitle: "pathname",
  },
  access: collectionAccess(CMS_RESOURCE.URL_RECORDS),
  indexes: [{ fields: ["site", "state"] }],
  fields: localizedFields([
    {
      name: "site",
      type: "relationship",
      relationTo: "sites",
      required: true,
    },
    tenantField({ managed: false }),
    {
      name: "content",
      type: "relationship",
      relationTo: "contents",
      required: true,
    },
    {
      name: "locale",
      type: "text",
      required: true,
    },
    {
      name: "pathname",
      type: "text",
      required: true,
    },
    {
      name: "uniqueKey",
      type: "text",
      required: true,
      unique: true,
    },
    {
      name: "state",
      type: "select",
      options: ["reserved", "active", "redirected", "gone"],
      required: true,
      defaultValue: "reserved",
    },
    {
      name: "canonicalUrl",
      type: "text",
    },
    {
      name: "statusCode",
      type: "number",
    },
    {
      name: "targetUrl",
      type: "relationship",
      relationTo: "url-records",
    },
    {
      name: "revision",
      type: "number",
      required: true,
      defaultValue: 0,
    },
    {
      name: "audit",
      type: "json",
      admin: {
        hidden: true,
      },
    },
  ]),
} satisfies CollectionConfig
