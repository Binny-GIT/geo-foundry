export const RENDER_ERROR = {
  BLOCK_UNSUPPORTED: "RENDER_BLOCK_UNSUPPORTED",
  BREADCRUMB_INVALID: "RENDER_BREADCRUMB_INVALID",
  HEADING_HIERARCHY_INVALID: "RENDER_HEADING_HIERARCHY_INVALID",
  IMAGE_ALT_MISSING: "RENDER_IMAGE_ALT_MISSING",
  PAGE_UNSUPPORTED: "RENDER_PAGE_UNSUPPORTED",
  PAGINATION_INVALID: "RENDER_PAGINATION_INVALID",
  REFERENCE_UNRESOLVED: "RENDER_REFERENCE_UNRESOLVED",
  REQUIRED_FIELD_MISSING: "RENDER_REQUIRED_FIELD_MISSING",
  TABLE_INVALID: "RENDER_TABLE_INVALID",
} as const

export type RenderErrorCode = (typeof RENDER_ERROR)[keyof typeof RENDER_ERROR]

export type RenderErrorLocation = {
  readonly blockId?: string
  readonly blockIndex?: number
  readonly field?: string
}

export class RenderError extends Error {
  public readonly blockId?: string
  public readonly blockIndex?: number
  public readonly code: RenderErrorCode
  public readonly detail: string
  public readonly field?: string

  public constructor(code: RenderErrorCode, detail: string, location: RenderErrorLocation = {}) {
    super(`${code}: ${detail}`)
    this.name = "RenderError"
    this.code = code
    this.detail = detail
    if (location.blockId !== undefined) {
      this.blockId = location.blockId
    }
    if (location.blockIndex !== undefined) {
      this.blockIndex = location.blockIndex
    }
    if (location.field !== undefined) {
      this.field = location.field
    }
  }
}
