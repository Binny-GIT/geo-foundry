import { describe, expect, it } from "vitest"

import { crawlReconcileActionOf } from "../../src/server/repositories/crawl-dispatch"

describe("crawl 补偿选择", () => {
  const base = { state: "dispatched" as const, jobId: null, ackedAt: null, attempts: 0 }

  it("Given 创建结果尚未登记, when 到期补偿, then 重新调度", () => {
    expect(crawlReconcileActionOf(base)).toBe("dispatch")
  })
  it("Given 已派发远端任务, when 到期补偿, then 拉取结果", () => {
    expect(crawlReconcileActionOf({ ...base, jobId: "job_1234567890abcdef" })).toBe("ingest")
  })
  it("Given 十次未完成, when 到期补偿, then 耗尽重试", () => {
    expect(crawlReconcileActionOf({ ...base, attempts: 10 })).toBe("exhaust")
  })
  it("Given 已落库但尚未确认删除, when 到期补偿, then 重试确认", () => {
    expect(
      crawlReconcileActionOf({
        ...base,
        state: "ingested",
        jobId: "job_1234567890abcdef",
        attempts: 10,
      }),
    ).toBe("ingest")
  })
  it("Given 已确认删除, when 到期补偿, then 跳过", () => {
    expect(crawlReconcileActionOf({ ...base, ackedAt: new Date() })).toBe("skip")
  })
})
