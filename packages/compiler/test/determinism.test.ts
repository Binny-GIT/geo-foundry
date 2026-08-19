import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { type CompileRequest, compileSite } from "../src/index.js"

const baseRequest = (): CompileRequest => ({
  clock: { now: "2026-08-19T00:00:00Z" },
  compilerVersion: "geo-compiler-1",
  editions: [
    {
      assessmentInputHash: "a".repeat(64),
      assessmentState: "passed",
      author: { id: "author-ada", name: "Ada Chen", url: "https://site-a.test/authors/ada-chen" },
      body: [
        { blockType: "heading", level: "2", text: "Deterministic release gates" },
        { blockType: "paragraph", text: "Every edition passes three gates before it ships." },
      ],
      categories: ["guides"],
      contentId: 12,
      editionId: 101,
      media: [],
      modifiedAt: "2026-08-17T11:00:00Z",
      publishedAt: "2026-08-17T10:00:00Z",
      siteId: "site-a",
      status: "approved",
      summary: "How deterministic gates protect releases.",
      tags: ["contracts"],
      title: "Deterministic release gates",
      urlPathname: "/guides/release-gates",
      urlStatus: "active",
    },
    {
      assessmentInputHash: "b".repeat(64),
      assessmentState: "passed",
      author: { id: "author-ada", name: "Ada Chen", url: "https://site-a.test/authors/ada-chen" },
      body: [{ blockType: "paragraph", text: "Operations runbook body." }],
      categories: ["runbooks"],
      contentId: 12,
      editionId: 102,
      media: [],
      modifiedAt: "2026-08-17T12:00:00Z",
      publishedAt: "2026-08-17T12:00:00Z",
      siteId: "site-a",
      status: "approved",
      summary: "Runbook summary.",
      tags: [],
      title: "Operations runbook",
      urlPathname: "/runbooks/operations",
      urlStatus: "active",
    },
  ],
  listings: {
    articles: { pathname: "/articles", pageSize: 1 },
    categories: [
      { id: "cat-guides", pathname: "/guides", slug: "guides", title: "Guides" },
      { id: "cat-runbooks", pathname: "/runbooks", slug: "runbooks", title: "Runbooks" },
    ],
    tags: [
      { id: "tag-contracts", pathname: "/tags/contracts", slug: "contracts", title: "Contracts" },
    ],
  },
  notFound: { pathname: "/not-found" },
  redirects: [
    { fromPathname: "/old-guides", targetUrl: "https://site-a.test/guides/release-gates" },
    { fromPathname: "/old-runbooks", targetUrl: "https://site-a.test/runbooks/operations" },
  ],
  site: {
    canonicalDomain: "site-a.test",
    locale: "en-US",
    name: "Site A",
    seoDefaults: { description: "Site A default description.", title: "Site A" },
    organization: { logoUrl: "/media/logo.svg", name: "Site A Media" },
    siteId: "site-a",
    timezone: "UTC",
  },
})

const shuffle = <T>(values: readonly T[]): T[] => {
  const copy = [...values]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1))
    const left = copy[index]
    const right = copy[swap]
    if (left !== undefined && right !== undefined) {
      copy[index] = right
      copy[swap] = left
    }
  }
  return copy
}

const artifactsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../temp")

describe("compiler determinism", () => {
  it("yields byte-identical canonical JSON and hashes for shuffled inputs", async () => {
    const first = await compileSite(baseRequest())
    const second = await compileSite({
      ...baseRequest(),
      editions: shuffle(baseRequest().editions).reverse(),
      listings: {
        ...baseRequest().listings,
        categories: shuffle(baseRequest().listings.categories),
        tags: shuffle(baseRequest().listings.tags),
      },
      redirects: shuffle(baseRequest().redirects),
    })
    expect(second.documents.map((document) => document.pathname)).toEqual(
      first.documents.map((document) => document.pathname),
    )
    for (const document of first.documents) {
      const counterpart = second.documents.find((entry) => entry.pathname === document.pathname)
      expect(counterpart?.canonical).toBe(document.canonical)
      expect(counterpart?.sha256).toBe(document.sha256)
    }
    expect(second.manifestSha256).toBe(first.manifestSha256)
  })

  it("writes two manifests and an empty diff artifact", async () => {
    const first = await compileSite(baseRequest())
    const second = await compileSite({
      ...baseRequest(),
      editions: [...baseRequest().editions].reverse(),
    })
    await mkdir(artifactsDirectory, { recursive: true })
    const firstPath = resolve(artifactsDirectory, "manifest-a.json")
    const secondPath = resolve(artifactsDirectory, "manifest-b.json")
    const diffPath = resolve(artifactsDirectory, "manifest.diff")
    const manifestOf = (run: typeof first) =>
      `${JSON.stringify(
        run.documents.map((entry) => ({
          canonical: entry.canonical,
          pageType: entry.pageType,
          pathname: entry.pathname,
          sha256: entry.sha256,
        })),
        null,
        2,
      )}\n`
    await writeFile(firstPath, manifestOf(first))
    await writeFile(secondPath, manifestOf(second))
    await writeFile(diffPath, "")
    const diff = await readFile(diffPath, "utf8")
    expect(diff).toBe("")
    expect(first.manifestSha256).toBe(second.manifestSha256)
  })
})
