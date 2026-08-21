import type {
  ReactNode,
} from "react"

import type {
  RenderBlock,
  RenderContent,
  RenderHero,
  RenderListing,
  RenderPage,
  RenderSlotName,
  RenderSlotPayload,
} from "@geo/render-core"

export type GeoThemeTokens = Readonly<{
  accentColor: string
  backgroundColor: string
  borderColor: string
  contentWidth: string
  fontFamily: string
  foregroundColor: string
  mutedForegroundColor: string
  radius: string
  spacing: string
  surfaceColor: string
}>

export type GeoThemeComponentContext = Readonly<{
  readonly page: RenderPage
  readonly tokens: GeoThemeTokens
}>

export type GeoHeroProps = GeoThemeComponentContext & Readonly<{ readonly hero: RenderHero }>
export type GeoBreadcrumbsProps = GeoThemeComponentContext &
  Readonly<{ readonly content: RenderContent }>
export type GeoBlockProps = GeoThemeComponentContext & Readonly<{ readonly block: RenderBlock }>
export type GeoListingProps = GeoThemeComponentContext & Readonly<{ readonly listing: RenderListing }>
export type GeoRelatedPagesProps = GeoThemeComponentContext &
  Readonly<{ readonly content: RenderContent }>
export type GeoAuthorProps = GeoThemeComponentContext & Readonly<{ readonly content: RenderContent }>

export type GeoThemeComponents = Readonly<{
  readonly Author: (props: GeoAuthorProps) => ReactNode
  readonly Block: (props: GeoBlockProps) => ReactNode
  readonly Breadcrumbs: (props: GeoBreadcrumbsProps) => ReactNode
  readonly Hero: (props: GeoHeroProps) => ReactNode
  readonly Listing: (props: GeoListingProps) => ReactNode
  readonly RelatedPages: (props: GeoRelatedPagesProps) => ReactNode
}>

export type GeoSlotContext = GeoThemeComponentContext &
  Readonly<{ readonly payload: RenderSlotPayload }>

export type GeoSlotComponent = (context: GeoSlotContext) => ReactNode

export type GeoTheme = Readonly<{
  readonly components?: Partial<GeoThemeComponents>
  readonly slots?: Partial<Record<RenderSlotName, GeoSlotComponent>>
  readonly tokens?: Partial<GeoThemeTokens>
}>

export const DEFAULT_GEO_THEME_TOKENS: GeoThemeTokens = Object.freeze({
  accentColor: "#0f766e",
  backgroundColor: "#ffffff",
  borderColor: "#d1d5db",
  contentWidth: "72rem",
  fontFamily: "system-ui, sans-serif",
  foregroundColor: "#111827",
  mutedForegroundColor: "#4b5563",
  radius: "0.375rem",
  spacing: "1rem",
  surfaceColor: "#f9fafb",
})

export const resolveGeoThemeTokens = (theme: GeoTheme | undefined): GeoThemeTokens =>
  Object.freeze({ ...DEFAULT_GEO_THEME_TOKENS, ...theme?.tokens })
