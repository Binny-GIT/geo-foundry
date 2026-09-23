/*
 * 架构约束测试：照搬 examples/site-b-express/test/architecture.test.mjs 的
 * 检查思路（生产依赖白名单、源码禁止导入控制面/数据库/LLM 包、禁止导入
 * 包源码而非构建产物、与同类服务面主机共享渲染器版本），迁移到 vitest，
 * 并把 forbidden 列表按本仓库控制面实际用到的包名补全
 * （@geo/content-pipeline、@geo/domain、@geo/worker、pg-boss、drizzle-orm），
 * 落实 ADR-001："服务面不得依赖 CMS、PostgreSQL、Redis、BullMQ、编译器、
 * 质量规则或 LLM provider"。
 */
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const packageRoot = resolve(import.meta.dirname, "../..")

const sourceFiles = [
  "src/app.ts",
  "src/auth/site-auth.ts",
  "src/config/credential-file.ts",
  "src/config/environment.ts",
  "src/config/site-keyring.ts",
  "src/main.ts",
  "src/render/absolute-media.ts",
  "src/render/body-html.ts",
  "src/runtime/delivery-runtime.ts",
  "src/runtime/media.ts",
  "src/store/object-reader.ts",
]

const forbidden = [
  "@geo/cms",
  "@geo/compiler",
  "@geo/content-client",
  "@geo/content-pipeline",
  "@geo/domain",
  "@geo/publisher",
  "@geo/quality-rules",
  "@geo/worker",
  "bullmq",
  "drizzle-orm",
  "ioredis",
  "openai",
  "payload",
  "pg",
  "pg-boss",
  "redis",
]

const sharedRendererPackages = ["@geo/render-core", "@geo/render-react", "@geo/runtime", "@geo/schema"]

const expectedDependencies = [
  "@aws-sdk/client-s3",
  "@geo/render-core",
  "@geo/render-react",
  "@geo/runtime",
  "@geo/schema",
  "express",
  "react",
  "react-dom",
  "zod",
]

describe("Delivery serving host only consumes public serving dependencies", () => {
  it("declares exactly the production dependencies the serving plane is allowed", async () => {
    const manifest = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"))
    expect(Object.keys(manifest.dependencies).sort()).toEqual(expectedDependencies)
    expect(manifest.dependencies.express).toBe("5.2.1")
  })

  it("never imports control-plane, database driver, or LLM provider packages from src", async () => {
    for (const sourceFile of sourceFiles) {
      const source = await readFile(resolve(packageRoot, sourceFile), "utf8")
      const specifiers = [...source.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)].map(
        (match) => match[1],
      )
      for (const specifier of forbidden) {
        expect(specifiers.includes(specifier), `${sourceFile} imported forbidden ${specifier}`).toBe(
          false,
        )
      }
      expect(
        specifiers.some((specifier) => specifier?.includes("/src/")),
        `${sourceFile} imported package source instead of a built export`,
      ).toBe(false)
    }
  })

  it("shares the exact renderer/runtime/schema versions used by the other serving hosts", async () => {
    const delivery = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"))
    const siteB = JSON.parse(
      await readFile(resolve(packageRoot, "../../examples/site-b-express/package.json"), "utf8"),
    )
    for (const packageName of sharedRendererPackages) {
      expect(delivery.dependencies[packageName], `${packageName} version differs from site-b-express`).toBe(
        siteB.dependencies[packageName],
      )
    }
  })

  it("never reads or writes a database connection string / credential env var directly by name", async () => {
    const forbiddenEnvPatterns = [/DATABASE_URL/, /PG(?:HOST|PORT|USER|PASSWORD)\b/, /REDIS_URL/]
    for (const sourceFile of sourceFiles) {
      const source = await readFile(resolve(packageRoot, sourceFile), "utf8")
      for (const pattern of forbiddenEnvPatterns) {
        expect(pattern.test(source), `${sourceFile} references ${pattern}`).toBe(false)
      }
    }
  })
})
