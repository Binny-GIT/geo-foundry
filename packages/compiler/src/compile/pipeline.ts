import type { PageDocument } from "@geo/schema"

import { canonicalJson, sha256Hex } from "../canonical.js"
import { COMPILER_ERROR, CompilerError } from "./errors.js"
import { compileArticle, compileListingPage, listingItemOf } from "./pages.js"
import { compileNotFoundPage, compileRedirectPage } from "./special-pages.js"
import { type CompileEdition, type CompileSite, requireUtcInstant } from "./snapshot.js"
import { buildRouteIndex, type RouteIndex } from "../routes/route-index.js"
import { paginateListing } from "../routes/pagination.js"
import { buildSitemapXml } from "../sitemap/xml.js"

export type CompileRequest = {
  readonly clock: { readonly now: string }
  readonly compilerVersion: string
  /** Canonical domains of sibling sites; redirects must not point inside them. */
  readonly otherSiteDomains?: readonly string[]
  readonly editions: readonly CompileEdition[]
  readonly listings: {
    readonly articles: { readonly pageSize: number; readonly pathname: string }
    readonly categories: readonly {
      id: string
      pathname: string
      slug: string
      title: string
    }[]
    readonly tags: readonly { id: string; pathname: string; slug: string; title: string }[]
  }
  /** Release-scoped related links: only emitted when explicitly supplied. */
  readonly relatedLinksByEdition?: Readonly<
    Record<
      string,
      readonly {
        description: string
        pageId: string
        pathname: string
        title: string
      }[]
    >
  >
  readonly notFound: { readonly pathname: string }
  readonly redirects: readonly { fromPathname: string; targetUrl: string }[]
  readonly site: CompileSite
}

export type CompiledDocument = {
  readonly canonical: string
  readonly pageType: string
  readonly pathname: string
  readonly sha256: string
}

export type CompileOutput = {
  readonly compilerVersion: string
  readonly documents: readonly CompiledDocument[]
  readonly manifestSha256: string
  /** Every route of the site keyed by pathname, ready for CAS publication. */
  readonly routeIndex: RouteIndex
  readonly sitemap: string
}

type EmittedDocument = {
  readonly canonical: string
  readonly indexed: boolean
  readonly modifiedAt?: string
  readonly pageType: PageDocument["pageType"]
  readonly pathname: string
  readonly sha256: string
}

/**
 * Pure site compilation: immutable snapshots in, canonical PageDocument v1
 * JSON out plus the site's route index and sitemap. Identical input always
 * yields byte-identical output regardless of array order - listings sort
 * and paginate deterministically, documents sort by pathname, and every
 * timestamp must be a UTC instant. No clock, randomness, network, or
 * database access happens here; the caller injects both.
 */
