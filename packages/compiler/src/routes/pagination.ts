import { CompilerError, COMPILER_ERROR } from "../compile/errors.js"

export type ListingPage<T> = {
  readonly items: readonly T[]
  readonly nextPathname?: string
  readonly page: number
  readonly pageCount: number
  readonly pathname: string
  readonly previousPathname?: string
  readonly totalItems: number
}

/** Page 1 keeps the base pathname; later pages append /page/<n>. */
export const listingPagePathname = (basePathname: string, page: number): string =>
  page === 1 ? basePathname : `${basePathname === "/" ? "" : basePathname}/page/${page}`

/** Rejects page numbers outside the computed 1..totalPages range (gaps). */
export const assertPageInRange = (page: number, totalPages: number, basePathname: string): void => {
  if (!Number.isInteger(page) || page < 1 || page > totalPages) {
    throw new CompilerError(
      COMPILER_ERROR.PAGINATION_INVALID,
      `page ${page} of listing ${basePathname} is outside 1..${totalPages}`,
    )
  }
}

/**
 * Deterministic listing pagination: fixed pageSize slices over sorted items,
 * page 1 on the base pathname, contiguous previous/next chain. An empty
 * listing still produces exactly one (empty) page so the route always
 * resolves.
 */
export const paginateListing = <T>(input: {
  readonly basePathname: string
  readonly items: readonly T[]
  readonly pageSize: number
}): readonly ListingPage<T>[] => {
  const { basePathname, items, pageSize } = input
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new CompilerError(
      COMPILER_ERROR.PAGINATION_INVALID,
      `pageSize ${pageSize} of listing ${basePathname} must be a positive integer`,
    )
  }
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const pages: ListingPage<T>[] = []
  for (let page = 1; page <= pageCount; page += 1) {
    assertPageInRange(page, pageCount, basePathname)
    pages.push({
      items: items.slice((page - 1) * pageSize, page * pageSize),
      ...(page < pageCount ? { nextPathname: listingPagePathname(basePathname, page + 1) } : {}),
      page,
      pageCount,
      pathname: listingPagePathname(basePathname, page),
      ...(page > 1 ? { previousPathname: listingPagePathname(basePathname, page - 1) } : {}),
      totalItems: items.length,
    })
  }
  return pages
}
