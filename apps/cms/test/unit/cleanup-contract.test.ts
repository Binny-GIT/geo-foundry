import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

const source = (relative: string) =>
  readFile(new URL(`../../${relative}`, import.meta.url), "utf8")

describe("第二轮数据模型收口契约", () => {
  it("媒体只持久化对象身份与可访问元数据，URL 从 tenant+filename 派生", async () => {
    const [route, schema, consoleCollections] = await Promise.all([
      source("src/server/routes/media.ts"),
      source("src/server/db/entity-schema.ts"),
      source("src/server/repositories/console-collections.ts"),
    ])
    expect(route).toContain('url: `/api/media/file/${filename}`')
    expect(route).toContain('mediaPath: `/media/tenants/${row.tenantId}/${filename}`')
    expect(route).toContain(".where(eq(media.filename, candidate))")
    for (const removed of ["thumbnail_u_r_l", "focal_x", "focal_y", 'varchar("media_path")']) {
      expect(schema).not.toContain(removed)
    }
    expect(consoleCollections).not.toContain("thumbnailURL")
    expect(consoleCollections).not.toContain("row.mediaPath")
  })

  it("质量评估的 overall 和 dimensions 从 internal 请求落到数据库", async () => {
    const [endpoint, repository] = await Promise.all([
      source("src/endpoints/internal/editions.ts"),
      source("src/server/repositories/edition-integration.ts"),
    ])
    expect(endpoint).toContain("body.overall")
    expect(endpoint).toContain("body.dimensions")
    expect(repository).toContain("overall: String(input.overall)")
    expect(repository).toContain("dimensions: { ...input.dimensions }")
  })

  it("文章只有 workflowStatus 一个持久化状态真相，兼容 _status 由其派生", async () => {
    const [schema, repository] = await Promise.all([
      source("src/server/db/edition-schema.ts"),
      source("src/server/repositories/editions.ts"),
    ])
    expect(schema).not.toContain("editionDocumentStatus")
    expect(schema).not.toContain("versionDocumentStatus")
    expect(repository).toContain('_status: (row.workflowStatus ?? "draft") === "published"')
  })
})
