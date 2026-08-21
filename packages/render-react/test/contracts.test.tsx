import { renderPage } from "@geo/render-core"
import { canonicalPageFixtures } from "@geo/schema"
import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { GEO_RENDER_ERROR, GeoRenderError, GeoPage, useGeoPage } from "../src/index.js"

const ContextConsumer = () => {
  useGeoPage()
  return null
}

const expectGeoError = (action: () => unknown, code: string): void => {
  try {
    action()
    throw new Error("expected GeoRenderError")
  } catch (error) {
    expect(error).toBeInstanceOf(GeoRenderError)
    expect((error as GeoRenderError).code).toBe(code)
  }
}

describe("Geo theme contracts", () => {
  it("rejects a missing provider context", () => {
    expectGeoError(() => renderToString(<ContextConsumer />), GEO_RENDER_ERROR.MISSING_PROVIDER)
  })

  it("rejects undeclared theme component and slot names", () => {
    const page = renderPage(canonicalPageFixtures[0])
    expectGeoError(
      () => renderToString(<GeoPage page={page} theme={{ components: { Unknown: () => null } as never }} />),
      GEO_RENDER_ERROR.THEME_COMPONENT_INVALID,
    )
    expectGeoError(
      () => renderToString(<GeoPage page={page} theme={{ slots: { unknown: () => null } as never }} />),
      GEO_RENDER_ERROR.THEME_SLOT_INVALID,
    )
  })

  it("surfaces a slot exception instead of omitting it", () => {
    const page = renderPage(canonicalPageFixtures[0])
    expect(() =>
      renderToString(
        <GeoPage
          page={page}
          theme={{
            slots: {
              footer: () => {
                throw new Error("slot failed")
              },
            },
          }}
        />,
      ),
    ).toThrow("slot failed")
  })

  it("applies custom tokens and components only through declared surfaces", () => {
    const page = renderPage(canonicalPageFixtures[0])
    const html = renderToString(
      <GeoPage
        page={page}
        theme={{
          components: { Hero: ({ hero }) => <header><h1>Theme: {hero.title}</h1></header> },
          tokens: { foregroundColor: "#123456" },
        }}
      />,
    )
    expect(html).toContain("Theme:")
    expect(html).toContain("Geo Foundry")
    expect(html).toContain("#123456")
  })
})
