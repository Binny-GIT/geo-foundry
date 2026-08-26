export type ConsoleListQuery = {
  readonly page: number
  readonly search: string | null
}

const pageOf = (value: string | undefined): number => {
  const page = Number.parseInt(value ?? "1", 10)
  return Number.isSafeInteger(page) && page > 0 ? page : 1
}

const searchOf = (value: string | undefined): string | null => {
  const query = value?.trim()
  return query === undefined || query.length === 0 ? null : query.slice(0, 200)
}

export const parseConsoleListQuery = (query: { readonly page?: string; readonly q?: string }): ConsoleListQuery => ({
  page: pageOf(query.page),
  search: searchOf(query.q),
})

export const consoleListHref = ({
  base,
  page,
  search,
}: {
  readonly base: string
  readonly page: number
  readonly search: string | null
}): string => {
  const params = new URLSearchParams()
  if (page > 1) params.set("page", String(page))
  if (search !== null) params.set("q", search)
  const suffix = params.toString()
  return suffix.length === 0 ? base : `${base}?${suffix}`
}
