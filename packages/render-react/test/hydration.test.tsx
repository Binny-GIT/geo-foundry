import { renderPage } from "@geo/render-core"
import { articleListPageFixture, articlePageFixture, notFoundPageFixture, redirectPageFixture } from "@geo/schema"
import { hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { GeoPage } from "../src/index.js"

const fixtures = [articlePageFixture, articleListPageFixture, redirectPageFixture, notFoundPageFixture] as const

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe("Geo hydration", () => {
  it.each(fixtures)("hydrates $pageType without a mismatch", async (fixture) => {
    const page = renderPage(fixture)
    const errors: unknown[] = []
    const warns: unknown[] = []
    const recoverable: unknown[] = []
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...arguments_) => errors.push(arguments_))
    const warnSpy = vi.spyOn(console, "warn").mockImplementation((...arguments_) => warns.push(arguments_))
    const container = document.createElement("div")
    container.innerHTML = renderToString(<GeoPage page={page} />)
    document.body.append(container)

    const root = hydrateRoot(container, <GeoPage page={page} />, {
      onRecoverableError(error) {
        recoverable.push(error)
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    root.unmount()

    expect(errorSpy).toHaveBeenCalledTimes(0)
    expect(warnSpy).toHaveBeenCalledTimes(0)
    expect(recoverable).toEqual([])
  })
})
