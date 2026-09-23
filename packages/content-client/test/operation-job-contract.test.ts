import { describe, expect, it } from "vitest"

import {
  operationJobDataOf,
  operationJobPayloadIssueText,
  parseOperationJobPayload,
} from "../src/operation-job.js"

const SHA = (char: string): string => char.repeat(64)

/** 各 operationType 的代表性真实 body（字段与 CMS 入队端构造一致）。 */
const bodies = {
  evaluate: { editionId: 42, thresholds: { dimensionMin: 75, overallMin: 80 } },
  generate: {
    brief: {
      intent: "E2E 生成意图",
      sources: [{ id: "src-1", snippet: "来源片段", title: "来源标题" }],
      topic: "E2E 主题",
    },
    contentId: 1,
    targets: [
      {
        angle: "E2E 角度",
        editionId: 2,
        siteStrategy: { locale: "zh-CN", name: "NKMed" },
      },
    ],
  },
  publish: { editionId: 42, siteId: 375 },
  rollback: {
    expectedCurrentManifestSha256: SHA("a"),
    expectedCurrentReleaseId: "rel-previous-release",
    expectedManifestSha256: SHA("b"),
    rollbackIntentId: "11111111-2222-4333-8444-555555555555",
    siteId: "site-375",
    targetReleaseId: "rel-target-release",
  },
} as const

const jobDataFor = (operationType: keyof typeof bodies) =>
  operationJobDataOf({
    body: bodies[operationType],
    operationId: "op-test",
    operationType,
    stage: `${operationType}-stage`,
    tenantId: 413,
  })

describe("operation job contract", () => {
  it("round-trips builder output through the parser for every operation type", () => {
    for (const operationType of Object.keys(bodies) as (keyof typeof bodies)[]) {
      const data = jobDataFor(operationType)
      const parsed = parseOperationJobPayload(data.payload, operationType)
      expect(parsed.success, operationType).toBe(true)
      if (parsed.success) {
        expect(parsed.data).toEqual(bodies[operationType])
      }
    }
  })

  it("builds the exact unified envelope without extra keys", () => {
    const data = jobDataFor("publish")
    expect(data).toEqual({
      kind: "operation",
      operationId: "op-test",
      operationType: "publish",
      payload: { body: bodies.publish },
      stage: "publish-stage",
      tenantId: 413,
    })
    expect(Object.keys(data).sort()).toEqual([
      "kind",
      "operationId",
      "operationType",
      "payload",
      "stage",
      "tenantId",
    ])
    expect(Object.keys(data.payload)).toEqual(["body"])
  })

  it.each([
    // 2026-09-09 线上事故形状：publish 发扁平 event payload，无 body 包装。
    ["publish", { editionId: 42, operationType: "publish", releaseId: "rel-op1", siteId: 375 }],
    // 回滚事故形状：body 内容被直接当 payload 发送。
    ["rollback", bodies.rollback],
    // body 缺失。
    ["publish", {}],
    // 包装层散字段（strict 拒绝）。
    ["publish", { body: bodies.publish, extra: 1 }],
    ["publish", undefined],
    ["publish", null],
  ] as const)("rejects the legacy broken payload shape for %s", (operationType, payload) => {
    const parsed = parseOperationJobPayload(payload, operationType)
    expect(parsed.success).toBe(false)
  })

  it("rejects malformed bodies per operation type", () => {
    for (const payload of [
      { body: { editionId: -1 } },
      { body: { editionId: "42" } },
      { body: { editionId: 42, siteId: "site-375" } },
      { body: { editionId: 42, bogus: 1 } },
    ]) {
      const parsed = parseOperationJobPayload(payload, "publish")
      expect(parsed.success).toBe(false)
    }
    const rollback = parseOperationJobPayload(
      { body: { ...bodies.rollback, targetReleaseId: "x" } },
      "rollback",
    )
    expect(rollback.success).toBe(false)
  })

  it("formats issues as path-prefixed messages", () => {
    const parsed = parseOperationJobPayload({ body: { editionId: -1 } }, "publish")
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      const text = operationJobPayloadIssueText(parsed.error)
      expect(text).toContain("editionId")
      expect(text).toContain(":")
    }
  })
})
