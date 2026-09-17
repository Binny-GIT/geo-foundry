/*
 * 服务端数据访问的核心表定义。TypeScript schema 与已提交 SQL migration
 * 必须逐列一致；业务属性名到 PostgreSQL snake_case 列名在此显式映射。
 */

import {
  boolean,
  index,
  integer,
  pgEnum,
  pgSchema,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core"

export const geo = pgSchema("geo_foundry")

export const usersRole = pgEnum("enum_users_role", [
  "automation",
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

/** 会话撤销表：sid、创建时间与过期时间。 */
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

/*
 * 集成密钥。明文只在创建响应里出现一次，库里只有 HMAC 索引与展示用前缀。
 * 与 users.api_key_index 的关系：那一列继续服务 Worker keyring（认证回退路径），
 * 本表服务人工在 Console 里签发给外部工具的密钥，两者互不影响。
 * 吊销是软删除（revoked_at），保留审计痕迹；认证每次查库，吊销下一请求即生效。
 */
export const apiCredentials = geo.table(
  "api_credentials",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull(),
    userId: integer("user_id").notNull(),
    name: varchar("name").notNull(),
    keyPrefix: varchar("key_prefix").notNull(),
    keyIndex: varchar("key_index").notNull(),
    createdById: integer("created_by_id").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, precision: 3 }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, precision: 3 }),
    expiresAt: timestamp("expires_at", { withTimezone: true, precision: 3 }),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("api_credentials_key_index_idx").on(table.keyIndex),
    index("api_credentials_tenant_idx").on(table.tenantId),
    index("api_credentials_user_idx").on(table.userId),
  ],
)
