/*
 * 文章物理表：content_editions 是 live 根记录，edition_revisions 是不可变
 * 修订序列；当前草稿 = edition_revisions.latest=true。正文只存 Markdown，
 * blocks 在服务层实时派生。
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core"

import { geo } from "./schema"

const ORIGINS = ["ai", "human", "hybrid"] as const
const WORKFLOW = [
  "draft",
  "generating",
  "review",
  "approved",
  "compiled",
  "published",
  "archived",
] as const
const DOCUMENT_STATUS = ["draft", "published"] as const
const PRIORITIES = ["low", "normal", "high", "urgent"] as const
const EDITORIAL = ["unassigned", "assigned", "in-progress", "blocked"] as const

export const editionCreationOrigin = pgEnum("enum_content_editions_creation_origin", ORIGINS)
export const editionWorkflowStatus = pgEnum("enum_content_editions_workflow_status", WORKFLOW)
export const editionDocumentStatus = pgEnum("enum_content_editions_status", DOCUMENT_STATUS)
export const editionPriority = pgEnum("enum_content_editions_priority", PRIORITIES)
export const editionEditorialStatus = pgEnum("enum_content_editions_editorial_status", EDITORIAL)

export const versionCreationOrigin = pgEnum("enum_edition_revisions_creation_origin", ORIGINS)
export const versionWorkflowStatus = pgEnum("enum_edition_revisions_workflow_status", WORKFLOW)
export const versionDocumentStatus = pgEnum("enum_edition_revisions_status", DOCUMENT_STATUS)
export const versionPriority = pgEnum("enum_edition_revisions_priority", PRIORITIES)
export const versionEditorialStatus = pgEnum("enum_edition_revisions_editorial_status", EDITORIAL)

export const contentEditions = geo.table(
  "content_editions",
  {
    id: serial("id").primaryKey(),
    siteId: integer("site_id"),
    tenantId: integer("tenant_id"),
    ownerId: integer("owner_id"),
    /** 原 contents.topic/intent 的只读历史值（合并后不再有独立 content 身份）。 */
    contentTopic: varchar("content_topic"),
    contentIntent: varchar("content_intent"),
    secondaryTopics: text("secondary_topics").array().notNull().default([]),
    sites: integer("sites").array().notNull().default([]),
    priority: editionPriority("priority").default("normal").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true, precision: 3 }),
    editorialStatus: editionEditorialStatus("editorial_status").default("unassigned").notNull(),
    angle: varchar("angle"),
    title: varchar("title"),
    summary: varchar("summary"),
    primaryTopic: varchar("primary_topic"),
    citations: jsonb("citations"),
    entities: jsonb("entities"),
    creationOrigin: editionCreationOrigin("creation_origin").default("human"),
    workflowStatus: editionWorkflowStatus("workflow_status").default("draft"),
    workflowRevision: numeric("workflow_revision").default("0"),
    compiledRelease: varchar("compiled_release"),
    auditLog: jsonb("audit_log").default([]),
    contentModifiedAt: timestamp("content_modified_at", {
      withTimezone: true,
      precision: 3,
    }).notNull(),
    bodyMarkdown: text("body_markdown"),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
    status: editionDocumentStatus("_status").default("draft"),
  },
  (table) => [
    index("content_editions_site_idx").on(table.siteId),
    index("content_editions_tenant_idx").on(table.tenantId),
    index("content_editions_content_modified_at_idx").on(table.contentModifiedAt),
  ],
)

/**
 * 修订行。TS 属性沿用旧命名（versionUpdatedAt = 文章级 updatedAt 副本，
 * updatedAt = 行写入时间），物理列已去掉 version_ 前缀。
 */
export const editionVersions = geo.table(
  "edition_revisions",
  {
    id: serial("id").primaryKey(),
    parentId: integer("parent_id"),
    siteId: integer("site_id"),
    tenantId: integer("tenant_id"),
    ownerId: integer("owner_id"),
    secondaryTopics: text("secondary_topics").array().notNull().default([]),
    sites: integer("sites").array().notNull().default([]),
    priority: versionPriority("priority").default("normal"),
    dueAt: timestamp("due_at", { withTimezone: true, precision: 3 }),
    editorialStatus: versionEditorialStatus("editorial_status").default("unassigned"),
    angle: varchar("angle"),
    title: varchar("title"),
    summary: varchar("summary"),
    primaryTopic: varchar("primary_topic"),
    citations: jsonb("citations"),
    entities: jsonb("entities"),
    creationOrigin: versionCreationOrigin("creation_origin").default("human"),
    workflowStatus: versionWorkflowStatus("workflow_status").default("draft"),
    workflowRevision: numeric("workflow_revision").default("0"),
    compiledRelease: varchar("compiled_release"),
    auditLog: jsonb("audit_log").default([]),
    contentModifiedAt: timestamp("content_modified_at", { withTimezone: true, precision: 3 }),
    bodyMarkdown: text("body_markdown"),
    versionUpdatedAt: timestamp("edition_updated_at", { withTimezone: true, precision: 3 }),
    versionCreatedAt: timestamp("edition_created_at", { withTimezone: true, precision: 3 }),
    status: versionDocumentStatus("status").default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
    latest: boolean("latest"),
  },
  (table) => [
    index("edition_revisions_parent_idx").on(table.parentId),
    index("edition_revisions_latest_idx").on(table.latest),
    index("edition_revisions_content_modified_at_idx").on(table.contentModifiedAt),
    index("edition_revisions_site_idx").on(table.siteId),
    index("edition_revisions_tenant_idx").on(table.tenantId),
    index("edition_revisions_edition_updated_at_idx").on(table.versionUpdatedAt),
  ],
)

export const editionDraftRestoreIdempotency = geo.table(
  "edition_draft_restore_idempotency",
  {
    id: serial("id").primaryKey(),
    uniqueKey: varchar("unique_key").notNull(),
    tenantId: integer("tenant_id").notNull(),
    endpoint: varchar("endpoint").notNull(),
    idempotencyKey: varchar("idempotency_key").notNull(),
    requestHash: varchar("request_hash").notNull(),
    editionId: integer("edition_id").notNull(),
    versionId: varchar("version_id").notNull(),
    actorUserId: varchar("actor_user_id").notNull(),
    requestId: varchar("request_id").notNull(),
    responsePayload: jsonb("response_payload").notNull(),
    replayCount: numeric("replay_count").default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("edition_draft_restore_idempotency_unique_key_idx").on(table.uniqueKey),
    index("edition_draft_restore_idempotency_edition_idx").on(table.editionId),
    index("edition_draft_restore_idempotency_version_id_idx").on(table.versionId),
  ],
)
