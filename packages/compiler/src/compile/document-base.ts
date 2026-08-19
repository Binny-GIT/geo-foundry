import type { PageDocument } from "@geo/schema"

import { buildSeo } from "../seo/metadata.js"
import { canonicalUrlOf } from "../seo/urls.js"
import { requireUtcInstant, type CompileSite } from "./snapshot.js"

export type PageClock = { readonly now: string }

/** Pathname -> schema slug: lowercase, [a-z0-9-], single dashes, trimmed. */
export const slugOf = (pathname: string): string =>
  pathname
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "root"

export type DocumentBase = {
  readonly identity: { contentId: string; pageId: string; siteId: string }
  readonly schemaVersion: 1
  readonly metadata: { description: string; modifiedAt: string; publishedAt: string; title: string }
  readonly route: { canonicalUrl: string; locale: string; pathname: string }
  readonly seo: ReturnType<typeof buildSeo>
}

/**
 * Shared document base. Indexability is derived from the page type, never
 * passed in: redirect and not-found documents are structurally
 * non-indexable, and buildSeo enforces the same rule for any other caller.
 */
export const baseOf = (
  site: CompileSite,
  pathname: string,
  title: string,
  description: string,
  pageId: string,
  contentId: string,
  clock: PageClock,
  seoOptions: {
    readonly imageUrl?: string
    readonly openGraphType: "article" | "website"
    readonly pageType: PageDocument["pageType"]
  },
): DocumentBase => {
  requireUtcInstant(clock.now, "clock.now")
  const canonicalUrl = canonicalUrlOf(site, pathname)
  return {
    identity: { contentId, pageId, siteId: site.siteId },
    schemaVersion: 1 as const,
    metadata: { description, modifiedAt: clock.now, publishedAt: clock.now, title },
    route: { canonicalUrl, locale: site.locale, pathname },
    seo: buildSeo({
      canonicalUrl,
      description,
      ...(seoOptions.imageUrl === undefined ? {} : { imageUrl: seoOptions.imageUrl }),
      openGraphType: seoOptions.openGraphType,
      pageType: seoOptions.pageType,
      robots: {
        follow: true,
        index: seoOptions.pageType !== "redirect" && seoOptions.pageType !== "not-found",
      },
      title,
    }),
  }
}
