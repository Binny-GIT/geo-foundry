import { describe, expect, it, vi } from "vitest"

vi.mock("../../src/server/auth/session", () => ({
  authenticateRequest: vi.fn(async () => null),
}))

import { handleInternalRequest } from "../../src/server/routes/internal"

const options = (slug: readonly string[]) =>
  handleInternalRequest(
    new Request(`http://local/api/${slug.join("/")}`, {
      headers: { "x-request-id": "options-0001" },
      method: "OPTIONS",
    }),
    slug,
  )

describe("internal 路由匹配", () => {
  it("OPTIONS 按已注册的 GET 路径进入 guards 并返回 204", async () => {
    const response = await options(["internal", "editions", "12", "input"])

    expect(response?.status).toBe(204)
  })

  it("OPTIONS 按已注册的 POST 路径进入 guards 并返回 204", async () => {
    const response = await options(["internal", "connectors", "poll-due"])

    expect(response?.status).toBe(204)
  })

  it("OPTIONS 对未注册路径仍返回 404", async () => {
    const response = await options(["internal", "not-registered"])

    expect(response?.status).toBe(404)
  })
})
