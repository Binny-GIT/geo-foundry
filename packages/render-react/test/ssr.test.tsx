import { Writable } from "node:stream"

import { renderPage } from "@geo/render-core"
import { ArticlePageSchema, canonicalPageFixtures } from "@geo/schema"
import { renderToPipeableStream, renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { GeoHead, GeoPage, serializeGeoJsonLd } from "../src/index.js"

const streamToString = (page: ReturnType<typeof renderPage>): Promise<string> =>
  new Promise((resolve, reject) => {
    let body = ""
    const output = new Writable({
      write(chunk, _encoding, callback) {
        body += chunk.toString()
        callback()
      },
    })
    const stream = renderToPipeableStream(<GeoPage page={page} />, {
      onAllReady() {
        stream.pipe(output)
      },
      onError(error) {
        reject(error)
      },
    })
    output.on("finish", () => resolve(body))
    output.on("error", reject)
  })

describe("Geo SSR", () => {
  it("不渲染署名，当文章没有真人作者时", () => {
    // Given：无作者文章与自定义作者组件。
    const { author: _author, ...document } = canonicalPageFixtures[0]
    const page = renderPage(ArticlePageSchema.parse(document))
    // When：执行 SSR。
    const html = renderToString(
      <GeoPage page={page} theme={{ components: { Author: () => <p>By custom author</p> } }} />,
    )
    // Then：无作者时不调用作者组件。
    expect(html).not.toContain("By ")
    expect(html).not.toContain("/authors/")
  })

  it("保留署名链接，当文章有真人作者时", () => {
    // Given：明确的真人作者。
    const page = renderPage(
      ArticlePageSchema.parse({
        ...canonicalPageFixtures[0],
        author: { id: "author-ada", name: "Ada Chen", url: "https://site-a.test/authors/ada" },
      }),
    )
    // When：执行 SSR。
    const html = renderToString(<GeoPage page={page} />)
    // Then：真人署名继续可见。
    expect(html).toContain('href="https://site-a.test/authors/ada">Ada Chen</a>')
  })

  it.each(canonicalPageFixtures)(
    "renders the $pageType fixture without JavaScript",
    async (fixture) => {
      const page = renderPage(fixture)
      const stringHtml = renderToString(<GeoPage page={page} />)
      const streamingHtml = await streamToString(page)

      expect(stringHtml).toContain(fixture.metadata.title)
      expect(streamingHtml).toContain(fixture.metadata.title)
      if (page.kind === "redirect") {
        expect(stringHtml).toContain(page.targetUrl)
        expect(stringHtml).not.toContain("application/ld+json")
        return
      }
      expect(stringHtml).toContain("<main")
      expect(stringHtml).toContain("Breadcrumb")
      const firstBlock = page.content.blocks[0]
      expect(
        firstBlock === undefined || firstBlock.kind !== "paragraph" ? "" : stringHtml,
      ).toContain(
        firstBlock === undefined || firstBlock.kind !== "paragraph" ? "" : firstBlock.text,
      )
      if (
        page.pageType === "article-list" ||
        page.pageType === "category" ||
        page.pageType === "tag"
      ) {
        expect(stringHtml).toContain("Page listing")
      }
    },
  )

  it("renders every semantic content block and stable output", async () => {
    const page = renderPage(canonicalPageFixtures[0])
    const first = renderToString(<GeoPage page={page} />)
    const second = renderToString(<GeoPage page={page} />)
    const streamed = await streamToString(page)

    expect(first).toBe(second)
    expect(streamed).toContain("Portable structured content.")
    expect(streamed).toContain("<figure")
    expect(streamed).toContain("<blockquote")
    expect(streamed).toContain("<ul")
    expect(streamed).toContain("<table")
    expect(streamed).toContain("<details")
    expect(streamed).toContain("<pre")
    expect(streamed).toContain("<video")
    expect(streamed).toContain("Guide map")
    expect(streamed).toContain("maps")
    expect(streamed).toContain("Product requirements")
  })

  it("renders compiler-owned metadata and script-safe JSON-LD", () => {
    const page = renderPage(canonicalPageFixtures[0])
    const json = serializeGeoJsonLd([
      {
        headline: "</script><img src=x>",
        type: "Article",
        url: "https://site-a.test/guides/article",
      },
    ])
    const html = renderToString(<GeoHead head={page.head} />)

    expect(html).toContain('rel="canonical"')
    expect(html).toContain('name="robots"')
    expect(html).toContain('property="og:title"')
    expect(html).toContain('type="application/ld+json"')
    expect(json).toContain("\\u003c/script\\u003e")
    expect(json).not.toContain("</script>")
  })

  it("uses the theme accent color for links", () => {
    const page = renderPage(canonicalPageFixtures[0])
    const html = renderToString(
      <GeoPage
        page={page}
        theme={{
          tokens: {
            accentColor: "#a16207",
          },
        }}
      />,
    )

    expect(html).toContain("a { color: #a16207; }")
  })

  it("renders fixed slots in their declared order", () => {
    const page = renderPage(canonicalPageFixtures[0])
    const html = renderToString(
      <GeoPage
        page={page}
        theme={{
          slots: {
            "after-body": ({ payload }) => <p data-slot={payload.name}>slot</p>,
            "after-hero": ({ payload }) => <p data-slot={payload.name}>slot</p>,
            "before-body": ({ payload }) => <p data-slot={payload.name}>slot</p>,
            footer: ({ payload }) => <p data-slot={payload.name}>slot</p>,
            "page-header": ({ payload }) => <p data-slot={payload.name}>slot</p>,
          },
        }}
      />,
    )

    expect(html.indexOf('data-slot="page-header"')).toBeLessThan(
      html.indexOf('data-slot="after-hero"'),
    )
    expect(html.indexOf('data-slot="after-hero"')).toBeLessThan(
      html.indexOf('data-slot="before-body"'),
    )
    expect(html.indexOf('data-slot="before-body"')).toBeLessThan(
      html.indexOf('data-slot="after-body"'),
    )
    expect(html.indexOf('data-slot="after-body"')).toBeLessThan(html.indexOf('data-slot="footer"'))
  })
})
