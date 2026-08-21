import { describe, expect, it } from "vitest"

import {
  COMPILER_ERROR,
  buildRouteIndex,
  buildRoutingManifest,
  objectKeyOf,
  siteIdOfHost,
  type RouteIndexInput,
} from "../src/index.js"

const documents: RouteIndexInput["documents"] = [
  { pageType: "article", pathname: "/guides/release-gates" },
  { pageType: "article-list", pathname: "/articles" },
  { pageType: "category", pathname: "/guides" },
  { pageType: "not-found", pathname: "/not-found" },
]

const baseInput = (): RouteIndexInput => ({
  canonicalDomain: "site-a.test",
  documents,
  redirects: [{ fromPathname: "/old-guides", targetUrl: "/guides/release-gates" }],
  siteId: "site-a",
})

const expectCode = (act: () => unknown, code: string) =>
  expect(act).toThrowError(expect.objectContaining({ code }))

describe("route index", () => {
  it("keys every route by pathname with status and release object key", () => {
    const index = buildRouteIndex(baseInput())
    expect(index.routes.map((route) => [route.pathname, route.status])).toEqual([
      ["/articles", "active"],
      ["/guides", "active"],
      ["/guides/release-gates", "active"],
      ["/not-found", "not-found"],
      ["/old-guides", "redirect"],
    ])
    expect(index.routes[2]).toMatchObject({ objectKey: "pages/guides/release-gates.json" })
    expect(objectKeyOf("/")).toBe("pages/index.json")
    expect(index.schemaVersion).toBe(1)
  })

  it("rejects two documents claiming one pathname", () => {
    expectCode(
      () =>
        buildRouteIndex({
          ...baseInput(),
          documents: [...documents, { pageType: "tag", pathname: "/articles" }],
        }),
      COMPILER_ERROR.ROUTE_PATH_COLLISION,
    )
  })

  it("emits deterministic terminal gone routes without page objects", () => {
    const index = buildRouteIndex({
      ...baseInput(),
      gonePathnames: ["/removed-z", "/removed-a"],
    })

    expect(index.routes.filter((route) => route.status === "gone")).toEqual([
      { pathname: "/removed-a", status: "gone" },
      { pathname: "/removed-z", status: "gone" },
    ])
  })

  it("rejects gone routes colliding with an emitted route", () => {
    expectCode(
      () => buildRouteIndex({ ...baseInput(), gonePathnames: ["/guides"] }),
      COMPILER_ERROR.ROUTE_PATH_COLLISION,
    )
  })

  it("rejects a redirect colliding with a document pathname", () => {
    expectCode(
      () =>
        buildRouteIndex({
          ...baseInput(),
          redirects: [{ fromPathname: "/guides", targetUrl: "/articles" }],
        }),
      COMPILER_ERROR.ROUTE_PATH_COLLISION,
    )
  })

  it("rejects redirect chains and loops (single hop only)", () => {
    expectCode(
      () =>
        buildRouteIndex({
          ...baseInput(),
          redirects: [
            { fromPathname: "/old-guides", targetUrl: "/older-guides" },
            { fromPathname: "/older-guides", targetUrl: "/guides/release-gates" },
          ],
        }),
      COMPILER_ERROR.ROUTE_REDIRECT_LOOP,
    )
    expectCode(
      () =>
        buildRouteIndex({
          ...baseInput(),
          redirects: [
            { fromPathname: "/old-a", targetUrl: "/old-b" },
            { fromPathname: "/old-b", targetUrl: "/old-a" },
          ],
        }),
      COMPILER_ERROR.ROUTE_REDIRECT_LOOP,
    )
  })

  it("rejects site-relative targets without an active route", () => {
    expectCode(
      () =>
        buildRouteIndex({
          ...baseInput(),
          gonePathnames: ["/gone-page"],
          redirects: [{ fromPathname: "/old-guides", targetUrl: "/gone-page" }],
        }),
      COMPILER_ERROR.ROUTE_TARGET_UNRESOLVED,
    )
    expectCode(
      () =>
        buildRouteIndex({
          ...baseInput(),
          redirects: [{ fromPathname: "/old-guides", targetUrl: "https://site-a.test/not-found" }],
        }),
      COMPILER_ERROR.ROUTE_TARGET_UNRESOLVED,
    )
  })

  it("rejects cross-site references to sibling site domains but keeps public external targets", () => {
    expectCode(
      () =>
        buildRouteIndex({
          ...baseInput(),
          knownDomains: ["site-b.test"],
          redirects: [{ fromPathname: "/old-guides", targetUrl: "https://site-b.test/x" }],
        }),
      COMPILER_ERROR.ROUTE_CROSS_SITE_REFERENCE,
    )
    const index = buildRouteIndex({
      ...baseInput(),
      knownDomains: ["site-b.test"],
      redirects: [{ fromPathname: "/old-guides", targetUrl: "https://public.example.com/x" }],
    })
    expect(index.routes.at(-1)?.status).toBe("redirect")
  })
})

describe("routing manifest", () => {
  it("maps every host alias to one site and marks the canonical host", () => {
    const manifest = buildRoutingManifest([
      {
        canonicalDomain: "site-a.test",
        hostAliases: ["www.site-a.test", "site-a-alt.test"],
        siteId: "site-a",
      },
      { canonicalDomain: "site-b.test", siteId: "site-b" },
    ])
    expect(manifest.hosts.map((host) => [host.host, host.siteId, host.canonical])).toEqual([
      ["site-a-alt.test", "site-a", false],
      ["site-a.test", "site-a", true],
      ["site-b.test", "site-b", true],
      ["www.site-a.test", "site-a", false],
    ])
    expect(siteIdOfHost(manifest, "www.site-a.test")?.siteId).toBe("site-a")
    expect(siteIdOfHost(manifest, "unknown.test")).toBeNull()
  })

  it("rejects hosts claimed by two sites and malformed hosts", () => {
    expectCode(
      () =>
        buildRoutingManifest([
          { canonicalDomain: "shared.test", siteId: "site-a" },
          { canonicalDomain: "shared.test", siteId: "site-b" },
        ]),
      COMPILER_ERROR.ROUTE_HOST_CONFLICT,
    )
    expectCode(
      () =>
        buildRoutingManifest([
          { canonicalDomain: "site-a.test", hostAliases: ["site-b.test"], siteId: "site-a" },
          { canonicalDomain: "site-b.test", siteId: "site-b" },
        ]),
      COMPILER_ERROR.ROUTE_HOST_CONFLICT,
    )
    expectCode(
      () => buildRoutingManifest([{ canonicalDomain: "https://site-a.test", siteId: "site-a" }]),
      COMPILER_ERROR.ROUTE_HOST_INVALID,
    )
  })
})
