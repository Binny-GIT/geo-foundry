import { ArticlePageSchema, type ArticlePage, type ContentBlock } from "@geo/schema"

export type DraftDocumentInput = {
  readonly body: readonly unknown[]
  readonly contentId: number
  readonly pathname: string
  readonly siteId: string
  readonly summary: string
  readonly title: string
}

const EDITION_BLOCK_TYPE: Readonly<Record<string, string>> = {
  callout: "paragraph",
  code: "code",
  embed: "embed",
  faq: "faq",
  heading: "heading",
  image: "image",
  list: "list",
  paragraph: "paragraph",
  quote: "quote",
  references: "references",
  table: "table",
  video: "video",
}

const blockOf = (raw: unknown, index: number): ContentBlock | null => {
  if (raw === null || typeof raw !== "object") {
    return null
  }
  const candidate = raw as Record<string, unknown>
  const discriminator = candidate["blockType"] ?? candidate["type"]
  const blockType = typeof discriminator === "string" ? discriminator : null
  const type = blockType === null ? null : (EDITION_BLOCK_TYPE[blockType] ?? null)
  if (type === null) {
    return null
  }
  const mapped: Record<string, unknown> = { ...candidate, type }
  delete mapped["blockName"]
  delete mapped["blockType"]
  delete mapped["id"]
  if (mapped["extensions"] === null) {
    delete mapped["extensions"]
  }
  if (typeof candidate["level"] === "string") {
    mapped["level"] = Number(candidate["level"])
  }
  if (
    type === "heading" &&
    (typeof mapped["level"] !== "number" || mapped["level"] < 2 || mapped["level"] > 6)
  ) {
    mapped["level"] = 2
  }
  if (typeof candidate["style"] === "string" && candidate["style"] === "ordered") {
    mapped["style"] = "ordered"
  }
  mapped["id"] = `generated-block-${index}`
  return mapped as unknown as ContentBlock
}

/**
 * Minimal article PageDocument used by the evaluation gate before the real
 * compiler exists: edition/draft blocks map one-to-one where the contracts
 * align, and the result is validated through the strict v1 schema so rules
 * operate on the same document type the serving plane will consume.
 */
export const draftDocumentOf = (input: DraftDocumentInput): ArticlePage => {
  const body = input.body
    .map((block, index) => blockOf(block, index))
    .filter((block): block is ContentBlock => block !== null)
  if (body.length === 0) {
    throw new Error("DRAFT_DOCUMENT_BODY_EMPTY")
  }
  const now = new Date(0).toISOString()
  const slug = input.siteId.toLowerCase().replace(/[^a-z0-9]+/g, "-")
  const siteId = slug.replace(/^-+|-+$/g, "") || "site"
  const canonicalUrl = `https://draft.invalid${input.pathname}`
  return ArticlePageSchema.parse({
    body,
    pageType: "article",
    breadcrumbs: [{ pathname: input.pathname, title: input.title }],
    identity: {
      contentId: `content-${input.contentId}`,
      pageId: `draft-${input.contentId}`,
      siteId,
    },
    metadata: {
      description: input.summary,
      modifiedAt: now,
      publishedAt: now,
      title: input.title,
    },
    route: {
      canonicalUrl,
      locale: "en-US",
      pathname: input.pathname,
    },
    schemaVersion: 1,
    structuredData: [
      {
        headline: input.title,
        type: "Article",
        url: canonicalUrl,
      },
    ],
    seo: {
      description: input.summary,
      openGraph: { description: input.summary, title: input.title, type: "website" },
      robots: { follow: true, index: false },
      title: input.title,
    },
  })
}
