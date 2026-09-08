import { describe, expect, it } from "vitest"

import { createServerDb } from "../../src/server/db/client"
import {
  AuthenticationError,
  type DomainError,
  DomainValidationError,
  EntityNotFoundError,
  StaleRevisionError,
  TenantScopeError,
} from "../../src/server/errors"
/* 不连接数据库：drizzle 的查询构造是纯计算，toSQL() 足以锁住
 * 表名/列名/参数形态——迁移 DDL 与 schema.ts 一旦漂移立刻在这里暴露。 */
const db = createServerDb("postgresql://mock:mock@localhost:5432/mock")

describe("server db schema bindings", () => {
  it("targets the geo_foundry schema with the migration's column names", () => {
    const sql = db.select().from(db._.fullSchema.users).limit(1).toSQL()
    expect(sql.sql).toContain('"geo_foundry"."users"')
  })

  it("binds every auth-relevant column with its snake_case name", () => {
    const { users } = db._.fullSchema
    const columns = Object.keys(users)
    for (const expected of [
      "enableAPIToken",
      "apiKey",
      "apiKeyIndex",
      "resetPasswordToken",
      "resetPasswordExpiration",
      "loginAttempts",
      "lockUntil",
    ]) {
      expect(columns).toContain(expected)
    }
    // 列对象名与 DDL 的 snake_case 一致（drizzle 的映射源）
    expect(users.enableAPIToken.name).toBe("enable_a_p_i_key")
    expect(users.apiKeyIndex.name).toBe("api_key_index")
    expect(users.loginAttempts.name).toBe("login_attempts")
  })

  it("binds operations, idempotency, and outbox to the final migrated columns", () => {
    const { idempotencyRecords, operations, outboxEvents } = db._.fullSchema
    expect(operations.idempotencyKeyHash.name).toBe("idempotency_key_hash")
    expect(operations.requestPayload.name).toBe("request_payload")
    expect(idempotencyRecords.uniqueKey.name).toBe("unique_key")
    expect(idempotencyRecords.replayCount.name).toBe("replay_count")
    expect(outboxEvents.aggregateType.name).toBe("aggregate_type")
    expect(outboxEvents.eventPayload.name).toBe("event_payload")
    expect(outboxEvents.dispatchedAt.name).toBe("dispatched_at")
  })

  it("contains every post-migration outbox enum value", () => {
    expect(db._.fullSchema.outboxEventType.enumValues).toEqual([
      "edition.transitioned",
      "edition.draft-written",
      "assessment.recorded",
      "edition.compile-recorded",
      "evaluation.requested",
      "publish.requested",
      "rollback.requested",
    ])
    expect(db._.fullSchema.outboxAggregateType.enumValues).toEqual(["edition", "site"])
  })
})

describe("domain errors", () => {
  it("maps every error family to a stable machine code and HTTP status", () => {
    const cases: readonly [DomainError, string, number][] = [
      [new EntityNotFoundError("edition", 573), "EDITION_NOT_FOUND", 404],
      [new TenantScopeError(), "TENANT_SCOPE_DENIED", 403],
      [new StaleRevisionError("edition", 3), "EDITION_REVISION_CONFLICT", 409],
      [new DomainValidationError("TITLE_REQUIRED", "标题必填。"), "TITLE_REQUIRED", 400],
      [new AuthenticationError(), "AUTHENTICATION_FAILED", 401],
    ]
    for (const [error, code, status] of cases) {
      expect(error.code).toBe(code)
      expect(error.status).toBe(status)
      expect(error.message.length).toBeGreaterThan(0)
    }
  })
})
