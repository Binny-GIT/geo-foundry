import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import test from "node:test"

import {
  assertCanonicalDomain,
  assertNoBrandLeak,
  assertRendererVersions,
  assertServerRenderedBody,
  assertSitemapScope,
  assertStablePath,
  parseJsonLd,
} from "./assertions.mjs"

const root = resolve(import.meta.dirname, "../..")
const packageJson = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"))
const rejects = (callback, code) => assert.throws(callback, new RegExp(code))

test("E2E negative contracts reject brand leakage", () => {
  rejects(
    () => assertNoBrandLeak("Site A Engineering Site B Operations", "Site B Operations"),
    "BRAND_LEAK",
  )
})

test("E2E negative contracts reject client-only bodies", () => {
  rejects(
    () => assertServerRenderedBody("<main></main>", "Required release content"),
    "CLIENT_ONLY_BODY",
  )
})

test("E2E negative contracts reject wrong-domain canonicals", () => {
  rejects(
    () => assertCanonicalDomain("https://site-b.test/articles/site-a", "site-a.test"),
    "WRONG_DOMAIN_CANONICAL",
  )
})

test("E2E negative contracts reject draft sitemap entries", () => {
  rejects(
    () =>
      assertSitemapScope("<urlset><loc>https://site-a.test/drafts/private</loc></urlset>", {
        forbidden: ["https://site-a.test/drafts/private"],
        forbiddenHosts: [],
        required: ["https://site-a.test/articles/public"],
      }),
    "DRAFT_OR_FOREIGN_SITEMAP",
  )
})

test("E2E negative contracts reject broken JSON-LD", () => {
  rejects(() => parseJsonLd(["{not-json"]), "JSON_LD_INVALID")
})

test("E2E negative contracts reject active URL mutations", () => {
  rejects(
    () =>
      assertStablePath(
        { pathname: "/articles/stable", releaseId: "release-v1" },
        { pathname: "/articles/changed", releaseId: "release-v2" },
      ),
    "ACTIVE_URL_MUTATION",
  )
})

test("E2E negative contracts reject renderer version mismatch", async () => {
  const siteA = await packageJson("examples/site-a-next/package.json")
  const siteB = await packageJson("examples/site-b-express/package.json")
  const incompatible = {
    ...siteB,
    dependencies: { ...siteB.dependencies, "@geo/runtime": "workspace:^999.0.0" },
  }
  rejects(() => assertRendererVersions(siteA, incompatible), "RENDERER_VERSION_MISMATCH")
})
