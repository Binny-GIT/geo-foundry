import type { ContentBlock, PageDocument } from "@geo/schema"

import { RENDER_ERROR, RenderError } from "./errors.js"

type ContentPageDocument = Exclude<PageDocument, { readonly pageType: "redirect" }>

const blockLocation = (block: ContentBlock, blockIndex: number, field: string) => ({
  ...(block.id === undefined ? {} : { blockId: block.id }),
  blockIndex,
  field,
})

export const assertRequiredText = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RenderError(RENDER_ERROR.REQUIRED_FIELD_MISSING, "a required text value is missing", {
      field,
    })
  }
  return value
}

const isRouteAncestor = (pathname: string, routePathname: string): boolean =>
  pathname === "/" || pathname === routePathname || routePathname.startsWith(`${pathname}/`)

const validateBreadcrumbs = (document: ContentPageDocument): void => {
  const { breadcrumbs } = document
  if (breadcrumbs.length === 0 || breadcrumbs[0]?.pathname !== "/") {
    throw new RenderError(
      RENDER_ERROR.BREADCRUMB_INVALID,
      "breadcrumbs must begin at the root route",
      {
        field: "breadcrumbs",
      },
    )
  }

  const pathnames = new Set<string>()
  for (const breadcrumb of breadcrumbs) {
    if (
      pathnames.has(breadcrumb.pathname) ||
      !isRouteAncestor(breadcrumb.pathname, document.route.pathname)
    ) {
      throw new RenderError(
        RENDER_ERROR.BREADCRUMB_INVALID,
        "breadcrumbs must be unique ancestors of the current route",
        { field: "breadcrumbs" },
      )
    }
    pathnames.add(breadcrumb.pathname)
  }
}

const validateHero = (document: ContentPageDocument): void => {
  const image = document.hero?.image
  if (image !== undefined && (typeof image.alt !== "string" || image.alt.trim().length === 0)) {
    throw new RenderError(
      RENDER_ERROR.IMAGE_ALT_MISSING,
      "hero images require non-empty alternative text",
      {
        field: "hero.image.alt",
      },
    )
  }
}

const validateHeadingHierarchy = (body: readonly ContentBlock[]): void => {
  let previousLevel: number | undefined
  for (const [blockIndex, block] of body.entries()) {
    if (block.type !== "heading") {
      continue
    }
    if (previousLevel === undefined && block.level !== 2) {
      throw new RenderError(
        RENDER_ERROR.HEADING_HIERARCHY_INVALID,
        "the first body heading must be level 2",
        blockLocation(block, blockIndex, "level"),
      )
    }
    if (previousLevel !== undefined && block.level > previousLevel + 1) {
      throw new RenderError(
        RENDER_ERROR.HEADING_HIERARCHY_INVALID,
        "body heading levels cannot skip deeper levels",
        blockLocation(block, blockIndex, "level"),
      )
    }
    previousLevel = block.level
  }
}

const validatePagination = (document: ContentPageDocument): void => {
  if (!("pagination" in document) || document.pagination === undefined) {
    return
  }
  const { nextPathname, page, pageSize, previousPathname, totalItems, totalPages } =
    document.pagination
  const expectedTotalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  if (totalPages !== expectedTotalPages || page > totalPages) {
    throw new RenderError(
      RENDER_ERROR.PAGINATION_INVALID,
      "pagination totals and page number are inconsistent",
      {
        field: "pagination",
      },
    )
  }
  if (
    (page === 1 && previousPathname !== undefined) ||
    (page > 1 && previousPathname === undefined)
  ) {
    throw new RenderError(
      RENDER_ERROR.PAGINATION_INVALID,
      "previous pagination route is inconsistent",
      {
        field: "pagination.previousPathname",
      },
    )
  }
  if (
    (page === totalPages && nextPathname !== undefined) ||
    (page < totalPages && nextPathname === undefined)
  ) {
    throw new RenderError(
      RENDER_ERROR.PAGINATION_INVALID,
      "next pagination route is inconsistent",
      {
        field: "pagination.nextPathname",
      },
    )
  }
}

export const validateRequiredDocumentFields = (document: PageDocument): void => {
  assertRequiredText(document.route.pathname, "route.pathname")
  assertRequiredText(document.route.canonicalUrl, "route.canonicalUrl")
  assertRequiredText(document.metadata.title, "metadata.title")
  assertRequiredText(document.metadata.description, "metadata.description")
  assertRequiredText(document.seo.title, "seo.title")
  assertRequiredText(document.seo.description, "seo.description")
  if (document.pageType !== "redirect" && document.hero !== undefined) {
    assertRequiredText(document.hero.title, "hero.title")
  }
}

export const validateContentDocument = (document: ContentPageDocument): void => {
  validateBreadcrumbs(document)
  validateHero(document)
  validateHeadingHierarchy(document.body)
  validatePagination(document)
}

export const validateBlock = (block: ContentBlock, blockIndex: number): void => {
  if (block.type === "image" && (typeof block.alt !== "string" || block.alt.trim().length === 0)) {
    throw new RenderError(
      RENDER_ERROR.IMAGE_ALT_MISSING,
      "body images require non-empty alternative text",
      blockLocation(block, blockIndex, "alt"),
    )
  }
  if (block.type === "table" && block.rows.some((row) => row.length !== block.columns.length)) {
    throw new RenderError(
      RENDER_ERROR.TABLE_INVALID,
      "every table row must match the column count",
      blockLocation(block, blockIndex, "rows"),
    )
  }
}
