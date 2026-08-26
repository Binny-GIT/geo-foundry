import type { CollectionConfig } from "payload"

import { localized, localizedFields } from "./shared/localized-labels"

/**
 * Synchronous reviewer decisions have their own idempotency ledger. They are
 * not Operations: a decision completes in the request transaction and records
 * its exact public response for safe replay without reopening a workflow row.
 */
export const ReviewerEditionDecisionIdempotency = {
  slug: "reviewer-edition-decision-idempotency",
  timestamps: true,
  labels: {
    plural: localized("Reviewer decision idempotency", "审核决策幂等记录"),
    singular: localized("Reviewer decision idempotency", "审核决策幂等记录"),
  },
  admin: {
    defaultColumns: ["endpoint", "idempotencyKey", "edition", "replayCount"],
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
    {
      name: "uniqueKey",
      type: "text",
      required: true,
      unique: true,
    },
    {
      name: "tenant",
      type: "relationship",
      relationTo: "tenants",
      required: true,
      index: true,
    },
    {
      name: "endpoint",
      type: "text",
      required: true,
    },
    {
      name: "idempotencyKey",
      type: "text",
      required: true,
      index: true,
    },
    {
      name: "requestHash",
      type: "text",
      required: true,
    },
    {
      name: "edition",
      type: "relationship",
      relationTo: "content-editions",
      required: true,
      index: true,
    },
    {
      name: "decisionId",
      type: "text",
      required: true,
      index: true,
    },
    {
      name: "actorUserId",
      type: "text",
      required: true,
    },
    {
      name: "requestId",
      type: "text",
      required: true,
    },
    {
      name: "responsePayload",
      type: "json",
      required: true,
      admin: { hidden: true },
      access: {
        create: () => false,
        update: () => false,
      },
    },
    {
      name: "replayCount",
      type: "number",
      defaultValue: 0,
      admin: { hidden: true },
      access: {
        create: () => false,
        update: () => false,
      },
    },
  ]),
} satisfies CollectionConfig
