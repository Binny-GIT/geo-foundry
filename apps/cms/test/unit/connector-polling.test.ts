/*
 * RSS 父稿处置决策的单测：钉住「终态不停摆」语义。
 * 曾经父稿被 ignored/merged/adopted 后轮询永久跳过（connector-polling 旧逻辑），
 * 现在必须开新批次；这个测试防止回归。
 */

import { describe, expect, it } from "vitest"

import { rssParentActionOf } from "../../src/server/repositories/connector-polling"

describe("rss parent action", () => {
  it("Given a workable parent, when decided, then it is enqueued for fetch", () => {
    expect(rssParentActionOf("new")).toBe("enqueue")
    expect(rssParentActionOf("ready")).toBe("enqueue")
    expect(rssParentActionOf("failed")).toBe("enqueue")
    expect(rssParentActionOf("duplicate")).toBe("enqueue")
  })

  it("Given an in-flight parent, when decided, then the poll skips without touching it", () => {
    expect(rssParentActionOf("fetching")).toBe("skip-inflight")
  })

  it("Given a terminal parent, when decided, then a fresh batch is created — polling never stalls", () => {
    /* 旧实现在这里返回 skip，导致该采集源永久停摆。 */
    expect(rssParentActionOf("ignored")).toBe("create-fresh")
    expect(rssParentActionOf("merged")).toBe("create-fresh")
    expect(rssParentActionOf("adopted")).toBe("create-fresh")
  })

  it("Given an unknown status, when decided, then it falls through to enqueue rather than stall", () => {
    expect(rssParentActionOf("")).toBe("enqueue")
    expect(rssParentActionOf("mystery")).toBe("enqueue")
  })
})
