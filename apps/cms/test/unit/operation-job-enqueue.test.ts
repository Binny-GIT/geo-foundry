import { parseOperationJobPayload } from "@geo/content-client"
import { beforeEach, describe, expect, it, vi } from "vitest"

type SendCall = { data: Record<string, unknown>; opts: Record<string, unknown>; queue: string }

const sendCalls = vi.hoisted(() => [] as SendCall[])

const send = vi.hoisted(() =>
  vi.fn(async (queue: string, data: Record<string, unknown>, opts: Record<string, unknown>) => {
    sendCalls.push({ data, opts, queue })
    return "job-id"
  }),
)

vi.mock("pg-boss", () => ({
  PgBoss: class {
    async start() {}
    send = send
  },
  fromDrizzle: (tx: unknown, sql: unknown) => ({ sql, tx }),
}))

vi.mock("../../src/server/runtime", () => ({
  serverRuntime: () => ({ pool: {} }),
}))

import { sendOperationJobWithin } from "../../src/server/jobs/pgboss"

const tx = {} as never

const sendCall = (): SendCall => {
  const call = sendCalls[sendCalls.length - 1]
  if (call === undefined) throw new Error("send 未被调用")
  return call
}

const rollbackBody = {
  expectedCurrentManifestSha256: "b".repeat(64),
  expectedCurrentReleaseId: "rel-previous-release",
  expectedManifestSha256: "c".repeat(64),
  rollbackIntentId: "11111111-2222-4333-8444-555555555555",
  siteId: "site-375",
  targetReleaseId: "rel-target-release",
}

describe("sendOperationJobWithin 入队契约", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sendCalls.length = 0
  })

  it("publish：按共享契约构造任务数据入队，payload 可被 worker 侧解析", async () => {
    await sendOperationJobWithin(tx, {
      operationId: "op-publish",
      operationType: "publish",
      payload: { body: { editionId: 42, siteId: 375 } },
      tenantId: 413,
    })

    expect(send).toHaveBeenCalledTimes(1)
    const call = sendCall()
    expect(call.queue).toBe("operation-publish")
    expect(call.data).toEqual({
      kind: "operation",
      operationId: "op-publish",
      operationType: "publish",
      payload: { body: { editionId: 42, siteId: 375 } },
      stage: "publish-gate",
      tenantId: 413,
    })
    expect(call.opts).toMatchObject({ singletonKey: "op-publish" })

    const parsed = parseOperationJobPayload(call.data["payload"], "publish")
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data).toEqual({ editionId: 42, siteId: 375 })
  })

  it("rollback：载荷即台账 requestPayload（含 body 包装），按 rollback-gate 阶段入队", async () => {
    const requestPayload = { body: rollbackBody }
    await sendOperationJobWithin(tx, {
      operationId: "op-rollback",
      operationType: "rollback",
      payload: requestPayload,
      tenantId: 413,
    })

    const call = sendCall()
    expect(call.queue).toBe("operation-publish")
    expect(call.data["stage"]).toBe("rollback-gate")
    expect(call.data["payload"]).toEqual(requestPayload)

    const parsed = parseOperationJobPayload(call.data["payload"], "rollback")
    expect(parsed.success).toBe(true)
  })

  it("evaluate：既有 body 包装载荷照常通过", async () => {
    await sendOperationJobWithin(tx, {
      operationId: "op-evaluate",
      operationType: "evaluate",
      payload: { body: { editionId: 42, thresholds: { dimensionMin: 75, overallMin: 80 } } },
      tenantId: 413,
    })

    expect(sendCall().queue).toBe("operation-evaluation")
    const parsed = parseOperationJobPayload(sendCall().data["payload"], "evaluate")
    expect(parsed.success).toBe(true)
  })

  it("拒绝 2026-09-09 事故形状（publish 扁平 event payload），入队前失败", async () => {
    await expect(
      sendOperationJobWithin(tx, {
        operationId: "op-legacy",
        operationType: "publish",
        payload: { editionId: 42, operationType: "publish", releaseId: "rel-op", siteId: 7 },
        tenantId: 413,
      }),
    ).rejects.toThrow("JOB_OPERATION_PAYLOAD_INVALID:publish")
    expect(send).not.toHaveBeenCalled()
  })

  it("拒绝无 body 包装的回滚载荷", async () => {
    await expect(
      sendOperationJobWithin(tx, {
        operationId: "op-legacy-rollback",
        operationType: "rollback",
        payload: rollbackBody,
        tenantId: 413,
      }),
    ).rejects.toThrow("JOB_OPERATION_PAYLOAD_INVALID:rollback")
    expect(send).not.toHaveBeenCalled()
  })
})
