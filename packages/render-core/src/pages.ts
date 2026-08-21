import type { PageDocument } from "@geo/schema"

import { renderBlock } from "./blocks.js"
import { RENDER_ERROR, RenderError } from "./errors.js"
import type { RenderContent, RenderHead, RenderHero, RenderListing, RenderPage } from "./model.js"
import { createRenderSlots } from "./slots.js"
import { validateContentDocument, validateRequiredDocumentFields } from "./validation.js"

type ContentPageDocument = Exclude<PageDocument, { readonly pageType: "redirect" }>

const unsupportedPage = (document: never): never => {
  const pageType = (document as { readonly pageType?: unknown }).pageType
  throw new RenderError(
    RENDER_ERROR.PAGE_UNSUPPORTED,
    `unsupported page discriminator: ${String(pageType)}`,
  )
}

const headOf = (document: PageDocument): RenderHead => ({
  identity: document.identity,
  metadata: document.metadata,
  route: document.route,
  seo: document.seo,
  structuredData: document.pageType === "redirect" ? [] : (document.structuredData ?? []),
})

const heroOf = (document: ContentPageDocument): RenderHero | undefined => {
  if (document.hero === undefined) {
    return undefined
  }
  const { image, summary, title } = document.hero
  return {
    ...(image === undefined
      ? {}
      : {
          image: {
            alt: image.alt,
            ...(image.height === undefined ? {} : { height: image.height }),
            kind: "figure-image" as const,
            src: image.src,
            ...(image.width === undefined ? {} : { width: image.width }),
          },
        }),
    kind: "hero",
    ...(summary === undefined ? {} : { summary }),
    title,
  }
}

const contentOf = (document: ContentPageDocument): RenderContent => {
  validateContentDocument(document)
  const citations = document.citations ?? []
  const citationLookup = new Map(citations.map((citation) => [citation.id, citation] as const))
  const hero = heroOf(document)
  return {
    ...(document.author === undefined ? {} : { author: document.author }),
    blocks: document.body.map((block, blockIndex) =>
      renderBlock(block, blockIndex, citationLookup),
    ),
    breadcrumbs: document.breadcrumbs,
    citations,
    entities: document.entities ?? [],
    ...(hero === undefined ? {} : { hero }),
    relatedPages: document.relatedPages ?? [],
    slots: createRenderSlots(document),
  }
}

const listingOf = (
  document: Extract<ContentPageDocument, { readonly items: readonly unknown[] }>,
): RenderListing => {
  const pagination = document.pagination
  return {
    items: document.items,
    ...(pagination === undefined
      ? {}
      : {
          pagination: {
            ...(pagination.nextPathname === undefined
              ? {}
              : { nextPathname: pagination.nextPathname }),
            page: pagination.page,
            pageSize: pagination.pageSize,
            ...(pagination.previousPathname === undefined
              ? {}
              : { previousPathname: pagination.previousPathname }),
            totalItems: pagination.totalItems,
            totalPages: pagination.totalPages,
          },
        }),
  }
}

export const renderPageModel = (document: PageDocument): RenderPage => {
  validateRequiredDocumentFields(document)
  switch (document.pageType) {
    case "article":
      return {
        content: contentOf(document),
        head: headOf(document),
        kind: "content",
        pageType: "article",
      }
    case "article-list":
      return {
        content: contentOf(document),
        head: headOf(document),
        kind: "content",
        listing: listingOf(document),
        pageType: "article-list",
      }
    case "category":
      return {
        content: contentOf(document),
        head: headOf(document),
        kind: "content",
        listing: listingOf(document),
        pageType: "category",
      }
    case "tag":
      return {
        content: contentOf(document),
        head: headOf(document),
        kind: "content",
        listing: listingOf(document),
        pageType: "tag",
      }
    case "redirect":
      return {
        head: headOf(document),
        kind: "redirect",
        pageType: "redirect",
        statusCode: document.redirect.statusCode,
        targetUrl: document.redirect.targetUrl,
      }
    case "not-found":
      return {
        content: contentOf(document),
        head: headOf(document),
        kind: "content",
        pageType: "not-found",
      }
    default:
      return unsupportedPage(document)
  }
}
