import { canonicalJson, sha256Hex } from "../canonical.js"
import { COMPILER_ERROR, CompilerError } from "./errors.js"
import { compileArticle, compileListingPage, listingItemOf } from "./pages.js"
import { compileNotFoundPage, compileRedirectPage } from "./special-pages.js"
import { type CompileEdition, type CompileSite, requireUtcInstant } from "./snapshot.js"

export type CompileRequest = {
  readonly clock: { readonly now: string }
  readonly compilerVersion: string
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
}

/**
 * Pure site compilation: immutable snapshots in, canonical PageDocument v1
 * JSON out. Identical input always yields byte-identical output regardless
 * of array order - listings sort, documents sort by pathname, and every
 * timestamp must be a UTC instant. No clock, randomness, network, or
 * database access happens here; the caller injects both.
 */
export const compileSite = async (request: CompileRequest): Promise<CompileOutput> => {
  requireUtcInstant(request.clock.now, "clock.now")
  const { site, clock } = request
  const documents: CompiledDocument[] = []

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

  const push = async (pathname: string, pageType: string, document: unknown) => {
    const canonical = canonicalJson(document)
    documents.push({ canonical, pageType, pathname, sha256: await sha256Hex(canonical) })
  }

  for (const edition of editions) {
    const related = request.relatedLinksByEdition?.[String(edition.editionId)]
    const article = await compileArticle({
      clock,
      edition,
      ...(related === undefined ? {} : { relatedPages: related }),
      site,
    })
    await push(edition.urlPathname, "article", article)
  }

  const totalItems = editions.length
  const totalPages = Math.max(1, Math.ceil(totalItems / request.listings.articles.pageSize))
  await push(
    request.listings.articles.pathname,
    "article-list",
    await compileListingPage({
      clock,
      items: editions.map(listingItemOf),
      kind: "article-list",
      pagination: {
        page: 1,
        pageSize: request.listings.articles.pageSize,
        totalItems,
        totalPages,
      },
      pathname: request.listings.articles.pathname,
      site,
      title: "Articles",
    }),
  )

  for (const category of [...request.listings.categories].sort((left, right) =>
    left.pathname.localeCompare(right.pathname),
  )) {
    await push(
      category.pathname,
      "category",
      await compileListingPage({
        clock,
        items: editions
          .filter((edition) => edition.categories.includes(category.slug))
          .map(listingItemOf),
        kind: "category",
        pathname: category.pathname,
        site,
        title: category.title,
      }),
    )
  }

  for (const tag of [...request.listings.tags].sort((left, right) =>
    left.pathname.localeCompare(right.pathname),
  )) {
    await push(
      tag.pathname,
      "tag",
      await compileListingPage({
        clock,
        items: editions.filter((edition) => edition.tags.includes(tag.slug)).map(listingItemOf),
        kind: "tag",
        pathname: tag.pathname,
        site,
        title: tag.title,
      }),
    )
  }

  for (const redirect of [...request.redirects].sort((left, right) =>
    left.fromPathname.localeCompare(right.fromPathname),
  )) {
    await push(
      redirect.fromPathname,
      "redirect",
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
    await compileNotFoundPage({ clock, pathname: request.notFound.pathname, site }),
  )

  documents.sort((left, right) => left.pathname.localeCompare(right.pathname))
  const manifest = canonicalJson(
    documents.map((document) => ({
      pageType: document.pageType,
      pathname: document.pathname,
      sha256: document.sha256,
    })),
  )
  return {
    compilerVersion: request.compilerVersion,
    documents,
    manifestSha256: await sha256Hex(manifest),
  }
}
