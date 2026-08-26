import type { CollectionConfig } from "payload"

import { localized, localizedFields } from "./shared/localized-labels"

/**
 * Exact replay ledger for an editor restoring a saved edition version into a
 * new current draft. It is intentionally separate from async Operations and
 * reviewer decisions because restore is a synchronous content write.
 */
export const EditionDraftRestoreIdempotency = {
  slug: "edition-draft-restore-idempotency",
  timestamps: true,
  labels: {
    plural: localized("Draft restore idempotency", "草稿恢复幂等记录"),
    singular: localized("Draft restore idempotency", "草稿恢复幂等记录"),
  },
  admin: {
    defaultColumns: ["endpoint", "idempotencyKey", "edition", "versionId", "replayCount"],
    group: localized("Diagnostics", "诊断"),
    useAsTitle: "uniqueKey",
  },
  access: {
    create: () => false,
    read: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: localizedFields([
    { name: "uniqueKey", type: "text", required: true, unique: true },
    {
      name: "tenant",
      type: "relationship",
      relationTo: "tenants",
      required: true,
      index: true,
    },
    { name: "endpoint", type: "text", required: true },
    { name: "idempotencyKey", type: "text", required: true, index: true },
    { name: "requestHash", type: "text", required: true },
    {
      name: "edition",
      type: "relationship",
      relationTo: "content-editions",
      required: true,
      index: true,
    },
    { name: "versionId", type: "text", required: true, index: true },
    { name: "actorUserId", type: "text", required: true },
    { name: "requestId", type: "text", required: true },
    {
      name: "responsePayload",
      type: "json",
      required: true,
      admin: { hidden: true },
      access: { create: () => false, update: () => false },
    },
    {
      name: "replayCount",
      type: "number",
      defaultValue: 0,
      admin: { hidden: true },
      access: { create: () => false, update: () => false },
    },
  ]),
} satisfies CollectionConfig
