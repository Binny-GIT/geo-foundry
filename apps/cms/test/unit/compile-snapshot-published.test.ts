import { describe, expect, it } from "vitest"

import { createServerDb } from "../../src/server/db/client"
import {
  latestSnapshotVersionsQuery,
  publishedAssessmentQuery,
  publishedSnapshotVersionsQuery,
  snapshotContentHash,
} from "../../src/server/repositories/compile-snapshot-selection"
import {
  compileSelection,
  newVersion,
  oldVersion,
  type Version,
} from "./compile-snapshot-published-fixture"

describe("已发布文章的编辑期快照", () => {
  it.each(["draft", "generating", "review"] as const)(
    "新版为 %s 时保留旧标题和正文",
    async (workflowStatus) => {
      const current = { ...newVersion, workflowStatus }

      const result = await compileSelection({ current })

      expect(result.article).toMatchObject({
        hero: { title: "旧标题" },
        body: [{ type: "paragraph", text: oldVersion.bodyMarkdown }],
      })
      expect(result.editions.find((entry) => entry.editionId === 42)?.assessmentInputHash).toBe(
        snapshotContentHash(oldVersion),
      )
    },
  )

  it("更新批准并发布后使用新内容", async () => {
    const current: Version = {
      ...newVersion,
      compiledRelease: "release-new",
      workflowStatus: "published",
    }

    const result = await compileSelection({
      current,
      siteState: { publishState: "published", releaseId: "release-new" },
      assessments: [{ inputHash: snapshotContentHash(current), state: "passed" }],
    })

    expect(result.article).toMatchObject({
      hero: { title: "新标题" },
      body: [{ type: "paragraph", text: newVersion.bodyMarkdown }],
    })
  })

  it.each(["unpublished", "pending", "failed"] as const)(
    "本站为 %s 时不复活历史发布版本",
    async (publishState) => {
      const siteState = { publishState, releaseId: oldVersion.compiledRelease }

      const result = await compileSelection({ siteState })

      expect(result.article).toBeUndefined()
    },
  )

  it.each(["gone", "reserved"] as const)("本站 URL 为 %s 时不回退", async (urlState) => {
    const result = await compileSelection({ urlState })

    expect(result.article).toBeUndefined()
    expect(result.editions.some((entry) => entry.editionId === 42)).toBe(false)
  })

  it("同时有 reserved 和 active URL 时，回退只服务原 active 路径", async () => {
    const result = await compileSelection({ reservedUrl: true })

    expect(result.article?.hero?.title).toBe("旧标题")
    expect(
      result.output.routeIndex.routes.some((route) => route.pathname === "/articles/new-path"),
    ).toBe(false)
  })

  it("archived 不回退，即使本站发布状态和 URL 尚保留", async () => {
    const current: Version = { ...newVersion, workflowStatus: "archived" }

    const result = await compileSelection({ current })

    expect(result.article).toBeUndefined()
  })

  it("从未发布的 draft 和 reserved URL 不进入产物", async () => {
    const result = await compileSelection({
      published: null,
      siteState: { publishState: "pending", releaseId: null },
      urlState: "reserved",
    })

    expect(result.article).toBeUndefined()
  })

  it.each([
    { siteId: 1, publishState: "published", title: "旧标题" },
    { siteId: 2, publishState: "unpublished", title: undefined },
  ] as const)(
    "同一编辑文章在站点 $siteId 按本站发布状态回退",
    async ({ siteId, publishState, title }) => {
      const result = await compileSelection({
        siteId,
        siteState: { publishState, releaseId: oldVersion.compiledRelease },
      })

      expect(result.article?.hero?.title).toBe(title)
      expect(result.output.routeIndex.siteId).toBe(`site-${siteId}`)
    },
  )

  it.each([null, "release-without-revision"])(
    "没有本站发布 release 的修订证据时不猜测历史版本：%s",
    async (releaseId) => {
      const result = await compileSelection({ siteState: { publishState: "published", releaseId } })

      expect(result.article).toBeUndefined()
    },
  )

  it("多站只取本站 release 的修订，不使用他站较新的 published", async () => {
    const otherSite = { ...oldVersion, compiledRelease: "release-site-2", title: "他站标题" }

    const result = await compileSelection({ published: otherSite })

    expect(result.article).toBeUndefined()
  })

  it("两站均先编译时，本站 published 记录允许回退到 compiled 历史行", async () => {
    const published: Version = { ...oldVersion, workflowStatus: "compiled" }

    const result = await compileSelection({ published })

    expect(result.article?.hero?.title).toBe("旧标题")
  })

  it("没有同 hash 评估时不能借草稿的 passed 结论放行", async () => {
    const assessments = [{ inputHash: snapshotContentHash(newVersion), state: "passed" }]

    await expect(compileSelection({ assessments })).rejects.toThrow(
      "COMPILER_ASSESSMENT_NOT_PASSED",
    )
  })

  it("同 hash 评估 failed 时保留编译器质量门禁", async () => {
    const assessments = [{ inputHash: snapshotContentHash(oldVersion), state: "failed" }]

    await expect(compileSelection({ assessments })).rejects.toThrow(
      "COMPILER_ASSESSMENT_NOT_PASSED",
    )
  })

  it("多次评估新草稿后仍从最新四条窗口之外读取旧内容的同 hash 评估", async () => {
    const assessments = [
      ...Array.from({ length: 9 }, () => ({
        inputHash: snapshotContentHash(newVersion),
        state: "failed",
      })),
      { inputHash: snapshotContentHash(oldVersion), state: "passed" },
    ]

    const result = await compileSelection({ assessments })

    expect(result.article?.hero?.title).toBe("旧标题")
  })

  it("后续新增站点评估失败不替代本站已发布旧内容的评估", async () => {
    const result = await compileSelection({ addEvaluationState: "failed" })

    expect(result.article?.hero?.title).toBe("旧标题")
  })

  it("非回退路径仍遵守 passedSiteAddAssessmentId 的门禁", async () => {
    const current: Version = { ...newVersion, workflowStatus: "approved" }

    await expect(
      compileSelection({
        current,
        addEvaluationState: "failed",
        assessments: [{ inputHash: snapshotContentHash(current), state: "passed" }],
      }),
    ).rejects.toThrow("COMPILER_ASSESSMENT_NOT_PASSED")
  })

  it("记录未修复行为：approved 更新会随其他文章发布提前进入 release", async () => {
    const current: Version = { ...newVersion, workflowStatus: "approved" }

    const result = await compileSelection({
      current,
      assessments: [{ inputHash: snapshotContentHash(current), state: "passed" }],
    })

    expect(result.article?.hero?.title).toBe("新标题")
  })

  it("保留首次发布语义：approved + reserved URL 仍可编译，不能声称既有行为是排除", async () => {
    const current: Version = { ...newVersion, workflowStatus: "approved" }

    const result = await compileSelection({
      current,
      siteState: { publishState: "pending", releaseId: null },
      urlState: "reserved",
      assessments: [{ inputHash: snapshotContentHash(current), state: "passed" }],
    })

    expect(result.article?.hero?.title).toBe("新标题")
  })
})

