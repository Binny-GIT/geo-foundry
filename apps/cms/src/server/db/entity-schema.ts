/* 基础实体的最终物理表定义；以 migrations 顺序叠加后的 PostgreSQL 为权威。 */

import {
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  serial,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core"

import { geo } from "./schema"

export const siteStatus = pgEnum("enum_sites_status", ["active", "disabled"])
export const contentCreatedBy = pgEnum("enum_contents_created_by", ["ai", "human", "hybrid"])

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
    contentStrategyProhibitedExpressions: jsonb("content_strategy_prohibited_expressions"),
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

/** Payload hasMany text storage, grouped by path such as contentStrategy.targetAudience. */
export const sitesTexts = geo.table(
  "sites_texts",
  {
    id: serial("id").primaryKey(),
    order: integer("order").notNull(),
    parentId: integer("parent_id").notNull(),
    path: varchar("path").notNull(),
    text: varchar("text"),
  },
  (table) => [index("sites_texts_order_parent").on(table.order, table.parentId)],
)

export const contents = geo.table(
  "contents",
  {
    id: serial("id").primaryKey(),
    topic: varchar("topic").notNull(),
    intent: varchar("intent").notNull(),
    tenantId: integer("tenant_id").notNull(),
    createdBy: contentCreatedBy("created_by").default("human").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
  },
  (table) => [index("contents_tenant_idx").on(table.tenantId)],
)

/** users.sites hasMany relationship storage. */
export const usersRels = geo.table(
  "users_rels",
  {
    id: serial("id").primaryKey(),
    order: integer("order"),
    parentId: integer("parent_id").notNull(),
    path: varchar("path").notNull(),
    siteId: integer("sites_id"),
  },
  (table) => [
    index("users_rels_parent_idx").on(table.parentId),
    index("users_rels_path_idx").on(table.path),
    index("users_rels_sites_id_idx").on(table.siteId),
  ],
)
