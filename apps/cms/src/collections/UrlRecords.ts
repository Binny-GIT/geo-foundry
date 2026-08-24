import type { CollectionConfig } from "payload"

import { collectionAccess } from "../access/functions"
import { CMS_RESOURCE } from "../access/policy"
import { tenantField } from "./shared/tenant-field"

/**
 * URL Registry persistence. All writes flow through the transaction-bound
 * url-registry service (reserved/active/redirected/gone lifecycle); the
 * collection exposes read paths and the schema only - every API create,
 * update, and delete is denied by the access matrix.
 */
export const UrlRecords = {
  slug: "url-records",
  admin: {
    defaultColumns: ["pathname", "locale", "state"],
    group: "Content",
    useAsTitle: "pathname",
  },
  access: collectionAccess(CMS_RESOURCE.URL_RECORDS),
  indexes: [{ fields: ["site", "state"] }],
  fields: [
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
  ],
} satisfies CollectionConfig
