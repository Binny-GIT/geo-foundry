import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { compileSite, type CompileOutput, type CompileRequest } from "@geo/compiler"

import {
  buildReleaseDirectory,
  planRelease,
  verifyReleaseDirectory,
  type ReleaseBuildInput,
} from "../src/index.js"
import { ReleaseBuildError, RELEASE_BUILD_ERROR_CODE } from "../src/errors.js"

let cachedCompileOutput: CompileOutput | null = null
const compileFixture = async (): Promise<CompileOutput> => {
  if (cachedCompileOutput !== null) {
    return cachedCompileOutput
  }
  cachedCompileOutput = await compileSite({
    clock: { now: "2026-08-19T00:00:00Z" },
    compilerVersion: "1.0.0",
    editions: [
      {
        assessmentInputHash: "a".repeat(64),
        assessmentState: "passed",
        author: { id: "author-ada", name: "Ada Chen", url: "https://site-a.test/authors/ada-chen" },
        body: [{ blockType: "paragraph", text: "Body." }],
        categories: ["guides"],
        contentId: 12,
        editionId: 101,
        media: [],
        modifiedAt: "2026-08-17T11:00:00Z",
        publishedAt: "2026-08-17T10:00:00Z",
        siteId: "site-a",
        status: "approved",
        summary: "Summary.",
        tags: ["contracts"],
        title: "Deterministic release gates",
        urlPathname: "/guides/release-gates",
        urlStatus: "active",
      },
    ],
    listings: {
      articles: { pathname: "/articles", pageSize: 10 },
      categories: [{ id: "cat-guides", pathname: "/guides", slug: "guides", title: "Guides" }],
      tags: [],
    },
    notFound: { pathname: "/not-found" },
    redirects: [],
    site: {
      canonicalDomain: "site-a.test",
      locale: "en-US",
      name: "Site A",
      organization: { logoUrl: "/media/logo.svg", name: "Site A Media" },
      seoDefaults: { description: "Site A default description.", title: "Site A" },
      siteId: "site-a",
      timezone: "UTC",
    },
  } satisfies CompileRequest)
  return cachedCompileOutput
}

const inputOf = (
  compileOutput: CompileOutput,
  over: Partial<ReleaseBuildInput> = {},
): ReleaseBuildInput => ({
  compileOutput,
  createdAt: "2026-08-19T00:00:00.000Z",
  mediaObjects: [
    {
      body: new TextEncoder().encode("logo-bytes"),
      contentType: "image/svg+xml",
      path: "media/logo.svg",
    },
  ],
  releaseId: "release-0001",
  routingManifest: {
    hosts: [{ canonical: true, host: "site-a.test", siteId: "site-a" }],
    schemaVersion: 1,
  },
  siteId: "site-a",
  sourceVersionIds: ["edition-101-version-3", "url-9-version-1"],
  ...over,
})

const stagingRoots: string[] = []

afterAll(async () => {
  await Promise.all(stagingRoots.map((root) => readdir(root).catch(() => undefined)))
})

const tempRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "geo-release-"))
  stagingRoots.push(root)
  return root
}

const directoryTree = async (root: string, prefix = ""): Promise<Record<string, string>> => {
  const entries = await readdir(join(root, prefix), { withFileTypes: true })
  const files: Record<string, string> = {}
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      Object.assign(files, await directoryTree(root, relative))
    } else {
      files[relative] = (await readFile(join(root, relative))).toString("base64")
    }
  }
  return files
}

const expectCode = async (act: () => unknown, code: string) => {
  try {
    await act()
  } catch (error) {
    await expect(Promise.reject(error)).rejects.toMatchObject({ code })
    return
  }
  throw new Error(`expected a typed failure with code ${code}`)
}

