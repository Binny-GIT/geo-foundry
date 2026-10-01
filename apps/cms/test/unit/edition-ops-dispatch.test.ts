import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ role: "reviewer" as string, authenticated: true }))

vi.mock("../../src/server/auth/session", () => ({
  authenticateRequest: async () =>
    state.authenticated
      ? { claims: { kind: "user", role: state.role, tenantId: 4, userId: "8" }, siteIds: [] }
      : null,
}))
vi.mock("../../src/server/repositories/entities", () => ({
  entityScopeOf: () => ({ kind: "tenant", tenantId: 4 }),
}))
vi.mock("../../src/server/repositories/editions", () => ({
  EditionsRepository: class {
    findDraft = async () => null
  },
}))
vi.mock("../../src/server/runtime", () => ({ serverRuntime: () => ({ db: {} }) }))

import { POST } from "../../src/app/(api)/api/[...slug]/route"
import { handleEditionOpsPost } from "../../src/server/routes/edition-ops"

const post = (slug: readonly string[], body: unknown = {}): Promise<Response> =>
  POST(
    new Request(`http://localhost/api/${slug.join("/")}`, {
      body: JSON.stringify(body),
      method: "POST",
    }),
    { params: Promise.resolve({ slug: [...slug] }) },
  )

describe("edition ops action claiming", () => {
  beforeEach(() => {
    state.authenticated = true
    state.role = "reviewer"
  })

  it("returns null without authenticating when the action is not claimed", async () => {
    // 前提：未登录且操作不属于 edition-ops
    state.authenticated = false
    const request = new Request("http://localhost/api/editions/42/review-comments", {
      method: "POST",
    })
    // 执行：检查操作归属
    const result = await handleEditionOpsPost(request, ["editions", "42", "review-comments"])
    // 结果：交由后续处理器认领
    expect(result).toBeNull()
  })

  it("routes reviewer comments to their own handler", async () => {
    // 前提：审核人提交无效评论；执行：经总路由派发
    const result = await post(["editions", "42", "review-comments"], {})
    // 结果：由评论处理器验证请求体
    expect(await result.json()).toEqual({ error: { code: "REVIEW_COMMENT_BODY_INVALID" } })
  })

  it.each(["publisher", "reviewer"])("routes %s AI chat to its own handler", async (role) => {
    // 前提：已登录用户访问不存在的文章
    state.role = role
    // 执行：总路由派发 AI 对话
    const result = await post(["editions", "42", "ai-chat"], {
      messages: [{ role: "user", content: "hello" }],
    })
    // 结果：AI 对话执行自身的范围查询
    expect(await result.json()).toEqual({ error: { code: "AI_CHAT_NOT_FOUND" } })
  })

  it.each([
    ["review-comments", "REVIEW_COMMENT_UNAUTHENTICATED"],
    ["ai-chat", "AI_CHAT_UNAUTHENTICATED"],
    ["article-sources", "ARTICLE_SOURCE_UNAUTHENTICATED"],
  ])("uses the target handler's authentication error for %s", async (action, code) => {
    // 前提：调用方未登录
    state.authenticated = false
    // 执行：总路由派发操作
    const result = await post(["editions", "42", action])
    // 结果：所属处理器返回专属鉴权错误
    expect(await result.json()).toEqual({ error: { code } })
  })

  it("still forbids publisher duplicate", async () => {
    // 前提：publisher 请求 edition-ops 已认领的操作
    state.role = "publisher"
    // 执行：总路由派发复制操作
    const result = await post(["editions", "42", "duplicate"])
    // 结果：edition-ops 权限门禁不变
    expect(await result.json()).toEqual({ error: { code: "EDITION_OPS_FORBIDDEN" } })
  })

  it("does not claim sites or unknown actions", async () => {
    // 前提：请求不属于复制或改派
    state.authenticated = false
    // 执行：派发未知路径
    const result = await post(["editions", "42", "unexpected"])
    // 结果：普通 404，而非 edition-ops 错误
    expect(await result.json()).toEqual({ error: { code: "API_ROUTE_NOT_FOUND" } })
    expect(
      await handleEditionOpsPost(new Request("http://localhost/api/editions/42/sites"), [
        "editions",
        "42",
        "sites",
      ]),
    ).toBeNull()
  })
})
