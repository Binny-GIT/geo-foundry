import type { PageDocument } from "@geo/schema"
import { canonicalPageFixtures, validBlockFixtures } from "@geo/schema"
import { describe, expect, it } from "vitest"

import { RENDER_ERROR, RenderError, renderPage } from "../src/index.js"

const clonedDocument = (document: PageDocument): PageDocument =>
  JSON.parse(JSON.stringify(document)) as PageDocument

const expectRenderError = (document: PageDocument, code: string): void => {
  try {
    renderPage(document)
    throw new Error("expected renderPage to throw")
  } catch (error) {
    expect(error).toBeInstanceOf(RenderError)
    expect((error as RenderError).code).toBe(code)
  }
}

describe("renderPage", () => {
  it.each(canonicalPageFixtures)("transforms the $pageType canonical page", (document) => {
    const rendered = renderPage(document)

    expect(rendered.pageType).toBe(document.pageType)
    expect(rendered.head.metadata).toEqual(document.metadata)
    expect(rendered.head.route).toEqual(document.route)
    expect(Object.isFrozen(rendered)).toBe(true)
    if (document.pageType === "redirect") {
      expect(rendered.kind).toBe("redirect")
      if (rendered.kind !== "redirect") {
        throw new Error("redirect fixture must render as a redirect")
      }
      expect(rendered.statusCode).toBe(301)
      expect(rendered.targetUrl).toBe(document.redirect.targetUrl)
      expect("content" in rendered).toBe(false)
      return
    }
    if (rendered.kind === "redirect") {
      throw new Error("content fixture must not render as a redirect")
    }
    expect(rendered.content.slots.map((slot) => slot.name)).toEqual([
      "page-header",
      "after-hero",
      "before-body",
      "after-body",
      "footer",
    ])
    if (document.pageType === "article-list" || document.pageType === "category" || document.pageType === "tag") {
      expect("listing" in rendered).toBe(true)
      if (!("listing" in rendered)) {
        throw new Error("listing fixture must render a listing")
      }
      expect(rendered.listing.items).toEqual(document.items)
    } else {
      expect("listing" in rendered).toBe(false)
    }
  })

  it("transforms all declared blocks in source order and resolves citations", () => {
    const document = canonicalPageFixtures[0]
    const rendered = renderPage(document)
    if (rendered.kind === "redirect") {
      throw new Error("article fixture must render as content")
    }

    expect(rendered.content.blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "heading",
      "figure-image",
      "quote",
      "unordered-list",
      "table",
      "faq",
      "callout",
      "code",
      "video",
      "embed",
      "references",
    ])
    expect(rendered.content.blocks.map((block) => block.id)).toEqual(
      validBlockFixtures.map((block) => block.id),
    )
    const references = rendered.content.blocks.at(-1)
    expect(references).toMatchObject({
      kind: "references",
      items: [{ citation: { id: "citation-prd" }, label: "Product requirements" }],
    })
  })

  it("is deterministic, deeply immutable, and does not mutate its input", () => {
    for (const fixture of canonicalPageFixtures) {
      const document = clonedDocument(fixture)
      const before = JSON.stringify(document)
      const first = renderPage(document)
      const second = renderPage(document)

      expect(JSON.stringify(first)).toBe(JSON.stringify(second))
      expect(JSON.stringify(document)).toBe(before)
      expect(first).not.toBe(second)
      expect(Object.isFrozen(first)).toBe(true)
    }
  })

  it("fails closed for unknown page and block discriminators", () => {
    const unknownPage = {
      ...clonedDocument(canonicalPageFixtures[0]),
      pageType: "landing",
    } as unknown as PageDocument
    expectRenderError(unknownPage, RENDER_ERROR.PAGE_UNSUPPORTED)

    const unknownBlock = clonedDocument(canonicalPageFixtures[0]) as PageDocument & {
      body: readonly unknown[]
    }
    unknownBlock.body = [{ type: "html", value: "<p>untrusted</p>" }]
    expectRenderError(unknownBlock as PageDocument, RENDER_ERROR.BLOCK_UNSUPPORTED)
  })

  it("rejects semantic heading, breadcrumb, image, pagination, table, and citation violations", () => {
    const heading = clonedDocument(canonicalPageFixtures[0]) as PageDocument & { body: unknown[] }
    heading.body[1] = { id: "heading-contract", level: 3, text: "Contract", type: "heading" }
    expectRenderError(heading, RENDER_ERROR.HEADING_HIERARCHY_INVALID)

    const skippedHeading = clonedDocument(canonicalPageFixtures[0]) as PageDocument & { body: unknown[] }
    skippedHeading.body[1] = { id: "heading-contract", level: 2, text: "Contract", type: "heading" }
    skippedHeading.body.splice(2, 0, { level: 4, text: "Skipped", type: "heading" })
    expectRenderError(skippedHeading, RENDER_ERROR.HEADING_HIERARCHY_INVALID)

    const breadcrumbs = clonedDocument(canonicalPageFixtures[0]) as PageDocument & { breadcrumbs: unknown[] }
    breadcrumbs.breadcrumbs = [{ pathname: "/guides", title: "Guides" }]
    expectRenderError(breadcrumbs, RENDER_ERROR.BREADCRUMB_INVALID)

    const duplicateBreadcrumbs = clonedDocument(canonicalPageFixtures[0]) as PageDocument & { breadcrumbs: unknown[] }
    duplicateBreadcrumbs.breadcrumbs = [
      { pathname: "/", title: "Home" },
      { pathname: "/", title: "Home again" },
    ]
    expectRenderError(duplicateBreadcrumbs, RENDER_ERROR.BREADCRUMB_INVALID)

    const image = clonedDocument(canonicalPageFixtures[0]) as PageDocument & { body: unknown[] }
    image.body[2] = { alt: "", src: "/media/map.webp", type: "image" }
    expectRenderError(image, RENDER_ERROR.IMAGE_ALT_MISSING)

    const required = clonedDocument(canonicalPageFixtures[0]) as PageDocument & {
      metadata: Record<string, unknown>
    }
    required.metadata = { ...required.metadata, title: "" }
    expectRenderError(required, RENDER_ERROR.REQUIRED_FIELD_MISSING)

    const pagination = clonedDocument(canonicalPageFixtures[1]) as PageDocument & {
      pagination: Record<string, unknown>
    }
    pagination.pagination = { ...pagination.pagination, page: 2 }
    expectRenderError(pagination, RENDER_ERROR.PAGINATION_INVALID)

    const table = clonedDocument(canonicalPageFixtures[0]) as PageDocument & { body: unknown[] }
    table.body[5] = { columns: ["A", "B"], rows: [["only one"]], type: "table" }
    expectRenderError(table, RENDER_ERROR.TABLE_INVALID)

    const references = clonedDocument(canonicalPageFixtures[0]) as PageDocument & { body: unknown[] }
    references.body[11] = {
      items: [{ citationId: "citation-missing", label: "Missing" }],
      type: "references",
    }
    expectRenderError(references, RENDER_ERROR.REFERENCE_UNRESOLVED)
  })
})
