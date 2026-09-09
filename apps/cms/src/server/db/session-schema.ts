/*
 * 会话端点批次所需的物理表声明（表均已存在，无新迁移）：
 * intake、article-sources、quality-assessments、domains、publication-plans、
 * api-usage-dailies、releases、rollback-intents。
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

export const intakeChannel = pgEnum("enum_intake_items_channel", [
  "manual",
  "url",
  "webhook",
  "rss",
])
export const intakeStatus = pgEnum("enum_intake_items_status", [
  "new",
  "fetching",
  "ready",
  "failed",
  "ignored",
  "duplicate",
  "adopted",
  "merged",
])
export const intakeDuplicateStatus = pgEnum("enum_intake_items_duplicate_status", [
  "unknown",
  "unique",
  "suspected",
  "duplicate",
])
export const articleSourceRole = pgEnum("enum_article_sources_role", ["primary", "supporting"])
export const domainRole = pgEnum("enum_domains_role", ["canonical", "alias"])
export const domainStatus = pgEnum("enum_domains_status", ["active", "disabled"])
export const publicationPlanStatus = pgEnum("enum_publication_plans_status", [
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
])
export const qualityAssessmentState = pgEnum("enum_quality_assessments_state", [
  "pending",
  "running",
  "passed",
  "failed",
  "error",
])
export const releaseState = pgEnum("enum_releases_state", [
  "building",
  "validated",
  "uploaded",
  "current",
  "superseded",
  "rolled_back",
  "failed",
])
export const usageRoute = pgEnum("enum_api_usage_dailies_route", ["articles", "article"])

const timestamps = {
  updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
}

export const intakeItems = geo.table(
  "intake_items",
  {
    id: serial("id").primaryKey(),
    connectorId: integer("connector_id"),
    tenantId: integer("tenant_id").notNull(),
    channel: intakeChannel("channel").default("manual").notNull(),
    title: varchar("title").notNull(),
    summary: varchar("summary"),
    sourceUrl: varchar("source_url"),
    normalizedUrl: varchar("normalized_url"),
    status: intakeStatus("status").default("new").notNull(),
    duplicateStatus: intakeDuplicateStatus("duplicate_status").default("unknown").notNull(),
    contentHash: varchar("content_hash"),
    snapshotId: integer("snapshot_id"),
    duplicateOfId: integer("duplicate_of_id"),
    mergedIntoId: integer("merged_into_id"),
    suggestedSiteId: integer("suggested_site_id"),
    assignedToId: integer("assigned_to_id"),
    receivedAt: timestamp("received_at", { withTimezone: true, precision: 3 })
      .defaultNow()
      .notNull(),
    adoptedEditionId: integer("adopted_edition_id"),
    failureCode: varchar("failure_code"),
    failureReason: varchar("failure_reason"),
    contentBlocks: jsonb("content_blocks").default([]),
    ...timestamps,
  },
  (table) => [
    index("intake_items_tenant_idx").on(table.tenantId),
    index("intake_items_status_idx").on(table.status),
    index("intake_items_normalized_url_idx").on(table.normalizedUrl),
    index("intake_items_content_hash_idx").on(table.contentHash),
  ],
)

export const articleSources = geo.table(
  "article_sources",
  {
    id: serial("id").primaryKey(),
    editionId: integer("edition_id").notNull(),
    intakeItemId: integer("intake_item_id").notNull(),
    tenantId: integer("tenant_id").notNull(),
    role: articleSourceRole("role").default("supporting").notNull(),
    note: varchar("note"),
    ...timestamps,
  },
  (table) => [
    index("article_sources_edition_idx").on(table.editionId),
    index("article_sources_tenant_idx").on(table.tenantId),
    index("article_sources_intake_item_idx").on(table.intakeItemId),
    uniqueIndex("article_sources_edition_intake_item_idx").on(table.editionId, table.intakeItemId),
  ],
)

export const qualityAssessments = geo.table(
  "quality_assessments",
  {
    id: serial("id").primaryKey(),
    editionId: integer("edition_id").notNull(),
    siteId: integer("site_id").notNull(),
    tenantId: integer("tenant_id").notNull(),
    state: qualityAssessmentState("state").default("pending").notNull(),
    inputHash: varchar("input_hash").notNull(),
    issues: jsonb("issues").default([]).notNull(),
    overall: numeric("overall"),
    dimensions: jsonb("dimensions"),
    modelId: varchar("model_id").notNull(),
    promptVersion: varchar("prompt_version").notNull(),
    provider: varchar("provider").notNull(),
    thresholdsHash: varchar("thresholds_hash").notNull(),
    ...timestamps,
  },
  (table) => [
    index("quality_assessments_edition_idx").on(table.editionId),
    index("quality_assessments_tenant_idx").on(table.tenantId),
  ],
)

export const domains = geo.table(
  "domains",
  {
    id: serial("id").primaryKey(),
    hostname: varchar("hostname").notNull(),
    siteId: integer("site_id").notNull(),
    tenantId: integer("tenant_id").notNull(),
    role: domainRole("role").default("canonical").notNull(),
    status: domainStatus("status").default("active").notNull(),
    ...timestamps,
  },
  (table) => [
    index("domains_site_idx").on(table.siteId),
    index("domains_tenant_idx").on(table.tenantId),
    uniqueIndex("domains_hostname_idx").on(table.hostname),
  ],
)

export const publicationPlans = geo.table(
  "publication_plans",
  {
    id: serial("id").primaryKey(),
    planId: varchar("plan_id").notNull(),
    tenantId: integer("tenant_id").notNull(),
    siteId: integer("site_id").notNull(),
    editionId: integer("edition_id").notNull(),
    requestedById: integer("requested_by_id").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true, precision: 3 }).notNull(),
    timezone: varchar("timezone").notNull(),
    status: publicationPlanStatus("status").default("pending").notNull(),
    operationId: varchar("operation_id"),
    claimedAt: timestamp("claimed_at", { withTimezone: true, precision: 3 }),
    claimedBy: varchar("claimed_by"),
    attempts: integer("attempts").default(0).notNull(),
    lastError: varchar("last_error"),
    publishedAt: timestamp("published_at", { withTimezone: true, precision: 3 }),
    releaseId: varchar("release_id"),
    revision: integer("revision").default(0).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("publication_plans_plan_id_idx").on(table.planId),
    index("publication_plans_edition_idx").on(table.editionId),
    index("publication_plans_status_idx").on(table.status),
  ],
)

export const apiUsageDailies = geo.table(
  "api_usage_dailies",
  {
    id: serial("id").primaryKey(),
    count: integer("count").default(0).notNull(),
    date: varchar("date").notNull(),
    route: usageRoute("route").notNull(),
    siteId: integer("site_id").notNull(),
    tenantId: integer("tenant_id").notNull(),
    ...timestamps,
  },
  (table) => [
    index("api_usage_dailies_date_idx").on(table.date),
    index("api_usage_dailies_site_idx").on(table.siteId),
    uniqueIndex("api_usage_dailies_tenant_date_route_site_idx").on(
      table.tenantId,
      table.date,
      table.route,
      table.siteId,
    ),
  ],
)

export const releases = geo.table(
  "releases",
  {
    id: serial("id").primaryKey(),
    releaseId: varchar("release_id").notNull(),
    manifestSha256: varchar("manifest_sha256").notNull(),
    runtimeSiteId: varchar("runtime_site_id").notNull(),
    tenantId: integer("tenant_id").notNull(),
    siteId: integer("site_id").notNull(),
    state: releaseState("state").default("uploaded").notNull(),
    revision: integer("revision").default(0).notNull(),
    operationId: varchar("operation_id"),
    receipt: jsonb("receipt"),
    auditLog: jsonb("audit_log").default([]),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("releases_release_id_idx").on(table.releaseId),
    index("releases_site_idx").on(table.siteId),
    index("releases_state_idx").on(table.state),
  ],
)

export const rollbackIntents = geo.table(
  "rollback_intents",
  {
    id: serial("id").primaryKey(),
    intentId: varchar("intent_id").notNull(),
    tenantId: integer("tenant_id").notNull(),
    siteId: integer("site_id").notNull(),
    runtimeSiteId: varchar("runtime_site_id").notNull(),
    targetReleaseId: varchar("target_release_id").notNull(),
    expectedManifestSha256: varchar("expected_manifest_sha256").notNull(),
    expectedCurrentReleaseId: varchar("expected_current_release_id").notNull(),
    expectedCurrentManifestSha256: varchar("expected_current_manifest_sha256").notNull(),
    fromReleaseId: varchar("from_release_id").notNull(),
    fromManifestSha256: varchar("from_manifest_sha256").notNull(),
    reason: varchar("reason"),
    approvedBy: jsonb("approved_by").notNull(),
    operationId: varchar("operation_id"),
    consumedAt: timestamp("consumed_at", { withTimezone: true, precision: 3 }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("rollback_intents_intent_id_idx").on(table.intentId),
    index("rollback_intents_site_idx").on(table.siteId),
    index("rollback_intents_operation_idx").on(table.operationId),
  ],
)
