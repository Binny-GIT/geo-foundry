import { createContext, useContext, type ReactNode } from "react"

import type { RenderPage, RenderSlotName } from "@geo/render-core"

import { GEO_RENDER_ERROR, GeoRenderError } from "./errors.js"
import type { GeoSlotComponent, GeoTheme, GeoThemeComponents, GeoThemeTokens } from "./theme.js"
import { resolveGeoThemeTokens } from "./theme.js"

export type GeoRenderContextValue = Readonly<{
  readonly components: Partial<GeoThemeComponents>
  readonly page: RenderPage
  readonly slots: Readonly<Partial<Record<RenderSlotName, GeoSlotComponent>>>
  readonly tokens: GeoThemeTokens
}>

const GeoRenderContext = createContext<GeoRenderContextValue | undefined>(undefined)

const componentNames = [
  "Author",
  "Block",
  "Breadcrumbs",
  "Hero",
  "Listing",
  "RelatedPages",
] as const
const slotNames = ["page-header", "after-hero", "before-body", "after-body", "footer"] as const

const validateTheme = (theme: GeoTheme | undefined): void => {
  if (theme?.components !== undefined) {
    for (const [name, component] of Object.entries(theme.components)) {
      if (
        !componentNames.includes(name as (typeof componentNames)[number]) ||
        typeof component !== "function"
      ) {
        throw new GeoRenderError(
          GEO_RENDER_ERROR.THEME_COMPONENT_INVALID,
          `invalid theme component: ${name}`,
        )
      }
    }
  }
  if (theme?.slots !== undefined) {
    for (const [name, slot] of Object.entries(theme.slots)) {
      if (!slotNames.includes(name as (typeof slotNames)[number]) || typeof slot !== "function") {
        throw new GeoRenderError(GEO_RENDER_ERROR.THEME_SLOT_INVALID, `invalid theme slot: ${name}`)
      }
    }
  }
}

export type GeoProviderProps = Readonly<{
  readonly children: ReactNode
  readonly page: RenderPage
  readonly theme?: GeoTheme
}>

export const GeoProvider = ({ children, page, theme }: GeoProviderProps): ReactNode => {
  validateTheme(theme)
  const value: GeoRenderContextValue = Object.freeze({
    components: Object.freeze({ ...theme?.components }),
    page,
    slots: Object.freeze({ ...theme?.slots }),
    tokens: resolveGeoThemeTokens(theme),
  })
  return <GeoRenderContext.Provider value={value}>{children}</GeoRenderContext.Provider>
}

export const useGeoPage = (): GeoRenderContextValue => {
  const value = useContext(GeoRenderContext)
  if (value === undefined) {
    throw new GeoRenderError(GEO_RENDER_ERROR.MISSING_PROVIDER, "GeoProvider is required")
  }
  return value
}
