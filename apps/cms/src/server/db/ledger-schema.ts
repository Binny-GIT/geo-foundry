/*
 * Operations / Idempotency / Outbox 的最终物理表定义。
 *
 * 权威来源（按迁移顺序叠加）：
 * - task16_outbox + editor_evaluation_outbox + rollback_outbox_dispatch
 * - task17_operations + task17b_op_keyhash + task24_request_payload
 */

import {
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core"

import { geo } from "./schema"

export const operationType = pgEnum("enum_operations_operation_type", [
  "generate",
  "evaluate",
  "publish",
  "rollback",
])

export const operationState = pgEnum("enum_operations_state", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
])

export const operations = geo.table(
  "operations",
  {
    id: serial("id").primaryKey(),
    operationId: varchar("operation_id").notNull(),
    tenantId: integer("tenant_id").notNull(),
    siteId: integer("site_id"),
    operationType: operationType("operation_type").notNull(),
    endpoint: varchar("endpoint").notNull(),
    idempotencyKeyHash: varchar("idempotency_key_hash"),
    state: operationState("state").default("queued").notNull(),
    attempt: integer("attempt").default(1),
    revision: integer("revision").default(0),
    currentStage: varchar("current_stage"),
    lastStageAt: timestamp("last_stage_at", { withTimezone: true, precision: 3 }),
    targetIds: jsonb("target_ids").default({}),
    requestPayload: jsonb("request_payload").default({}).notNull(),
    result: jsonb("result"),
    error: jsonb("error"),
    providerVersion: varchar("provider_version"),
    promptVersion: varchar("prompt_version"),
    modelId: varchar("model_id"),
    auditLog: jsonb("audit_log").default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("operations_operation_id_idx").on(table.operationId),
    index("operations_tenant_idx").on(table.tenantId),
    index("operations_site_idx").on(table.siteId),
  ],
)

export const idempotencyRecords = geo.table(
  "idempotency_records",
  {
    id: serial("id").primaryKey(),
    uniqueKey: varchar("unique_key").notNull(),
    tenantId: integer("tenant_id").notNull(),
    endpoint: varchar("endpoint").notNull(),
    idempotencyKey: varchar("idempotency_key").notNull(),
    requestHash: varchar("request_hash").notNull(),
    operationId: varchar("operation_id").notNull(),
    replayCount: integer("replay_count").default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idempotency_records_unique_key_idx").on(table.uniqueKey),
    index("idempotency_records_tenant_idx").on(table.tenantId),
    index("idempotency_records_operation_id_idx").on(table.operationId),
  ],
)
