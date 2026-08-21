import type { PageDocument } from "@geo/schema"

import type { RenderPage } from "./model.js"
import { renderPageModel } from "./pages.js"

const cloneJson = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value)) as Value

const freezeRecursively = <Value>(value: Value): Value => {
  if (value !== null && typeof value === "object") {
    for (const nestedValue of Object.values(value)) {
      freezeRecursively(nestedValue)
    }
    Object.freeze(value)
  }
  return value
}

export const renderPage = (document: PageDocument): RenderPage =>
  freezeRecursively(cloneJson(renderPageModel(document)))

export { RENDER_ERROR, RenderError } from "./errors.js"
export type { RenderErrorCode, RenderErrorLocation } from "./errors.js"
export type {
  RenderArticleListPage,
  RenderArticlePage,
  RenderBlock,
  RenderCalloutBlock,
  RenderCategoryPage,
  RenderCodeBlock,
  RenderContent,
  RenderContentPage,
  RenderEmbedBlock,
  RenderFaqBlock,
  RenderFigureImage,
  RenderHead,
  RenderHeadingBlock,
  RenderHero,
  RenderImageBlock,
  RenderListBlock,
  RenderListing,
  RenderNotFoundPage,
  RenderPage,
  RenderParagraphBlock,
  RenderQuoteBlock,
  RenderRedirectPage,
  RenderReferencesBlock,
  RenderSlotName,
  RenderSlotPayload,
  RenderTableBlock,
  RenderTagPage,
  RenderVideoBlock,
} from "./model.js"
