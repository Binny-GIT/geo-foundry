import {
  ArticleListPageSchema,
  ArticlePageSchema,
  CategoryPageSchema,
  NotFoundPageSchema,
  RedirectPageSchema,
  TagPageSchema,
} from "../page-document/v1/index.js"
import { validBlockFixtures } from "./blocks.js"

function documentFields(pageId: string, pathname: string, title: string) {
  return {
    schemaVersion: 1,
    identity: { pageId, siteId: "site-a", contentId: `content-${pageId}` },
    route: {
      locale: "en-US",
      pathname,
      canonicalUrl: `https://site-a.test${pathname}`,
    },
    metadata: {
      title,
      description: `${title} canonical fixture.`,
      publishedAt: "2026-08-17T10:00:00.000Z",
      modifiedAt: "2026-08-17T11:00:00.000Z",
    },
    seo: {
      title,
      description: `${title} canonical fixture.`,
      robots: { index: true, follow: true },
      openGraph: { type: "website", title, description: `${title} canonical fixture.` },
    },
  }
}

const breadcrumbsFor = (pathname: string) => {
  const segments = pathname.split("/").filter(Boolean)
  return [
    { title: "Home", pathname: "/" },
    ...segments.slice(0, -1).map((segment, index) => ({
      pathname: `/${segments.slice(0, index + 1).join("/")}`,
      title: segment,
    })),
  ]
}

const relatedPage = {
  pageId: "page-related",
  title: "Related guide",
  pathname: "/guides/related",
  description: "A related canonical page.",
}

const contentFields = {
  hero: { title: "Geo Foundry", summary: "Portable page contracts." },
  author: { id: "author-mark", name: "Mark", url: "https://site-a.test/authors/mark" },
  citations: [
    {
      id: "citation-prd",
      title: "Product requirements",
      url: "https://site-a.test/sources/prd",
    },
  ],
  entities: [
    {
      id: "entity-geo-foundry",
      type: "SoftwareApplication",
      name: "Geo Foundry",
      url: "https://site-a.test/",
    },
  ],
  relatedPages: [relatedPage],
  extensions: { "geo.example/editorial-score": 0.91 },
}

export const articlePageFixture = ArticlePageSchema.parse({
  pageType: "article",
  ...documentFields("page-article", "/guides/article", "Article"),
  ...contentFields,
  breadcrumbs: breadcrumbsFor("/guides/article"),
  structuredData: [
    {
      type: "Article",
      headline: "Article",
      url: "https://site-a.test/guides/article",
      author: { name: "Mark", url: "https://site-a.test/authors/mark" },
    },
  ],
  body: validBlockFixtures,
})

export const articleListPageFixture = ArticleListPageSchema.parse({
  pageType: "article-list",
  ...documentFields("page-article-list", "/articles", "Article list"),
  ...contentFields,
  breadcrumbs: breadcrumbsFor("/articles"),
  structuredData: [
    { type: "CollectionPage", name: "Article list", url: "https://site-a.test/articles" },
  ],
  body: [{ type: "paragraph", text: "Browse all articles." }],
  items: [relatedPage],
  pagination: { page: 1, pageSize: 20, totalPages: 1, totalItems: 1 },
})

export const categoryPageFixture = CategoryPageSchema.parse({
  pageType: "category",
  ...documentFields("page-category", "/guides", "Guides"),
  ...contentFields,
  breadcrumbs: breadcrumbsFor("/guides"),
  structuredData: [{ type: "CollectionPage", name: "Guides", url: "https://site-a.test/guides" }],
  body: [{ type: "paragraph", text: "Browse the guides category." }],
  items: [relatedPage],
})

export const tagPageFixture = TagPageSchema.parse({
  pageType: "tag",
  ...documentFields("page-tag", "/tags/contracts", "Contracts"),
  ...contentFields,
  breadcrumbs: breadcrumbsFor("/tags/contracts"),
  structuredData: [
    { type: "CollectionPage", name: "Contracts", url: "https://site-a.test/tags/contracts" },
  ],
  body: [{ type: "paragraph", text: "Pages tagged with contracts." }],
  items: [relatedPage],
})

export const redirectPageFixture = RedirectPageSchema.parse({
  pageType: "redirect",
  ...documentFields("page-redirect", "/old-guide", "Moved guide"),
  seo: {
    title: "Moved guide",
    description: "Moved guide canonical fixture.",
    robots: { index: false, follow: true },
  },
  redirect: { statusCode: 301, targetUrl: "https://site-a.test/guides/article" },
})

export const notFoundPageFixture = NotFoundPageSchema.parse({
  pageType: "not-found",
  ...documentFields("page-not-found", "/404", "Page not found"),
  ...contentFields,
  breadcrumbs: breadcrumbsFor("/404"),
  seo: {
    title: "Page not found",
    description: "Page not found canonical fixture.",
    robots: { index: false, follow: false },
  },
  structuredData: [{ type: "WebPage", name: "Page not found", url: "https://site-a.test/404" }],
  body: [{ type: "callout", tone: "warning", text: "The requested page was not found." }],
})

export const canonicalPageFixtures = [
  articlePageFixture,
  articleListPageFixture,
  categoryPageFixture,
  tagPageFixture,
  redirectPageFixture,
  notFoundPageFixture,
] as const
