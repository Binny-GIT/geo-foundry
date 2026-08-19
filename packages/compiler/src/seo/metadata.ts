import type { PageDocument } from "@geo/schema"

import { COMPILER_ERROR, CompilerError } from "../compile/errors.js"

/** Page types that must never be indexed; their robots flags are fixed. */
const NEVER_INDEXABLE: readonly PageDocument["pageType"][] = ["redirect", "not-found"]

export type RobotsInput = { readonly follow: boolean; readonly index: boolean }

export type BuildSeoInput = {
  readonly canonicalUrl: string
  readonly description: string
  /** Absolute hero/asset URL; already validated by the caller. */
  readonly imageUrl?: string
  readonly openGraphType: "article" | "website"
  readonly pageType: PageDocument["pageType"]
  readonly robots: RobotsInput
  readonly title: string
}

export type BuiltSeo = {
  readonly title: string
  readonly description: string
  readonly robots: RobotsInput
  readonly openGraph: {
    readonly type: "article" | "website"
    readonly title: string
    readonly description: string
    readonly image?: string
  }
  readonly twitter: {
    readonly card: "summary" | "summary_large_image"
    readonly title: string
    readonly description: string
    readonly image?: string
  }
}

/**
 * Single source of SEO metadata. OpenGraph/Twitter values are always copied
 * from the visible title/description, so a host can never render metadata
 * that disagrees with the PageDocument. Non-indexable page types conflict
 * with index:true and fail typed instead of shipping a crawlable redirect.
 */
export const buildSeo = (input: BuildSeoInput): BuiltSeo => {
  if (NEVER_INDEXABLE.includes(input.pageType) && input.robots.index) {
    throw new CompilerError(
      COMPILER_ERROR.SEO_ROBOTS_CONFLICT,
      `${input.pageType} page ${input.canonicalUrl} must not be indexable`,
    )
  }
  const card = input.imageUrl === undefined ? "summary" : "summary_large_image"
  return {
    description: input.description,
    openGraph: {
      description: input.description,
      ...(input.imageUrl === undefined ? {} : { image: input.imageUrl }),
      title: input.title,
      type: input.openGraphType,
    },
    robots: { follow: input.robots.follow, index: input.robots.index },
    title: input.title,
    twitter: {
      card,
      description: input.description,
      ...(input.imageUrl === undefined ? {} : { image: input.imageUrl }),
      title: input.title,
    },
  }
}

type ConsistentPage = {
  readonly metadata?: {
    readonly description?: string | undefined
    readonly title?: string | undefined
  }
  readonly pageType: string
  readonly route?: { readonly canonicalUrl?: string | undefined }
  readonly seo?: {
    readonly description?: string | undefined
    readonly openGraph?:
      | { readonly description?: string | undefined; readonly title?: string | undefined }
      | undefined
    readonly title?: string | undefined
    readonly twitter?:
      | { readonly description?: string | undefined; readonly title?: string | undefined }
      | undefined
  }
  readonly structuredData?:
    | readonly {
        readonly dateModified?: string | undefined
        readonly datePublished?: string | undefined
        readonly description?: string | undefined
        readonly headline?: string | undefined
        readonly type: string
        readonly url?: string | undefined
      }[]
    | undefined
}

const field = (label: string, page: ConsistentPage): string => `${page.pageType} ${label}`

/**
 * Metadata/JSON-LD consistency gate. Every renderer-facing surface
 * (seo, openGraph, twitter, Article node) must repeat the visible values
 * verbatim; used by compiler tests now and by the SSR host later.
 */
export const verifySeoConsistency = (page: ConsistentPage): void => {
  const title = page.metadata?.title
  const description = page.metadata?.description
  const canonical = page.route?.canonicalUrl
  const fail = (detail: string): CompilerError =>
    new CompilerError(COMPILER_ERROR.SEO_CONSISTENCY_VIOLATION, detail)
  if (page.seo?.title !== undefined && page.seo.title !== title) {
    throw fail(field(`seo.title "${page.seo.title}" differs from metadata.title`, page))
  }
  if (page.seo?.description !== undefined && page.seo.description !== description) {
    throw fail(
      field(`seo.description "${page.seo.description}" differs from metadata.description`, page),
    )
  }
  for (const [surface, values] of [
    ["openGraph", page.seo?.openGraph],
    ["twitter", page.seo?.twitter],
  ] as const) {
    if (values?.title !== undefined && values.title !== title) {
      throw fail(field(`${surface}.title "${values.title}" differs from metadata.title`, page))
    }
    if (values?.description !== undefined && values.description !== description) {
      throw fail(
        field(
          `${surface}.description "${values.description}" differs from metadata.description`,
          page,
        ),
      )
    }
  }
  for (const node of page.structuredData ?? []) {
    if (node.type !== "Article" && node.type !== "NewsArticle") {
      continue
    }
    if (node.headline !== title) {
      throw fail(field(`JSON-LD headline "${node.headline}" differs from metadata.title`, page))
    }
    if (node.url !== undefined && node.url !== canonical) {
      throw fail(field(`JSON-LD url "${node.url}" differs from route.canonicalUrl`, page))
    }
    if (node.description !== undefined && node.description !== description) {
      throw fail(
        field(`JSON-LD description differs from metadata.description on ${node.url ?? ""}`, page),
      )
    }
  }
}
