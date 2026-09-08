/*
 * 服务端数据访问的表定义（批次 4：去 Payload 的 Drizzle 仓储层）。
 *
 * 列名与类型必须与 src/migrations 的手写 DDL 逐列一致（迁移是 schema 的
 * 唯一权威）；本文件只声明服务端查询所需的最小列集，新列按需补齐。
 * Payload 的驼峰字段名（enableAPIToken 之类）到 snake_case 列名的映射
 * 由仓储层负责，不在这里翻译。
 */

import {
  boolean,
  index,
  integer,
  numeric,
  pgEnum,
  pgSchema,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core"

export const geo = pgSchema("geo_foundry")

export const usersRole = pgEnum("enum_users_role", [
  "content-service",
  "editor",
  "publisher",
  "reviewer",
  "super-admin",
  "tenant-admin",
])

/** 认证域所需的 users 列（见 20260818_113851_task10_tenants_users.ts）。 */
export const users = geo.table(
  "users",
  {
    id: serial("id").primaryKey(),
    role: usersRole("role").notNull(),
    tenantId: integer("tenant_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
    enableAPIToken: boolean("enable_a_p_i_key"),
    apiKey: varchar("api_key"),
    apiKeyIndex: varchar("api_key_index"),
    email: varchar("email").notNull(),
    resetPasswordToken: varchar("reset_password_token"),
    resetPasswordExpiration: timestamp("reset_password_expiration", {
      withTimezone: true,
      precision: 3,
    }),
    salt: varchar("salt"),
    hash: varchar("hash"),
    loginAttempts: integer("login_attempts").default(0),
    lockUntil: timestamp("lock_until", { withTimezone: true, precision: 3 }),
  },
  (table) => [
    index("users_tenant_idx").on(table.tenantId),
    uniqueIndex("users_email_idx").on(table.email),
  ],
)

/** users.sessions 数组表（Payload 会话撤销机制，见同迁移）。 */
export const usersSessions = geo.table(
  "users_sessions",
  {
    order: integer("_order").notNull(),
    parentId: integer("_parent_id").notNull(),
    id: varchar("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }),
    expiresAt: timestamp("expires_at", { withTimezone: true, precision: 3 }).notNull(),
  },
  (table) => [index("users_sessions_parent_id_idx").on(table.parentId)],
)

export const tenants = geo.table(
  "tenants",
  {
    id: serial("id").primaryKey(),
    name: varchar("name").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("tenants_name_idx").on(table.name)],
)
