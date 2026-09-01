import type { CollectionConfig } from "payload"

import { collectionAccess } from "../access/functions"
import { CMS_RESOURCE } from "../access/policy"
import { validateTimezoneField } from "./Sites"
import { localized, localizedFields } from "./shared/localized-labels"
import { tenantField } from "./shared/tenant-field"

/** A publisher-authorized UTC release schedule; Worker execution is ledger-backed. */
export const PublicationPlans = {
  slug: "publication-plans",
  timestamps: true,
  labels: {
    plural: localized("Publication plans", "发布计划"),
    singular: localized("Publication plan", "发布计划"),
  },
  admin: {
    defaultColumns: ["edition", "site", "scheduledFor", "timezone", "status", "updatedAt"],
    group: localized("Quality & Release", "质量与发布"),
    useAsTitle: "planId",
  },
  access: collectionAccess(CMS_RESOURCE.PUBLICATION_PLANS),
  fields: localizedFields([
    { name: "planId", type: "text", required: true, unique: true, index: true },
    tenantField({ index: true }),
    {
      name: "site",
      type: "relationship",
      relationTo: "sites",
      required: true,
      index: true,
      admin: { components: { Cell: "/components/fields/SiteCell#SiteCell" } },
    },
    {
      name: "edition",
      type: "relationship",
      relationTo: "content-editions",
      required: true,
      index: true,
      admin: { components: { Cell: "/components/fields/EditionCell#EditionCell" } },
    },
    {
      name: "requestedBy",
      type: "relationship",
      relationTo: "users",
      required: true,
      index: true,
      access: { create: () => false, update: () => false },
    },
    { name: "scheduledFor", type: "date", required: true, index: true },
    {
      name: "timezone",
      type: "text",
      required: true,
      validate: validateTimezoneField,
    },
    {
      name: "status",
      type: "select",
      options: ["pending", "running", "succeeded", "failed", "cancelled"],
      required: true,
      defaultValue: "pending",
      index: true,
      access: { create: () => false, update: () => false },
    },
    {
      name: "operationId",
      type: "text",
      index: true,
      access: { create: () => false, update: () => false },
    },
    { name: "claimedAt", type: "date", access: { create: () => false, update: () => false } },
    { name: "claimedBy", type: "text", access: { create: () => false, update: () => false } },
    {
      name: "attempts",
      type: "number",
      required: true,
      defaultValue: 0,
      access: { create: () => false, update: () => false },
    },
    { name: "lastError", type: "textarea", access: { create: () => false, update: () => false } },
    { name: "publishedAt", type: "date", access: { create: () => false, update: () => false } },
    { name: "releaseId", type: "text", access: { create: () => false, update: () => false } },
    {
      name: "revision",
      type: "number",
      required: true,
      defaultValue: 0,
      access: { create: () => false, update: () => false },
    },
  ]),
} satisfies CollectionConfig