export const compileSite = async (request: CompileRequest): Promise<CompileOutput> => {
  requireUtcInstant(request.clock.now, "clock.now")
  const { site, clock } = request
  const documents: EmittedDocument[] = []

  const editionsByPathname = new Map<string, CompileEdition>()
  for (const edition of request.editions) {
    if (editionsByPathname.has(edition.urlPathname)) {
      throw new CompilerError(
        COMPILER_ERROR.PATH_DUPLICATE,
        `two editions claim pathname ${edition.urlPathname}`,
      )
    }
    editionsByPathname.set(edition.urlPathname, edition)
  }
  const editions = [...request.editions].sort((left, right) =>
    left.urlPathname.localeCompare(right.urlPathname),
  )

  const push = async (
    pathname: string,
    pageType: PageDocument["pageType"],
    indexed: boolean,
    document: unknown,
  ): Promise<void> => {
    const canonical = canonicalJson(document)
    const metadata = (document as { metadata?: { modifiedAt?: string } }).metadata
    documents.push({
      canonical,
      indexed,
      ...(metadata?.modifiedAt === undefined ? {} : { modifiedAt: metadata.modifiedAt }),
      pageType,
      pathname,
      sha256: await sha256Hex(canonical),
    })
  }

  for (const edition of editions) {
    const related = request.relatedLinksByEdition?.[String(edition.editionId)]
    await push(
      edition.urlPathname,
      "article",
      true,
      await compileArticle({
        clock,
        edition,
        ...(related === undefined ? {} : { relatedPages: related }),
        site,
      }),
    )
  }

  const emitListing = async (input: {
    readonly kind: "article-list" | "category" | "tag"
    readonly items: readonly ReturnType<typeof listingItemOf>[]
    readonly pathname: string
    readonly title: string
  }): Promise<void> => {
    const pages = paginateListing({
      basePathname: input.pathname,
      items: input.items,
      pageSize: request.listings.articles.pageSize,
    })
    for (const page of pages) {
      await push(
        page.pathname,
        input.kind,
        true,
        await compileListingPage({
          clock,
          items: page.items,
          kind: input.kind,
          pagination: {
            page: page.page,
            pageSize: request.listings.articles.pageSize,
            ...(page.nextPathname === undefined ? {} : { nextPathname: page.nextPathname }),
            ...(page.previousPathname === undefined
              ? {}
              : { previousPathname: page.previousPathname }),
            totalItems: page.totalItems,
            totalPages: page.pageCount,
          },
          pathname: page.pathname,
          site,
          title: input.title,
        }),
      )
    }
  }

  await emitListing({
    items: editions.map(listingItemOf),
    kind: "article-list",
    pathname: request.listings.articles.pathname,
    title: "Articles",
  })

  for (const category of [...request.listings.categories].sort((left, right) =>
    left.pathname.localeCompare(right.pathname),
  )) {
    await emitListing({
      items: editions
        .filter((edition) => edition.categories.includes(category.slug))
        .map(listingItemOf),
      kind: "category",
      pathname: category.pathname,
      title: category.title,
    })
  }

  for (const tag of [...request.listings.tags].sort((left, right) =>
    left.pathname.localeCompare(right.pathname),
  )) {
    await emitListing({
      items: editions.filter((edition) => edition.tags.includes(tag.slug)).map(listingItemOf),
      kind: "tag",
      pathname: tag.pathname,
      title: tag.title,
    })
  }

  for (const redirect of [...request.redirects].sort((left, right) =>
    left.fromPathname.localeCompare(right.fromPathname),
  )) {
    await push(
      redirect.fromPathname,
      "redirect",
      false,
      await compileRedirectPage({
        clock,
        fromPathname: redirect.fromPathname,
        site,
        targetUrl: redirect.targetUrl,
      }),
    )
  }

  await push(
    request.notFound.pathname,
    "not-found",
    false,
    await compileNotFoundPage({ clock, pathname: request.notFound.pathname, site }),
  )

  documents.sort((left, right) => left.pathname.localeCompare(right.pathname))
  const routeIndex = buildRouteIndex({
    canonicalDomain: site.canonicalDomain,
    documents: documents.map((document) => ({
      pageType: document.pageType,
      pathname: document.pathname,
    })),
    ...(request.otherSiteDomains === undefined ? {} : { knownDomains: request.otherSiteDomains }),
    redirects: request.redirects,
    siteId: site.siteId,
  })
  const sitemap = buildSitemapXml({
    canonicalDomain: site.canonicalDomain,
    urls: documents
      .filter((document) => document.indexed)
      .map((document) => ({
        ...(document.modifiedAt === undefined ? {} : { lastmod: document.modifiedAt }),
        pathname: document.pathname,
      })),
  })
  const manifest = canonicalJson(
    documents.map((document) => ({
      pageType: document.pageType,
      pathname: document.pathname,
      sha256: document.sha256,
    })),
  )
  return {
    compilerVersion: request.compilerVersion,
    documents: documents.map((document) => ({
      canonical: document.canonical,
      pageType: document.pageType,
      pathname: document.pathname,
      sha256: document.sha256,
    })),
    manifestSha256: await sha256Hex(manifest),
    routeIndex,
    sitemap,
  }
}
