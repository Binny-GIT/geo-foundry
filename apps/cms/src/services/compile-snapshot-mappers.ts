import type { CompileEdition } from "@geo/compiler"

export type Doc = Record<string, unknown>

const UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export const utcInstantOf = (value: unknown, label: string): string => {
  const text = typeof value === "string" ? value : String(value ?? "")
  if (!UTC_MILLIS.test(text)) {
    throw new Error(`COMPILE_SNAPSHOT_INSTANT_INVALID: ${label} is ${text}`)
  }
  return text
}

export const textOf = (value: unknown): string => (typeof value === "string" ? value : "")

export const idOf = (value: unknown): number | null => {
  if (typeof value === "object" && value !== null) {
    return idOf((value as Doc)["id"])
  }
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

export type UrlRecordDoc = Doc

/** Active pathnames by content id plus single-hop redirect entries. */
export const deriveRoutes = (
  urlRecords: readonly UrlRecordDoc[],
): {
  readonly activeUrlByContent: Map<number, string>
  readonly redirects: readonly { fromPathname: string; targetUrl: string }[]
} => {
  const activeUrlByContent = new Map<number, string>()
  const redirects: { fromPathname: string; targetUrl: string }[] = []
  for (const record of urlRecords) {
    const state = textOf(record["state"])
    const pathname = textOf(record["pathname"])
    if (pathname.length === 0) {
      continue
    }
    if (state === "active") {
      const contentId = idOf(record["content"])
      if (contentId !== null && !activeUrlByContent.has(contentId)) {
        activeUrlByContent.set(contentId, pathname)
      }
      continue
    }
    if (state === "redirected") {
      const target = record["targetUrl"]
      const targetPathname =
        typeof target === "object" && target !== null
          ? textOf((target as UrlRecordDoc)["pathname"])
          : textOf(target)
      if (targetPathname.length > 0) {
        redirects.push({ fromPathname: pathname, targetUrl: targetPathname })
      }
    }
  }
  return { activeUrlByContent, redirects }
}

export type EditionMappingInput = {
  readonly assessment: { state: string; inputHash: string } | undefined
  readonly authorId: string
  readonly authorName: string
  readonly canonicalDomain: string
  readonly edition: Doc
  readonly siteKey: string
  readonly urlPathname: string
}

/** One ContentEditions row -> compiler CompileEdition snapshot. */
export const mapEdition = (input: EditionMappingInput): CompileEdition | null => {
  const edition = input.edition
  const editionId = idOf(edition["id"])
  const contentId = idOf(edition["content"])
  if (editionId === null || contentId === null) {
    return null
  }
  const primaryTopic = textOf(edition["primaryTopic"])
  const secondaryTopics = Array.isArray(edition["secondaryTopics"])
    ? (edition["secondaryTopics"] as unknown[]).map(textOf).filter((tag) => tag.length > 0)
    : []
  return {
    assessmentInputHash: input.assessment?.inputHash ?? "",
    assessmentState:
      input.assessment?.state === "error" ||
      input.assessment?.state === "failed" ||
      input.assessment?.state === "passed"
        ? input.assessment.state
        : "failed",
    ...(input.authorName.length === 0
      ? {}
      : {
          author: {
            id: input.authorId,
            name: input.authorName,
            url: `https://${input.canonicalDomain}/authors/${slugify(input.authorName)}`,
          },
        }),
    body: Array.isArray(edition["body"]) ? (edition["body"] as unknown[]) : [],
    categories: primaryTopic.length === 0 ? [] : [slugify(primaryTopic)],
    citations: Array.isArray(edition["citations"])
      ? (edition["citations"] as NonNullable<CompileEdition["citations"]>)
      : [],
    contentId,
    editionId,
    entities: Array.isArray(edition["entities"]) ? (edition["entities"] as unknown[]) : [],
    media: [],
    modifiedAt: utcInstantOf(edition["updatedAt"], `edition ${editionId} updatedAt`),
    publishedAt: utcInstantOf(edition["createdAt"], `edition ${editionId} createdAt`),
    siteId: input.siteKey,
    status: textOf(edition["workflowStatus"]) as CompileEdition["status"],
    summary: textOf(edition["summary"]) || textOf(edition["title"]),
    tags: secondaryTopics.map(slugify),
    title: textOf(edition["title"]),
    urlPathname: input.urlPathname,
    urlStatus: "active",
  }
}

/** Listings derived from edition taxonomy: /<category> and /tags/<tag>. */
export const deriveListings = (
  topics: readonly { readonly categories: readonly string[]; readonly tags: readonly string[] }[],
): {
  readonly categories: readonly { id: string; pathname: string; slug: string; title: string }[]
  readonly tags: readonly { id: string; pathname: string; slug: string; title: string }[]
} => {
  const categories = new Set<string>()
  const tags = new Set<string>()
  for (const topic of topics) {
    for (const category of topic.categories) {
      categories.add(category)
    }
    for (const tag of topic.tags) {
      tags.add(tag)
    }
  }
  return {
    categories: [...categories].sort().map((topic) => {
      const slug = slugify(topic)
      return {
        id: `cat-${slug}`,
        pathname: `/${slug}`,
        slug,
        title: topic.charAt(0).toUpperCase() + topic.slice(1),
      }
    }),
    tags: [...tags].sort().map((topic) => {
      const slug = slugify(topic)
      return { id: `tag-${slug}`, pathname: `/tags/${slug}`, slug, title: topic }
    }),
  }
}
