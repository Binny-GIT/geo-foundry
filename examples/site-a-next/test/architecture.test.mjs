import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import test from "node:test"
import assert from "node:assert/strict"

const packageRoot = resolve(import.meta.dirname, "..")
const sourceFiles = [
  "server/environment.mjs",
  "server/response.mjs",
  "server/s3-reader.mjs",
  "server/server.mjs",
  "server/theme.mjs",
]
const forbidden = [
  "@geo/compiler",
  "@geo/content-client",
  "@geo/publisher",
  "@geo/quality-rules",
  "@geo/cms",
  "bullmq",
  "ioredis",
  "openai",
  "payload",
  "pg",
  "redis",
]

test("Site A serving host only consumes public serving dependencies", async () => {
  const manifest = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"))
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), [
    "@aws-sdk/client-s3",
    "@geo/render-core",
    "@geo/render-react",
    "@geo/runtime",
    "@geo/schema",
    "next",
    "react",
    "react-dom",
  ])
  for (const sourceFile of sourceFiles) {
    const source = await readFile(resolve(packageRoot, sourceFile), "utf8")
    const specifiers = [...source.matchAll(/(?:from|import)\\s*["']([^"']+)["']/g)].map(
      (match) => match[1],
    )
    for (const specifier of forbidden) {
      assert.equal(
        specifiers.includes(specifier),
        false,
        `${sourceFile} imported forbidden ${specifier}`,
      )
    }
    assert.equal(
      specifiers.some((specifier) => specifier.includes("/src/")),
      false,
      `${sourceFile} imported package source`,
    )
  }
})
