/* 基础实体的最终物理表定义；以 migrations 顺序叠加后的 PostgreSQL 为权威。 */

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
  vector,
} from "drizzle-orm/pg-core"

import { geo } from "./schema"

export const siteStatus = pgEnum("enum_sites_status", ["active", "disabled"])
export const connectorType = pgEnum("enum_connectors_type", ["manual", "url", "webhook", "rss"])
export const connectorStatus = pgEnum("enum_connectors_status", ["active", "disabled"])
export const sourceSnapshotKind = pgEnum("enum_source_snapshots_kind", [
  "raw-response",
  "extracted-content",
])

export const sites = geo.table(
  "sites",
  {
    id: serial("id").primaryKey(),
    name: varchar("name").notNull(),
    tenantId: integer("tenant_id").notNull(),
    locale: varchar("locale").notNull(),
    timezone: varchar("timezone").notNull(),
    status: siteStatus("status").default("active").notNull(),
    contentStrategyPositioning: varchar("content_strategy_positioning"),
    contentStrategyTone: varchar("content_strategy_tone"),
    contentStrategyLanguage: varchar("content_strategy_language"),
    contentStrategyCta: varchar("content_strategy_cta"),
    contentStrategyTargetAudience: jsonb("content_strategy_target_audience").notNull().default([]),
    contentStrategyExpertise: jsonb("content_strategy_expertise").notNull().default([]),
    contentStrategyPreferredTopics: jsonb("content_strategy_preferred_topics")
      .notNull()
      .default([]),
    contentStrategyProhibitedTopics: jsonb("content_strategy_prohibited_topics")
      .notNull()
      .default([]),
    contentStrategyProhibitedExpressions: jsonb("content_strategy_prohibited_expressions")
      .notNull()
      .default([]),
    contentStrategyContentAngles: jsonb("content_strategy_content_angles").notNull().default([]),
    qualityThresholdsCrossDomainBlock: numeric("quality_thresholds_cross_domain_block").default(
      "0.92",
    ),
    qualityThresholdsCrossDomainReview: numeric("quality_thresholds_cross_domain_review").default(
      "0.85",
    ),
    qualityThresholdsSameSiteTitleBlock: numeric(
      "quality_thresholds_same_site_title_block",
    ).default("0.9"),
    qualityThresholdsOverallMinimum: numeric("quality_thresholds_overall_minimum").default("80"),
    qualityThresholdsDimensionMinimum: numeric("quality_thresholds_dimension_minimum").default(
      "75",
    ),
    seoDefaultsTitleSuffix: varchar("seo_defaults_title_suffix"),
    seoDefaultsDefaultDescription: varchar("seo_defaults_default_description"),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
  },
  (table) => [index("sites_tenant_idx").on(table.tenantId)],
)

export const connectors = geo.table(
  "connectors",
  {
    id: serial("id").primaryKey(),
    name: varchar("name").notNull(),
    type: connectorType("type").notNull(),
    status: connectorStatus("status").default("active").notNull(),
    siteId: integer("site_id").notNull(),
    tenantId: integer("tenant_id").notNull(),
    sourceEndpoint: varchar("source_endpoint"),
    secretReference: varchar("secret_reference"),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true, precision: 3 }),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    index("connectors_site_idx").on(table.siteId),
    index("connectors_tenant_idx").on(table.tenantId),
  ],
)

export const sourceSnapshots = geo.table(
  "source_snapshots",
  {
    id: serial("id").primaryKey(),
    intakeItemId: integer("intake_item_id").notNull(),
    tenantId: integer("tenant_id").notNull(),
    kind: sourceSnapshotKind("kind").notNull(),
    storageKey: varchar("storage_key").notNull(),
    contentHash: varchar("content_hash").notNull(),
    contentType: varchar("content_type"),
    contentLength: integer("content_length"),
    capturedAt: timestamp("captured_at", { withTimezone: true, precision: 3 })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    index("source_snapshots_intake_item_idx").on(table.intakeItemId),
    index("source_snapshots_tenant_idx").on(table.tenantId),
    uniqueIndex("source_snapshots_storage_key_idx").on(table.storageKey),
  ],
)

export const embeddings = geo.table(
  "embeddings",
  {
    id: serial("id").primaryKey(),
    embeddingKey: varchar("embedding_key").notNull(),
    tenantId: integer("tenant_id").notNull(),
    siteId: integer("site_id").notNull(),
    editionId: integer("edition_id").notNull(),
    scope: varchar("scope").notNull(),
    modelId: varchar("model_id").notNull(),
    dimension: integer("dimension").notNull(),
    inputHash: varchar("input_hash").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("embeddings_embedding_key_idx").on(table.embeddingKey),
    index("embeddings_lookup_idx").on(
      table.tenantId,
      table.scope,
      table.modelId,
      table.dimension,
      table.siteId,
    ),
    index("embeddings_edition_idx").on(table.editionId),
    index("embeddings_embedding_hnsw_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
  ],
)

export const media = geo.table(
  "media",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull(),
    alt: varchar("alt").notNull(),
    caption: varchar("caption"),
    filename: varchar("filename"),
    mimeType: varchar("mime_type"),
    filesize: integer("filesize"),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    index("media_tenant_idx").on(table.tenantId),
    uniqueIndex("media_filename_idx").on(table.filename),
  ],
)
