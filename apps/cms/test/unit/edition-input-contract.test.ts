import { editionInputSchema } from "@geo/content-client"
import { describe, expect, it, vi } from "vitest"

vi.mock("../../src/access/session", () => ({
  resolveSessionClaims: () => ({
    kind: "service",
    role: "content-service",
    tenantId: 413,
    userId: "svc-1",
  }),
}))

vi.mock("../../src/server/repositories/edition-workflow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/server/repositories/edition-workflow")>()),
  loadCurrentVersion: vi.fn(),
}))

import { readEditionInput } from "../../src/server/repositories/edition-integration"
import { loadCurrentVersion } from "../../src/server/repositories/edition-workflow"

const serviceUser = {
  collection: "users",
  email: "svc@geo-foundry.test",
  id: 1,
  role: "content-service",
  tenant: 413,
}
const db = {
  transaction: async (run: (tx: unknown) => Promise<unknown>) => run({}),
} as never

// 2026-09-23 批次 0a：de-Payload 移除 contents 表后 readEditionInput 漏返
// contentId，worker 端 editionInputSchema 校验失败（CLIENT_RESPONSE_SCHEMA_MISMATCH），
// 真实发布/评估/生成全断。此测试锁定“仓库输出必须过客户端 schema”。
describe("readEditionInput 输出符合 content-client editionInputSchema", () => {
  it("快照含 contentId（=editionId）且整包可被客户端 schema 解析", async () => {
    vi.mocked(loadCurrentVersion).mockResolvedValueOnce({
      root: { id: 42 },
      version: {
        bodyMarkdown: "# 摘要\n\n正文。",
        compiledRelease: null,
        contentModifiedAt: new Date("2026-09-23T05:00:00.000Z"),
        createdAt: new Date("2026-09-23T04:00:00.000Z"),
        primaryTopic: "seo",
        secondaryTopics: [],
        siteId: 375,
        summary: "摘要",
        tenantId: 413,
        title: "标题",
        updatedAt: new Date("2026-09-23T05:00:00.000Z"),
        versionCreatedAt: new Date("2026-09-23T04:00:00.000Z"),
        versionUpdatedAt: new Date("2026-09-23T05:00:00.000Z"),
        workflowRevision: 2,
        workflowStatus: "approved",
      },
    } as never)

    const snapshot = await readEditionInput(db, { editionId: 42, user: serviceUser })

    expect(snapshot.contentId).toBe(42)
    const parsed = editionInputSchema.safeParse(snapshot)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.contentId).toBe(42)
      expect(parsed.data.editionId).toBe(42)
    }
  })
})
