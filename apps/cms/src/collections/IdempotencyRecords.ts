import type { CollectionConfig } from "payload"

/**
 * Idempotency ledger: one row per (tenant, endpoint, idempotencyKey),
 * arbitrated by the unique `uniqueKey` index. It binds the caller's key to
 * exactly one logical Operation plus the canonical request hash, so a replay
 * with the same body returns the original operation while a different body
 * reusing the key is rejected with 409.
 */
export const IdempotencyRecords = {
  slug: "idempotency-records",
  timestamps: true,
  admin: {
    defaultColumns: ["endpoint", "idempotencyKey", "operationId"],
    useAsTitle: "uniqueKey",
  },
  access: {
    create: () => false,
    read: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
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
      name: "operationId",
      type: "text",
      required: true,
      index: true,
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
  ],
} satisfies CollectionConfig