describe("release build and verify", () => {
  let compileOutput: CompileOutput

  beforeAll(async () => {
    compileOutput = await compileFixture()
  })

  it("builds two byte-identical release directories from fixed input", async () => {
    const firstRoot = await tempRoot()
    const secondRoot = await tempRoot()
    const first = await buildReleaseDirectory({ ...inputOf(compileOutput), stagingRoot: firstRoot })
    const second = await buildReleaseDirectory({
      ...inputOf(compileOutput),
      stagingRoot: secondRoot,
    })
    expect(first.state).toBe("built")
    const firstTree = await directoryTree(first.releaseRoot)
    const secondTree = await directoryTree(second.releaseRoot)
    expect(Object.keys(firstTree)).toEqual(Object.keys(secondTree))
    expect(firstTree).toEqual(secondTree)
    expect(Object.keys(firstTree)).toContain("pages/guides/release-gates.json")
    expect(Object.keys(firstTree)).toContain("routes.json")
    expect(Object.keys(firstTree)).toContain("sitemap.xml")
    expect(Object.keys(firstTree)).toContain("routing-candidate.json")
    expect(Object.keys(firstTree)).toContain("media/logo.svg")
    expect(Object.keys(firstTree)).toContain("manifest.json")
    for (const stagingRoot of [firstRoot, secondRoot]) {
      expect(
        JSON.parse(await readFile(join(stagingRoot, "artifact-manifest.json"), "utf8")).objects,
      ).toHaveLength(8)
      expect(
        JSON.parse(await readFile(join(stagingRoot, "object-inventory.json"), "utf8")),
      ).toHaveLength(9)
    }
  })

  it("verifies every object and hash against the manifest", async () => {
    const root = await tempRoot()
    const built = await buildReleaseDirectory({ ...inputOf(compileOutput), stagingRoot: root })
    const verified = await verifyReleaseDirectory({ releaseRoot: built.releaseRoot })
    expect(verified.state).toBe("validated")
    expect(verified.manifest.compilerVersion).toBe("1.0.0")
    expect(verified.manifest.sourceVersionIds).toEqual(["edition-101-version-3", "url-9-version-1"])
    expect(verified.objects.map((object) => object.path).sort()).toContain("sitemap.xml")
  })

  it("fails verification on tampered bytes, missing objects, and extra unlisted files", async () => {
    const root = await tempRoot()
    const built = await buildReleaseDirectory({ ...inputOf(compileOutput), stagingRoot: root })
    const pagePath = join(built.releaseRoot, "pages/guides/release-gates.json")
    const original = await readFile(pagePath)

    await writeFile(pagePath, Buffer.from(`${original.toString("utf8")} `))
    await expectCode(
      () => verifyReleaseDirectory({ releaseRoot: built.releaseRoot }),
      RELEASE_BUILD_ERROR_CODE.RELEASE_OBJECT_BYTES_MISMATCH,
    )
    const flipped = Buffer.from(original)
    flipped[flipped.length - 1] = flipped[flipped.length - 1] === 0x7d ? 0x7e : 0x7d
    await writeFile(pagePath, flipped)
    await expectCode(
      () => verifyReleaseDirectory({ releaseRoot: built.releaseRoot }),
      RELEASE_BUILD_ERROR_CODE.RELEASE_OBJECT_SHA256_MISMATCH,
    )
    await writeFile(pagePath, original)

    await writeFile(join(built.releaseRoot, "smuggled.txt"), "extra")
    await expectCode(
      () => verifyReleaseDirectory({ releaseRoot: built.releaseRoot }),
      RELEASE_BUILD_ERROR_CODE.RELEASE_OBJECT_EXTRA,
    )

    const { rm } = await import("node:fs/promises")
    await rm(join(built.releaseRoot, "routes.json"))
    await expectCode(
      () => verifyReleaseDirectory({ releaseRoot: built.releaseRoot }),
      RELEASE_BUILD_ERROR_CODE.RELEASE_OBJECT_MISSING,
    )
  })

  it("treats an interrupted build (no manifest.json) as never validated", async () => {
    const root = await tempRoot()
    const plan = planRelease(inputOf(compileOutput))
    expect(plan.objects.length).toBeGreaterThan(0)
    const partialRoot = join(root, "sites/site-a/releases/release-0001")
    for (const object of plan.objects.slice(0, 2)) {
      const { mkdir } = await import("node:fs/promises")
      const { dirname, join: joinPath } = await import("node:path")
      await mkdir(joinPath(partialRoot, dirname(object.path)), { recursive: true })
      await writeFile(joinPath(partialRoot, object.path), object.body)
    }
    await expectCode(
      () => verifyReleaseDirectory({ releaseRoot: partialRoot }),
      RELEASE_BUILD_ERROR_CODE.RELEASE_OBJECT_MISSING,
    )
  })

  it("rejects unsafe media paths, bad compiler/schema versions, and wrong content types", async () => {
    await expectCode(
      () =>
        planRelease(
          inputOf(compileOutput, {
            mediaObjects: [
              {
                body: new TextEncoder().encode("x"),
                contentType: "image/png",
                path: "../escape.png",
              },
            ],
          }),
        ),
      RELEASE_BUILD_ERROR_CODE.RELEASE_PATH_UNSAFE,
    )
    await expectCode(
      () =>
        planRelease(
          inputOf(compileOutput, {
            compileOutput: { ...compileOutput, compilerVersion: "geo-compiler-1" },
          }),
        ),
      RELEASE_BUILD_ERROR_CODE.RELEASE_COMPILER_UNSUPPORTED,
    )
    await expectCode(
      () =>
        planRelease(
          inputOf(compileOutput, {
            compileOutput: {
              ...compileOutput,
              routeIndex: { ...compileOutput.routeIndex, schemaVersion: 2 as never },
            },
          }),
        ),
      RELEASE_BUILD_ERROR_CODE.RELEASE_SCHEMA_UNSUPPORTED,
    )
    const root = await tempRoot()
    const badType = inputOf(compileOutput, {
      mediaObjects: [
        { body: new TextEncoder().encode("x"), contentType: "text/html", path: "media/logo.svg" },
      ],
    })
    const built = await buildReleaseDirectory({ ...badType, stagingRoot: root })
    await expectCode(
      () => verifyReleaseDirectory({ releaseRoot: built.releaseRoot }),
      RELEASE_BUILD_ERROR_CODE.RELEASE_OBJECT_CONTENT_TYPE_MISMATCH,
    )
  })

  it("rejects duplicate object paths and empty source versions at planning time", () => {
    expect(() =>
      planRelease(
        inputOf(compileOutput, {
          mediaObjects: [
            {
              body: new TextEncoder().encode("a"),
              contentType: "image/webp",
              path: "media/x.webp",
            },
            {
              body: new TextEncoder().encode("b"),
              contentType: "image/webp",
              path: "media/x.webp",
            },
          ],
        }),
      ),
    ).toThrowError(ReleaseBuildError)
    expect(() => planRelease(inputOf(compileOutput, { sourceVersionIds: [] }))).toThrowError(
      expect.objectContaining({ code: RELEASE_BUILD_ERROR_CODE.RELEASE_MANIFEST_INVALID }),
    )
  })

  it("builds and verifies a second site release independently", async () => {
    const siteBRequest: CompileRequest = {
      clock: { now: "2026-08-19T00:00:00Z" },
      compilerVersion: "1.0.0",
      editions: [
        {
          assessmentInputHash: "b".repeat(64),
          assessmentState: "passed",
          author: {
            id: "author-lin",
            name: "Lin Zhao",
            url: "https://site-b.test/authors/lin-zhao",
          },
          body: [{ blockType: "paragraph", text: "Site B body." }],
          categories: ["news"],
          contentId: 21,
          editionId: 201,
          media: [],
          modifiedAt: "2026-08-18T09:30:00Z",
          publishedAt: "2026-08-18T09:00:00Z",
          siteId: "site-b",
          status: "approved",
          summary: "Site B summary.",
          tags: [],
          title: "Site B article",
          urlPathname: "/news/first",
          urlStatus: "active",
        },
      ],
      listings: {
        articles: { pathname: "/articles", pageSize: 10 },
        categories: [{ id: "cat-news", pathname: "/news", slug: "news", title: "News" }],
        tags: [],
      },
      notFound: { pathname: "/not-found" },
      redirects: [],
      site: {
        canonicalDomain: "site-b.test",
        locale: "en-US",
        name: "Site B",
        organization: { name: "Site B Media" },
        seoDefaults: { description: "Site B default description.", title: "Site B" },
        siteId: "site-b",
        timezone: "UTC",
      },
    }
    const siteBOutput = await compileSite(siteBRequest)
    const root = await tempRoot()
    const built = await buildReleaseDirectory({
      compileOutput: siteBOutput,
      createdAt: "2026-08-19T00:00:00.000Z",
      releaseId: "release-0002",
      routingManifest: {
        hosts: [
          { canonical: true, host: "site-a.test", siteId: "site-a" },
          { canonical: true, host: "site-b.test", siteId: "site-b" },
        ],
        schemaVersion: 1,
      },
      siteId: "site-b",
      sourceVersionIds: ["edition-201-version-1"],
      stagingRoot: root,
    })
    const verified = await verifyReleaseDirectory({ releaseRoot: built.releaseRoot })
    expect(verified.state).toBe("validated")
    expect(verified.manifest.siteId).toBe("site-b")
    const siteAVerified = await verifyReleaseDirectory({
      releaseRoot: join(await firstSiteARoot(), "sites/site-a/releases/release-0001"),
    })
    expect(siteAVerified.manifest.siteId).toBe("site-a")
    expect(siteAVerified.manifest.releaseId).not.toBe(verified.manifest.releaseId)
  })
})

let cachedSiteARoot: string | null = null
const firstSiteARoot = async (): Promise<string> => {
  if (cachedSiteARoot === null) {
    cachedSiteARoot = await tempRoot()
    await buildReleaseDirectory({
      ...inputOf(await compileFixture()),
      stagingRoot: cachedSiteARoot,
    })
  }
  return cachedSiteARoot
}
