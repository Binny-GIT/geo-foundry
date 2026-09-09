import type { PageDocument } from "@geo/schema"

import type { RenderSlotData } from "./model.js"

const slotNames = ["page-header", "after-hero", "before-body", "after-body", "footer"] as const

export const createRenderSlots = (document: PageDocument): readonly RenderSlotData[] =>
  slotNames.map((name) => ({
    name,
    pageId: document.identity.pageId,
    pageType: document.pageType,
    pathname: document.route.pathname,
  }))
