export const GEO_RENDER_ERROR = {
  MISSING_PROVIDER: "GEO_RENDER_MISSING_PROVIDER",
  THEME_COMPONENT_INVALID: "GEO_RENDER_THEME_COMPONENT_INVALID",
  THEME_SLOT_INVALID: "GEO_RENDER_THEME_SLOT_INVALID",
} as const

export type GeoRenderErrorCode = (typeof GEO_RENDER_ERROR)[keyof typeof GEO_RENDER_ERROR]

export class GeoRenderError extends Error {
  public readonly code: GeoRenderErrorCode

  public constructor(code: GeoRenderErrorCode, detail: string) {
    super(`${code}: ${detail}`)
    this.name = "GeoRenderError"
    this.code = code
  }
}
