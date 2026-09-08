/*
 * 文章 draft overlay 的最终物理表定义。
 * 当前草稿 = _content_editions_v.latest=true；content_editions 是 live 根记录。
 * 正文只读取 version_body_markdown，body 在服务层实时派生，不读取 Payload block 子表。
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
  varchar,
} from "drizzle-orm/pg-core"

import { geo } from "./schema"

const ORIGINS = ["ai", "human", "hybrid"] as const
const WORKFLOW = ["draft", "generating", "review", "approved", "compiled", "published", "archived"] as const
const DOCUMENT_STATUS = ["draft", "published"] as const
const PRIORITIES = ["low", "normal", "high", "urgent"] as const
const EDITORIAL = ["unassigned", "assigned", "in-progress", "blocked"] as const

export const editionCreationOrigin = pgEnum("enum_content_editions_creation_origin", ORIGINS)
export const editionWorkflowStatus = pgEnum("enum_content_editions_workflow_status", WORKFLOW)
export const editionDocumentStatus = pgEnum("enum_content_editions_status", DOCUMENT_STATUS)
export const editionPriority = pgEnum("enum_content_editions_priority", PRIORITIES)
export const editionEditorialStatus = pgEnum("enum_content_editions_editorial_status", EDITORIAL)

export const versionCreationOrigin = pgEnum(
  "enum__content_editions_v_version_creation_origin",
  ORIGINS,
)
export const versionWorkflowStatus = pgEnum(
  "enum__content_editions_v_version_workflow_status",
  WORKFLOW,
)
export const versionDocumentStatus = pgEnum(
  "enum__content_editions_v_version_status",
  DOCUMENT_STATUS,
)
export const versionPriority = pgEnum("enum__content_editions_v_version_priority", PRIORITIES)
export const versionEditorialStatus = pgEnum(
  "enum__content_editions_v_version_editorial_status",
  EDITORIAL,
)

export const contentEditions = geo.table(
  "content_editions",
  {
    id: serial("id").primaryKey(),
    contentId: integer("content_id"),
    siteId: integer("site_id"),
    tenantId: integer("tenant_id"),
    ownerId: integer("owner_id"),
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
    contentModifiedAt: timestamp("content_modified_at", { withTimezone: true, precision: 3 }).notNull(),
    bodyMarkdown: text("body_markdown"),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
    status: editionDocumentStatus("_status").default("draft"),
  },
  (table) => [
    index("content_editions_content_idx").on(table.contentId),
    index("content_editions_site_idx").on(table.siteId),
    index("content_editions_tenant_idx").on(table.tenantId),
    index("content_editions_content_modified_at_idx").on(table.contentModifiedAt),
  ],
)

export const editionVersions = geo.table(
  "_content_editions_v",
  {
    id: serial("id").primaryKey(),
    parentId: integer("parent_id"),
    contentId: integer("version_content_id"),
    siteId: integer("version_site_id"),
    tenantId: integer("version_tenant_id"),
    ownerId: integer("version_owner_id"),
    priority: versionPriority("version_priority").default("normal"),
    dueAt: timestamp("version_due_at", { withTimezone: true, precision: 3 }),
    editorialStatus: versionEditorialStatus("version_editorial_status").default("unassigned"),
    angle: varchar("version_angle"),
    title: varchar("version_title"),
    summary: varchar("version_summary"),
    primaryTopic: varchar("version_primary_topic"),
    citations: jsonb("version_citations"),
    entities: jsonb("version_entities"),
    creationOrigin: versionCreationOrigin("version_creation_origin").default("human"),
    workflowStatus: versionWorkflowStatus("version_workflow_status").default("draft"),
    workflowRevision: numeric("version_workflow_revision").default("0"),
    compiledRelease: varchar("version_compiled_release"),
    auditLog: jsonb("version_audit_log").default([]),
    contentModifiedAt: timestamp("version_content_modified_at", { withTimezone: true, precision: 3 }),
    bodyMarkdown: text("version_body_markdown"),
    versionUpdatedAt: timestamp("version_updated_at", { withTimezone: true, precision: 3 }),
    versionCreatedAt: timestamp("version_created_at", { withTimezone: true, precision: 3 }),
    status: versionDocumentStatus("version__status").default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
    latest: boolean("latest"),
  },
  (table) => [
    index("_content_editions_v_parent_idx").on(table.parentId),
    index("_content_editions_v_latest_idx").on(table.latest),
    index("_content_editions_v_version_content_modified_at_idx").on(table.contentModifiedAt),
  ],
)

export const editionVersionTexts = geo.table(
  "_content_editions_v_texts",
  {
    id: serial("id").primaryKey(),
    order: integer("order").notNull(),
    parentId: integer("parent_id").notNull(),
    path: varchar("path").notNull(),
    text: varchar("text"),
  },
  (table) => [index("_content_editions_v_texts_order_parent").on(table.order, table.parentId)],
)

export const editionVersionRels = geo.table(
  "_content_editions_v_rels",
  {
    id: serial("id").primaryKey(),
    order: integer("order"),
    parentId: integer("parent_id").notNull(),
    path: varchar("path").notNull(),
    siteId: integer("sites_id"),
  },
  (table) => [
    index("_content_editions_v_rels_parent_idx").on(table.parentId),
    index("_content_editions_v_rels_path_idx").on(table.path),
    index("_content_editions_v_rels_sites_id_idx").on(table.siteId),
  ],
)
