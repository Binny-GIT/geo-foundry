import {
  ArticleListPageSchema,
  ArticlePageSchema,
  CategoryPageSchema,
  NotFoundPageSchema,
  RedirectPageSchema,
  TagPageSchema,
  type ArticlePage,
  type NotFoundPage,
  type PageDocument,
  type RedirectPage,
} from "@geo/schema"

import { compileBlocks } from "./blocks.js"
import { CompilerError, COMPILER_ERROR } from "./errors.js"
import {
  assertEditionCompilable,
  requireUtcInstant,
  type CompileEdition,
  type CompileSite,
} from "./snapshot.js"

export type PageClock = { readonly now: string }

/** Pathname -> schema slug: lowercase, [a-z0-9-], single dashes, trimmed. */
const slugOf = (pathname: string): string =>
  pathname
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "root"

type DocumentBase = {
  readonly identity: { contentId: string; pageId: string; siteId: string }
  readonly schemaVersion: 1
  readonly metadata: { description: string; modifiedAt: string; publishedAt: string; title: string }
  readonly route: { canonicalUrl: string; locale: string; pathname: string }
  readonly seo: {
    readonly description: string
    readonly openGraph: { description: string; title: string; type: "website" }
    readonly robots: { follow: boolean; index: boolean }
    readonly title: string
  }
}

const baseOf = (
  site: CompileSite,
  pathname: string,
  title: string,
  description: string,
  pageId: string,
  contentId: string,
  clock: PageClock,
  indexed: boolean,
): DocumentBase => {
  requireUtcInstant(clock.now, "clock.now")
  return {
    identity: { contentId, pageId, siteId: site.siteId },
    schemaVersion: 1 as const,
    metadata: { description, modifiedAt: clock.now, publishedAt: clock.now, title },
    route: {
      canonicalUrl: `https://${site.canonicalDomain}${pathname}`,
      locale: site.locale,
      pathname,
    },
    seo: {
      description,
      openGraph: { description, title, type: "website" },
      robots: { follow: true, index: indexed },
      title,
    },
  }
}

const listingItemOf = (edition: CompileEdition) => ({
  description: edition.summary,
  pageId: `page-${edition.editionId}`,
  pathname: edition.urlPathname,
  title: edition.title,
})

/** Article page from one immutable edition snapshot. */
export const compileArticle = async (input: {
  readonly clock: PageClock
  readonly edition: CompileEdition
  readonly relatedPages?: readonly {
    description: string
    pageId: string
    pathname: string
    title: string
  }[]
  readonly site: CompileSite
}): Promise<ArticlePage> => {
  assertEditionCompilable(input.edition)
  const { edition, site } = input
  const base = baseOf(
    site,
    edition.urlPathname,
    edition.title,
    edition.summary,
    `page-${edition.editionId}`,
    `content-${edition.contentId}`,
    input.clock,
    true,
  )
  const parent = edition.categories[0]
  return ArticlePageSchema.parse({
    ...base,
    author: edition.author,
    body: compileBlocks(edition.body, edition),
    breadcrumbs: [
      { pathname: "/", title: site.name },
      ...(parent === undefined
        ? []
        : [{ pathname: `/${parent}`, title: parent.charAt(0).toUpperCase() + parent.slice(1) }]),
      { pathname: edition.urlPathname, title: edition.title },
    ],
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
    seo: { ...base.seo, description: edition.summary, title: edition.title },
  })
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
  const document = {
    ...baseOf(
      input.site,
      input.pathname,
      input.title,
      input.site.seoDefaults.description,
      `page-list-${slug}`,
      `list-${slug}`,
      input.clock,
      true,
    ),
    body: [{ text: `Browse ${input.title}.`, type: "paragraph" }],
    breadcrumbs: [
      { pathname: "/", title: input.site.name },
      { pathname: input.pathname, title: input.title },
    ],
    hero: { summary: input.site.seoDefaults.description, title: input.title },
    items: sortedItems,
    pageType: input.kind,
    pagination: input.pagination,
  }
  if (input.kind === "article-list") {
    return ArticleListPageSchema.parse(document)
  }
  if (input.kind === "category") {
    return CategoryPageSchema.parse(document)
  }
  return TagPageSchema.parse(document)
}

/** Single-hop 301 redirect page; never indexed. */
export const compileRedirectPage = async (input: {
  readonly clock: PageClock
  readonly fromPathname: string
  readonly site: CompileSite
  readonly targetUrl: string
}): Promise<RedirectPage> => {
  const slug = slugOf(input.fromPathname)
  const title = `Moved: ${input.fromPathname}`
  const base = baseOf(
    input.site,
    input.fromPathname,
    title,
    input.site.seoDefaults.description,
    `page-redirect-${slug}`,
    `redirect-${slug}`,
    input.clock,
    false,
  )
  return RedirectPageSchema.parse({
    ...base,
    pageType: "redirect" as const,
    redirect: { statusCode: 301, targetUrl: input.targetUrl },
    seo: { ...base.seo, robots: { follow: true, index: false }, title },
  })
}

/** Site-wide not-found page; never indexed. */
export const compileNotFoundPage = async (input: {
  readonly clock: PageClock
  readonly pathname: string
  readonly site: CompileSite
}): Promise<NotFoundPage> =>
  NotFoundPageSchema.parse({
    ...baseOf(
      input.site,
      input.pathname,
      "Page not found",
      input.site.seoDefaults.description,
      "page-not-found",
      "not-found",
      input.clock,
      false,
    ),
    body: [{ text: "The requested page could not be found.", type: "paragraph" }],
    breadcrumbs: [
      { pathname: "/", title: input.site.name },
      { pathname: input.pathname, title: "Page not found" },
    ],
    hero: { summary: input.site.seoDefaults.description, title: "Page not found" },
    pageType: "not-found" as const,
    seo: {
      description: input.site.seoDefaults.description,
      openGraph: {
        description: input.site.seoDefaults.description,
        title: "Page not found",
        type: "website" as const,
      },
      robots: { follow: true, index: false },
      title: "Page not found",
    },
  })

export { listingItemOf }
