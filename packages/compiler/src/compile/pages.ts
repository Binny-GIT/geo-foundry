import {
  ArticleListPageSchema,
  ArticlePageSchema,
  CategoryPageSchema,
  TagPageSchema,
  type ArticlePage,
  type PageDocument,
} from "@geo/schema"

import { compileBlocks } from "./blocks.js"
import { CompilerError, COMPILER_ERROR } from "./errors.js"
import { baseOf, slugOf, type PageClock } from "./document-base.js"
import { heroImageOf } from "./hero.js"
import { verifySeoConsistency } from "../seo/metadata.js"
import { buildArticleGraph, buildListingGraph } from "../structured-data/graph.js"
import {
  assertEditionCompilable,
  assertEditionOnCanonicalDomain,
  type CompileEdition,
  type CompileSite,
} from "./snapshot.js"

export type { PageClock }

/**
 * Breadcrumb trail derived from the article's own URL ancestry so every crumb
 * is the root, a strict path ancestor, or the current route.
 */
const articleBreadcrumbs = (input: {
  readonly listingTitles?: ReadonlyMap<string, string>
  readonly pathname: string
  readonly siteName: string
  readonly title: string
}) => {
  const segments = input.pathname.split("/").filter(Boolean)
  return [
    { pathname: "/", title: input.siteName },
    ...segments.slice(0, -1).map((segment, index) => {
      const pathname = `/${segments.slice(0, index + 1).join("/")}`
      return {
        pathname,
        title:
          input.listingTitles?.get(pathname) ??
          segment.charAt(0).toUpperCase() + segment.slice(1),
      }
    }),
    { pathname: input.pathname, title: input.title },
  ]
}

/** Article page from one immutable edition snapshot. */
export const compileArticle = async (input: {
  readonly clock: PageClock
  readonly edition: CompileEdition
  readonly listingTitles?: ReadonlyMap<string, string>
  readonly relatedPages?: readonly {
    description: string
    pageId: string
    pathname: string
    title: string
  }[]
  readonly site: CompileSite
}): Promise<ArticlePage> => {
  assertEditionCompilable(input.edition)
  assertEditionOnCanonicalDomain(input.site, input.edition)
  const { edition, site } = input
  const hero = heroImageOf(edition, site)
  const base = baseOf(
    site,
    edition.urlPathname,
    edition.title,
    edition.summary,
    `page-${edition.editionId}`,
    `content-${edition.contentId}`,
    input.clock,
    {
      ...(hero === undefined ? {} : { imageUrl: hero.url }),
      openGraphType: "article",
      pageType: "article",
    },
  )
  const breadcrumbs = articleBreadcrumbs({
    ...(input.listingTitles === undefined ? {} : { listingTitles: input.listingTitles }),
    pathname: edition.urlPathname,
    siteName: site.name,
    title: edition.title,
  })
  const document = ArticlePageSchema.parse({
    ...base,
    author: edition.author,
    body: compileBlocks(edition.body, edition),
    breadcrumbs,
    citations: edition.citations,
    entities: edition.entities,
    hero: { summary: edition.summary, title: edition.title },
    metadata: {
      description: edition.summary,
      modifiedAt: edition.modifiedAt,
      publishedAt: edition.publishedAt,
      title: edition.title,
    },
    pageType: "article" as const,
    relatedPages: input.relatedPages,
    structuredData: buildArticleGraph({
      articleKind: edition.articleKind ?? "article",
      ...(edition.author === undefined ? {} : { author: edition.author }),
      breadcrumbs,
      canonicalUrl: base.route.canonicalUrl,
      dateModified: edition.modifiedAt,
      datePublished: edition.publishedAt,
      description: edition.summary,
      ...(hero === undefined ? {} : { heroImage: hero }),
      site,
      title: edition.title,
    }),
  })
  verifySeoConsistency(document)
  return document
}

export type ListingKind = "article-list" | "category" | "tag"

/** Listing pages (article-list / category / tag) with stable item ordering. */
export const compileListingPage = async (input: {
  readonly clock: PageClock
  readonly items: readonly {
    description: string
    pageId: string
    pathname: string
    title: string
  }[]
  readonly kind: ListingKind
  readonly pagination?: { page: number; pageSize: number; totalItems: number; totalPages: number }
  readonly pathname: string
  readonly site: CompileSite
  readonly title: string
}): Promise<PageDocument> => {
  const seen = new Set<string>()
  const sortedItems = [...input.items].sort((left, right) =>
    left.pathname.localeCompare(right.pathname),
  )
  for (const item of sortedItems) {
    if (seen.has(item.pathname)) {
      throw new CompilerError(
        COMPILER_ERROR.PATH_DUPLICATE,
        `listing ${input.pathname} has duplicate item pathname ${item.pathname}`,
      )
    }
    seen.add(item.pathname)
  }
  const slug = slugOf(input.pathname)
  const description = input.site.seoDefaults.description
  const breadcrumbs = [
    { pathname: "/", title: input.site.name },
    { pathname: input.pathname, title: input.title },
  ]
  const base = baseOf(
    input.site,
    input.pathname,
    input.title,
    description,
    `page-list-${slug}`,
    `list-${slug}`,
    input.clock,
    { openGraphType: "website", pageType: input.kind },
  )
  const document = {
    ...base,
    body: [{ text: `Browse ${input.title}.`, type: "paragraph" }],
    breadcrumbs,
    hero: { summary: description, title: input.title },
    items: sortedItems,
    pageType: input.kind,
    pagination: input.pagination,
    structuredData: buildListingGraph({
      breadcrumbs,
      canonicalUrl: base.route.canonicalUrl,
      description,
      title: input.title,
    }),
  }
  if (input.kind === "article-list") {
    return ArticleListPageSchema.parse(document)
  }
  if (input.kind === "category") {
    return CategoryPageSchema.parse(document)
  }
  return TagPageSchema.parse(document)
}

const listingItemOf = (edition: CompileEdition) => ({
  description: edition.summary,
  pageId: `page-${edition.editionId}`,
  pathname: edition.urlPathname,
  title: edition.title,
})

export { listingItemOf }
