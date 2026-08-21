import type { ReactNode } from "react"

import { renderPage, type RenderPage } from "@geo/render-core"
import type { PageDocument } from "@geo/schema"

import { GeoProvider, useGeoPage } from "./context.js"
import { ContentBody } from "./content.js"
import type { GeoTheme } from "./theme.js"

const Slot = ({
  name,
}: Readonly<{
  readonly name: RenderPage extends infer _
    ? "page-header" | "after-hero" | "before-body" | "after-body" | "footer"
    : never
}>): ReactNode => {
  const { page, slots, tokens } = useGeoPage()
  if (page.kind === "redirect") {
    return null
  }
  const payload = page.content.slots.find((candidate) => candidate.name === name)
  const slot = slots[name]
  return payload === undefined || slot === undefined ? null : slot({ page, payload, tokens })
}

const RenderedGeoPage = (): ReactNode => {
  const { page, tokens } = useGeoPage()
  if (page.kind === "redirect") {
    return (
      <main style={{ color: tokens.foregroundColor, fontFamily: tokens.fontFamily }}>
        <h1>{page.head.metadata.title}</h1>
        <p>
          This page has moved. <a href={page.targetUrl}>Continue to the current page</a>.
        </p>
      </main>
    )
  }
  return (
    <main
      style={{
        backgroundColor: tokens.backgroundColor,
        color: tokens.foregroundColor,
        fontFamily: tokens.fontFamily,
      }}
    >
      <Slot name="page-header" />
      <ContentBody page={page} />
      <Slot name="footer" />
    </main>
  )
}

export type GeoPageProps = Readonly<{
  readonly page: RenderPage
  readonly theme?: GeoTheme
}>

export const GeoPage = ({ page, theme }: GeoPageProps): ReactNode => (
  <GeoProvider page={page} {...(theme === undefined ? {} : { theme })}>
    <RenderedGeoPage />
  </GeoProvider>
)

export type GeoDocumentPageProps = Readonly<{
  readonly document: PageDocument
  readonly theme?: GeoTheme
}>

export const GeoDocumentPage = ({ document, theme }: GeoDocumentPageProps): ReactNode => (
  <GeoPage page={renderPage(document)} {...(theme === undefined ? {} : { theme })} />
)
