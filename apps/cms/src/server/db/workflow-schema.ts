/*
 * 工作流批次的物理表声明：URL 注册表、评审评论、审核决策幂等。
 * 表结构来自既有 Payload migration（本批无新迁移）；根表 texts/rels 用于
 * published/archived 转移时把 draft 内容发布到 live 根表。
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

export const urlRecordState = pgEnum("enum_url_records_state", [
  "reserved",
  "active",
  "redirected",
  "gone",
])

export const reviewCommentKind = pgEnum("enum_review_comments_kind", ["comment", "request-changes"])

export const urlRecords = geo.table(
  "url_records",
  {
    id: serial("id").primaryKey(),
    siteId: integer("site_id").notNull(),
    tenantId: integer("tenant_id").notNull(),
    editionId: integer("edition_id").notNull(),
    locale: varchar("locale").notNull(),
    pathname: varchar("pathname").notNull(),
    uniqueKey: varchar("unique_key").notNull(),
    state: urlRecordState("state").default("reserved").notNull(),
    canonicalUrl: varchar("canonical_url"),
    statusCode: numeric("status_code"),
    targetUrlId: integer("target_url_id"),
    revision: numeric("revision").default("0").notNull(),
    audit: jsonb("audit"),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("url_records_unique_key_idx").on(table.uniqueKey),
    index("url_records_site_idx").on(table.siteId),
    index("url_records_tenant_idx").on(table.tenantId),
    index("url_records_edition_idx").on(table.editionId),
    index("url_records_target_url_idx").on(table.targetUrlId),
    index("site_state_idx").on(table.siteId, table.state),
  ],
)

export const reviewComments = geo.table(
  "review_comments",
  {
    id: serial("id").primaryKey(),
    editionId: integer("edition_id").notNull(),
    tenantId: integer("tenant_id").notNull(),
    authorId: integer("author_id").notNull(),
    kind: reviewCommentKind("kind").default("comment").notNull(),
    body: varchar("body").notNull(),
    workflowRevision: numeric("workflow_revision"),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    index("review_comments_tenant_idx").on(table.tenantId),
    index("review_comments_edition_idx").on(table.editionId),
    index("review_comments_author_idx").on(table.authorId),
    index("review_comments_kind_idx").on(table.kind),
    index("review_comments_workflow_revision_idx").on(table.workflowRevision),
    index("review_comments_created_at_idx").on(table.createdAt),
  ],
)

export const reviewerDecisionIdempotency = geo.table(
  "reviewer_edition_decision_idempotency",
  {
    id: serial("id").primaryKey(),
    uniqueKey: varchar("unique_key").notNull(),
    tenantId: integer("tenant_id").notNull(),
    endpoint: varchar("endpoint").notNull(),
    idempotencyKey: varchar("idempotency_key").notNull(),
    requestHash: varchar("request_hash").notNull(),
    editionId: integer("edition_id").notNull(),
    decisionId: varchar("decision_id").notNull(),
    actorUserId: varchar("actor_user_id").notNull(),
    requestId: varchar("request_id").notNull(),
    responsePayload: jsonb("response_payload").notNull(),
    replayCount: numeric("replay_count").default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("reviewer_edition_decision_idempotency_unique_key_idx").on(table.uniqueKey),
    index("reviewer_edition_decision_idempotency_tenant_idx").on(table.tenantId),
    index("reviewer_edition_decision_idempotency_idempotency_key_idx").on(table.idempotencyKey),
    index("reviewer_edition_decision_idempotency_edition_idx").on(table.editionId),
    index("reviewer_edition_decision_idempotency_decision_id_idx").on(table.decisionId),
  ],
)