describe("快照仓储查询合同（不连接数据库）", () => {
  const db = createServerDb("postgresql://mock:mock@localhost:5432/mock")

  it("读取本站 latest 和发布记录，不在 SQL 层提前丢掉编辑中版本", () => {
    const query = latestSnapshotVersionsQuery(db, 7).toSQL()

    expect(query.sql).toContain('"edition_revisions"."latest" =')
    expect(query.sql).toContain('"edition_sites"."site_id" =')
    expect(query.sql).toContain('"edition_sites"."publish_state" <> \'unpublished\'')
    expect(query.params).toContain("draft")
    expect(query.params).toContain("review")
    expect(query.params).not.toContain("archived")
  })

  it("历史修订匹配本站 release，并按修订时间和 id 取最近记录", () => {
    const query = publishedSnapshotVersionsQuery(db, { editionIds: [42], siteId: 7 }).toSQL()

    expect(query.sql).toContain(
      '"geo_foundry"."edition_revisions"."compiled_release" = "geo_foundry"."edition_sites"."release_id"',
    )
    expect(query.params).toEqual([7, "published", 42, "compiled", "published"])
    expect(query.sql).toContain(
      '"geo_foundry"."edition_revisions"."created_at" desc, "geo_foundry"."edition_revisions"."id" desc',
    )
  })

  it("历史评估按文章、本站及内容 hash 查询，避免最新四条的截断", () => {
    const inputHash = snapshotContentHash(oldVersion)

    const query = publishedAssessmentQuery(db, { editionId: 42, siteId: 7, inputHash }).toSQL()

    expect(query.params).toEqual([42, 7, inputHash, 1])
    expect(query.sql).toContain('"quality_assessments"."input_hash" =')
  })
})
