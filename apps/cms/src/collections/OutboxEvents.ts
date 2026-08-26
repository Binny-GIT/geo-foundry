import type { CollectionConfig } from "payload"

import { localized, localizedFields } from "./shared/localized-labels"

/**
 * Transactional outbox. Rows are appended by CMS services inside the same
 * database transaction as the workflow change they describe; a dispatcher
 * then creates BullMQ jobs using the stable `eventId` as jobId. Clients can
 * never read or write this collection directly - the REST/GraphQL surface is
 * fully denied and every mutation goes through `overrideAccess` server code.
 */
export const OutboxEvents = {
  slug: "outbox-events",
  timestamps: true,
  labels: {
    plural: localized("Outbox events", "发件箱事件"),
    singular: localized("Outbox event", "发件箱事件"),
  },
  admin: {
    defaultColumns: ["type", "aggregateId", "status", "attempts"],
    group: localized("Diagnostics", "诊断"),
    useAsTitle: "eventId",
  },
  access: {
    create: () => false,
    read: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: localizedFields([
    {
      name: "eventId",
      type: "text",
      required: true,
      unique: true,
    },
    {
      name: "type",
      type: "select",
      options: [
        "edition.transitioned",
        "edition.draft-written",
        "assessment.recorded",
        "edition.compile-recorded",
        "publish.requested",
      ],
      required: true,
    },
    {
      name: "aggregateType",
      type: "select",
      options: ["edition"],
      required: true,
      defaultValue: "edition",
    },
    {
      name: "aggregateId",
      type: "number",
      required: true,
      index: true,
    },
    {
      name: "tenant",
      type: "relationship",
      relationTo: "tenants",
      required: true,
      index: true,
    },
    {
      name: "eventPayload",
      type: "json",
      required: true,
    },
    {
      name: "operationId",
      type: "text",
      index: true,
    },
    {
      name: "requestId",
      type: "text",
    },
    {
      name: "status",
      type: "select",
      options: ["pending", "dispatched"],
      required: true,
      defaultValue: "pending",
      index: true,
      access: {
        create: () => false,
        update: () => false,
      },
    },
    {
      name: "attempts",
      type: "number",
      defaultValue: 0,
      access: {
        create: () => false,
        update: () => false,
      },
    },
    {
      name: "lastError",
      type: "text",
      access: {
        create: () => false,
        update: () => false,
      },
    },
    {
      name: "dispatchedAt",
      type: "date",
      access: {
        create: () => false,
        update: () => false,
      },
    },
  ]),
} satisfies CollectionConfig
