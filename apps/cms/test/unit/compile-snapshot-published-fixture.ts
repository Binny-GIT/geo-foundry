import { compileSite } from "@geo/compiler"
import { ArticlePageSchema } from "@geo/schema"
import { NodePgPreparedQuery } from "drizzle-orm/node-postgres/session"
import type { PreparedQueryConfig } from "drizzle-orm/pg-core"
import { vi } from "vitest"

import { createServerDb } from "../../src/server/db/client"
import type { editionSites, editionVersions } from "../../src/server/db/edition-schema"
import { buildCompileSnapshot } from "../../src/server/repositories/compile-snapshot"
import { snapshotContentHash } from "../../src/server/repositories/compile-snapshot-selection"

export type Version = typeof editionVersions.$inferSelect
type SiteState = Pick<typeof editionSites.$inferSelect, "publishState" | "releaseId">
const instant = new Date("2026-10-01T00:00:00.000Z")
export const oldVersion: Version = {
  angle: null,
  auditLog: [],
  bodyMarkdown: "旧正文，不应因编辑另一篇文章而消失。",
  citations: [],
  compiledRelease: "release-site-1-old",
  contentModifiedAt: instant,
  createdAt: instant,
  creationOrigin: "human",
  dueAt: null,
  editorialStatus: "unassigned",
  entities: [],
  id: 100,
  latest: false,
  ownerId: 10,
  parentId: 42,
  primaryTopic: "Science",
  priority: "normal",
  secondaryTopics: ["Research"],
  siteId: 1,
  sites: [1, 2],
  summary: "旧摘要",
  tenantId: 1,
  title: "旧标题",
  updatedAt: instant,
  versionCreatedAt: instant,
  versionUpdatedAt: instant,
  workflowRevision: 3,
  workflowStatus: "published",
}
export const newVersion: Version = {
  ...oldVersion,
  bodyMarkdown: "新正文，只在文章更新发布后替换。",
  compiledRelease: null,
  id: 101,
  latest: true,
  title: "新标题",
  workflowRevision: 0,
  workflowStatus: "draft",
}
const publishedSite: SiteState = {
  publishState: "published",
  releaseId: oldVersion.compiledRelease,
}

export const compileSelection = async (input: {
  readonly current?: Version
  readonly published?: Version | null
  readonly siteState?: SiteState
  readonly siteId?: number
  readonly urlState?: "active" | "reserved" | "gone"
  readonly reservedUrl?: boolean
  readonly addEvaluationState?: "failed"
  readonly assessments?: readonly { readonly inputHash: string; readonly state: string }[]
}) => {
  const current = input.current ?? newVersion
  const published = input.published === undefined ? oldVersion : input.published
  const siteState = input.siteState ?? publishedSite
  const siteId = input.siteId ?? 1
  const urlState = input.urlState ?? "active"
  const assessments = input.assessments ?? [
    { inputHash: snapshotContentHash(newVersion), state: "failed" },
    { inputHash: snapshotContentHash(oldVersion), state: "passed" },
  ]
  const other = { ...oldVersion, parentId: 43, id: 102, latest: true, title: "另一篇文章" }
  const rows = [
    { editionId: 42, version: current, ...siteState },
    { editionId: 43, version: other, publishState: "published", releaseId: "release-other" },
  ]
  // 只替换数据库执行边界：查询构造、仓储选文/评估、mapper 与 compileSite 均为真实实现。
  const execute = vi
    .spyOn(NodePgPreparedQuery.prototype, "execute")
    .mockImplementation(async function (this: NodePgPreparedQuery<PreparedQueryConfig>) {
      const { sql, params } = this.getQuery()
      if (sql.includes('from "geo_foundry"."sites"')) {
        return [{ id: siteId, tenantId: 1, name: "快照回归站", locale: "zh-CN", timezone: "UTC" }]
      }
      if (sql.includes('from "geo_foundry"."domains"')) return [{ hostname: "example.test" }]
      if (sql.includes('from "geo_foundry"."content_editions"')) {
        return rows.filter(
          (row) =>
            row.publishState !== "unpublished" &&
            (!sql.includes('"workflow_status" in') || params.includes(row.version.workflowStatus)),
        )
      }
      if (sql.includes("select distinct on")) {
        return published !== null &&
          published.compiledRelease === siteState.releaseId &&
          (published.workflowStatus === "compiled" || published.workflowStatus === "published")
          ? [{ editionId: 42, version: published }]
          : []
      }
      if (sql.includes('from "geo_foundry"."quality_assessments"')) {
        if (sql.includes('"input_hash" =')) {
          return assessments.filter((row) => params.includes(row.inputHash)).slice(0, 1)
        }
        const limit = params.at(-1)
        const assessmentRows = [
          { editionId: 43, inputHash: snapshotContentHash(other), state: "passed" },
          ...assessments.map((row) => ({ ...row, editionId: 42 })),
        ].filter((row) => params.includes(row.editionId))
        return typeof limit === "number" ? assessmentRows.slice(0, limit) : assessmentRows
      }
      if (sql.includes('from "geo_foundry"."url_records"')) {
        return [
          ...(input.reservedUrl === true
            ? [
                {
                  editionId: 42,
                  pathname: "/articles/new-path",
                  state: "reserved",
                  targetPathname: null,
                },
              ]
            : []),
          {
            editionId: 42,
            pathname: "/articles/edition-42",
            state: urlState,
            targetPathname: null,
          },
          {
            editionId: 43,
            pathname: "/articles/edition-43",
            state: "active",
            targetPathname: null,
          },
        ]
      }
      if (sql.includes('from "geo_foundry"."operations"')) {
        return input.addEvaluationState === undefined ||
          !params.includes(`/editions/42/sites/${siteId}/evaluate`)
          ? []
          : [
              {
                operationId: "evaluation-new-draft",
                result: null,
                state: input.addEvaluationState,
              },
            ]
      }
      throw new Error(`未定义的快照夹具查询：${sql}`)
    })
  try {
    const snapshot = await buildCompileSnapshot(
      createServerDb("postgresql://mock:mock@localhost:5432/mock"),
      { siteId, user: { id: 10, role: "content-service", tenant: 1 } },
    )
    const output = await compileSite({
      ...snapshot,
      clock: { now: "2026-10-06T00:00:00.000Z" },
      compilerVersion: "test",
    })
    const article = output.documents.find(
      (entry) => entry.pathname === "/articles/edition-42" && entry.pageType === "article",
    )
    return {
      article:
        article === undefined ? undefined : ArticlePageSchema.parse(JSON.parse(article.canonical)),
      editions: snapshot.editions,
      output,
    }
  } finally {
    execute.mockRestore()
  }
}
