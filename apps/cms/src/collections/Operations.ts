import type { CollectionConfig } from "payload"

import { collectionAccess } from "../access/functions"
import { CMS_RESOURCE } from "../access/policy"
import { forceTenantFromSession } from "../access/tenant-field"

/**
 * Asynchronous Operation ledger. PostgreSQL is the authoritative store;
 * BullMQ only carries transient scheduling. The lifecycle fields are locked
 * (state/attempt/revision/currentStage/lastStageAt/result/error/auditLog)
 * and move exclusively through the operations-ledger service which enforces
 * the domain state machine, attempt guards, and optimistic concurrency.
 */
export const Operations = {
  slug: "operations",
  timestamps: true,
  admin: {
    defaultColumns: ["operationType", "state", "attempt", "tenant"],
    useAsTitle: "operationId",
  },
  access: collectionAccess(CMS_RESOURCE.OPERATIONS),
  fields: [
    {
      name: "operationId",
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
      hooks: {
        beforeValidate: [forceTenantFromSession],
      },
    },
    {
      name: "site",
      type: "relationship",
      relationTo: "sites",
      index: true,
    },
    {
      name: "operationType",
      type: "select",
      options: ["generate", "evaluate", "publish", "rollback"],
      required: true,
    },
    {
      name: "endpoint",
      type: "text",
      required: true,
    },
    {
      name: "idempotencyKeyHash",
      type: "text",
      admin: { hidden: true },
      access: {
        create: () => false,
        update: () => false,
      },
    },
    {
      name: "state",
      type: "select",
      options: ["queued", "running", "succeeded", "failed", "cancelled"],
      required: true,
      defaultValue: "queued",
      admin: { readOnly: true, description: "Owned by the operations-ledger service" },
      access: {
        create: () => false,
        update: () => false,
      },
    },
    {
      name: "attempt",
      type: "number",
      defaultValue: 1,
      admin: { hidden: true },
      access: {
        create: () => false,
        update: () => false,
      },
    },
    {
      name: "revision",
      type: "number",
      defaultValue: 0,
      admin: { hidden: true },
      access: {
        create: () => false,
        update: () => false,
      },
    },
    {
      name: "currentStage",
      type: "text",
      admin: { hidden: true },
      access: {
        create: () => false,
        update: () => false,
      },
    },
    {
      name: "lastStageAt",
      type: "date",
      admin: { hidden: true },
      access: {
        create: () => false,
        update: () => false,
      },
    },
    {
      name: "targetIds",
      type: "json",
      defaultValue: {},
    },
    {
      name: "result",
      type: "json",
      admin: { hidden: true },
      access: {
        create: () => false,
        update: () => false,
      },
    },
    {
      name: "error",
      type: "json",
      admin: { hidden: true },
      access: {
        create: () => false,
        update: () => false,
      },
    },
    {
      name: "providerVersion",
      type: "text",
    },
    {
      name: "promptVersion",
      type: "text",
    },
    {
      name: "modelId",
      type: "text",
    },
    {
      name: "auditLog",
      type: "json",
      defaultValue: [],
      admin: { hidden: true },
      access: {
        create: () => false,
        update: () => false,
      },
    },
  ],
} satisfies CollectionConfig
