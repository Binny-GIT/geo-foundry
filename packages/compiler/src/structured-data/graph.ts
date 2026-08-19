import type { Breadcrumb, StructuredData } from "@geo/schema"

import { canonicalJson } from "../canonical.js"
import { COMPILER_ERROR, CompilerError } from "../compile/errors.js"
import { assetUrlOf, canonicalDomainOf } from "../seo/urls.js"

export type GraphSite = {
  readonly canonicalDomain: string
  readonly organization?: { readonly logoUrl?: string; readonly name: string }
}

export type GraphAuthor = { readonly id: string; readonly name: string; readonly url?: string }

export type GraphHeroImage = {
  readonly caption: string
  readonly height?: number
  readonly url: string
  readonly width?: number
}

const required = (field: string, detail: string): CompilerError =>
  new CompilerError(COMPILER_ERROR.SEO_REQUIRED_FIELD_MISSING, `${field} required: ${detail}`)

/**
 * Deterministic JSON-LD node list: identical nodes collapse (first wins),
 * while two distinct nodes claiming the same id is a broken graph and
 * fails typed.
 */
export const dedupeStructuredData = (
  nodes: readonly StructuredData[],
): readonly StructuredData[] => {
  const byId = new Map<string, StructuredData>()
  const byCanonical = new Set<string>()
  const unique: StructuredData[] = []
  for (const node of nodes) {
    const canonical = canonicalJson(node)
    if (byCanonical.has(canonical)) {
      continue
    }
    if (node.id !== undefined) {
      const existing = byId.get(node.id)
      if (existing !== undefined) {
        throw new CompilerError(
          COMPILER_ERROR.SEO_STRUCTURED_DATA_ID_DUPLICATE,
          `JSON-LD id "${node.id}" claimed by both ${existing.type} and ${node.type}`,
        )
      }
      byId.set(node.id, node)
    }
    byCanonical.add(canonical)
    unique.push(node)
  }
  return unique
}

const organizationNodeOf = (site: GraphSite): StructuredData => {
  const organization = site.organization
  if (organization === undefined || organization.name.length === 0) {
    throw required("organization", `site ${canonicalDomainOf(site)} has no publisher organization`)
  }
  const logoUrl =
    organization.logoUrl === undefined
      ? undefined
      : assetUrlOf(site, organization.logoUrl, "organization.logoUrl")
  return {
    id: "#organization",
    name: organization.name,
    type: "Organization",
    url: `https://${canonicalDomainOf(site)}/`,
    ...(logoUrl === undefined ? {} : { logo: logoUrl }),
  }
}

export type ArticleGraphInput = {
  readonly articleKind: "article" | "news"
  readonly author?: GraphAuthor
  readonly breadcrumbs: readonly Breadcrumb[]
  readonly canonicalUrl: string
  readonly dateModified: string
  readonly datePublished: string
  readonly description: string
  readonly heroImage?: GraphHeroImage
  readonly site: GraphSite
  readonly title: string
}

/**
 * Linked JSON-LD graph for article pages: the Article/NewsArticle node,
 * an optional ImageObject for the hero, the author as Person, the site
 * publisher as Organization, and the visible breadcrumbs. Every value is
 * copied from the same source the visible page renders.
 */
export const buildArticleGraph = (input: ArticleGraphInput): readonly StructuredData[] => {
  const author = input.author
  if (author === undefined || author.name.length === 0) {
    throw required("author", `article ${input.canonicalUrl} has no author`)
  }
  if (input.articleKind === "news" && input.heroImage === undefined) {
    throw required("image", `news article ${input.canonicalUrl} requires a hero image`)
  }
  const nodes: StructuredData[] = [
    {
      author: { name: author.name, ...(author.url === undefined ? {} : { url: author.url }) },
      dateModified: input.dateModified,
      datePublished: input.datePublished,
      description: input.description,
      headline: input.title,
      id: "#article",
      ...(input.heroImage === undefined ? {} : { image: input.heroImage.url }),
      type: input.articleKind === "news" ? "NewsArticle" : "Article",
      url: input.canonicalUrl,
    },
    {
      id: "#author",
      name: author.name,
      type: "Person",
      ...(author.url === undefined ? {} : { url: author.url }),
    },
    organizationNodeOf(input.site),
    { id: "#breadcrumbs", items: [...input.breadcrumbs], type: "BreadcrumbList" },
  ]
  if (input.heroImage !== undefined) {
    nodes.splice(1, 0, {
      caption: input.heroImage.caption,
      ...(input.heroImage.height === undefined ? {} : { height: input.heroImage.height }),
      id: "#primary-image",
      type: "ImageObject",
      url: input.heroImage.url,
      ...(input.heroImage.width === undefined ? {} : { width: input.heroImage.width }),
    })
  }
  return dedupeStructuredData(nodes)
}

export type ListingGraphInput = {
  readonly breadcrumbs: readonly Breadcrumb[]
  readonly canonicalUrl: string
  readonly description: string
  readonly title: string
}

/** Collection pages describe themselves plus the visible breadcrumb trail. */
export const buildListingGraph = (input: ListingGraphInput): readonly StructuredData[] =>
  dedupeStructuredData([
    {
      description: input.description,
      id: "#collection",
      name: input.title,
      type: "CollectionPage",
      url: input.canonicalUrl,
    },
    { id: "#breadcrumbs", items: [...input.breadcrumbs], type: "BreadcrumbList" },
  ])

export type WebPageGraphInput = {
  readonly breadcrumbs?: readonly Breadcrumb[]
  readonly canonicalUrl: string
  readonly description?: string
  readonly name: string
}

/** Utility pages (not-found): a WebPage node mirrors the visible heading. */
export const buildWebPageGraph = (input: WebPageGraphInput): readonly StructuredData[] => {
  const nodes: StructuredData[] = [
    {
      ...(input.description === undefined ? {} : { description: input.description }),
      id: "#webpage",
      name: input.name,
      type: "WebPage",
      url: input.canonicalUrl,
    },
  ]
  if (input.breadcrumbs !== undefined) {
    nodes.push({ id: "#breadcrumbs", items: [...input.breadcrumbs], type: "BreadcrumbList" })
  }
  return dedupeStructuredData(nodes)
}
