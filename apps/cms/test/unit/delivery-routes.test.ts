import { beforeEach, describe, expect, it, vi } from "vitest"

const { serverRuntime } = vi.hoisted(() => ({ serverRuntime: vi.fn() }))

vi.mock("../../src/server/runtime", () => ({ serverRuntime }))

import {
  configureDeliveryRateLimitForTests,
  deliveryRouteOf,
  handleDeliveryGet,
} from "../../src/server/routes/delivery"

const query = (rows: unknown[][]) => {
  let index = 0
  const chain = {
    from: () => chain,
    limit: () => Promise.resolve(rows[index++] ?? []),
    offset: () => Promise.resolve(rows[index++] ?? []),
    orderBy: () => chain,
    then: <TResult1 = unknown[], TResult2 = never>(
      onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => Promise.resolve(rows[index++] ?? []).then(onfulfilled, onrejected),
    where: () => chain,
  }
  return chain
}

const edition = (overrides: Record<string, unknown> = {}) => ({
  bodyMarkdown: "# 已发布文章",
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  id: 42,
  siteId: 7,
  sites: [],
  summary: "摘要",
  title: "标题",
  updatedAt: new Date("2026-09-02T00:00:00.000Z"),
  workflowStatus: "published",
  ...overrides,
})

const get = (slug: readonly string[]) =>
  handleDeliveryGet(new Request("http://local/api/delivery"), slug)

describe("delivery 路由", () => {
  beforeEach(() => {
    configureDeliveryRateLimitForTests()
    serverRuntime.mockReset()
  })

  it("精确区分三段详情与四段站点列表路径", () => {
    expect(deliveryRouteOf(["delivery", "articles", "42"])).toBe("article")
    expect(deliveryRouteOf(["delivery", "sites", "site.test", "articles"])).toBe("articles")
    expect(deliveryRouteOf(["delivery", "articles", "42", "extra"])).toBeNull()
    expect(deliveryRouteOf(["delivery", "sites", "site.test"])).toBeNull()
  })

  it("返回已发布详情 200", async () => {
    const selected = query([
      [edition()],
      [{ id: 7, locale: "zh-CN", tenantId: 3 }],
      [{ editionId: 42, pathname: "/已发布文章" }],
    ])
    const db = {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({ onConflictDoUpdate: vi.fn(() => Promise.resolve()) })),
      })),
      select: vi.fn(() => selected),
    }
    serverRuntime.mockReturnValue({ db })

    const response = await get(["delivery", "articles", "42"])

    expect(response?.status).toBe(200)
    await expect(response?.json()).resolves.toMatchObject({ id: 42, locale: "zh-CN", title: "标题" })
  })

  it("对未发布详情返回 404", async () => {
    const db = { select: vi.fn(() => query([[edition({ workflowStatus: "draft" })]])) }
    serverRuntime.mockReturnValue({ db })

    const response = await get(["delivery", "articles", "42"])

    expect(response?.status).toBe(404)
    await expect(response?.json()).resolves.toEqual({
      error: { code: "DELIVERY_ARTICLE_NOT_FOUND" },
    })
  })

  it("对未知站点列表返回 404", async () => {
    const db = { select: vi.fn(() => query([[]])) }
    serverRuntime.mockReturnValue({ db })

    const response = await get(["delivery", "sites", "unknown.test", "articles"])

    expect(response?.status).toBe(404)
    await expect(response?.json()).resolves.toEqual({
      error: { code: "DELIVERY_SITE_NOT_FOUND" },
    })
  })

  it("在注入的低阈值下返回 429", async () => {
    configureDeliveryRateLimitForTests(1)
    const db = { select: vi.fn(() => query([[]])) }
    serverRuntime.mockReturnValue({ db })

    await get(["delivery", "sites", "unknown.test", "articles"])
    const limited = await get(["delivery", "sites", "unknown.test", "articles"])

    expect(limited?.status).toBe(429)
    await expect(limited?.json()).resolves.toEqual({
      error: { code: "DELIVERY_RATE_LIMITED" },
    })
  })
})
