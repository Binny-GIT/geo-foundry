export type EditionReference = {
  readonly id: number | string | null
  readonly title: string | null
}

export const editionReferenceOf = (value: unknown): EditionReference => {
  if (typeof value === "number" || typeof value === "string") {
    return { id: value, title: null }
  }
  if (typeof value !== "object" || value === null) {
    return { id: null, title: null }
  }
  const row = value as Record<string, unknown>
  const id = row["id"]
  const title = row["title"]
  return {
    id: typeof id === "number" || typeof id === "string" ? id : null,
    title: typeof title === "string" && title.length > 0 ? title : null,
  }
}

export const editionHrefOf = (id: number | string): string =>
  `/admin/collections/content-editions/${String(id)}`
