/*
 * JSON 出口需要"渲染好的正文 HTML"，供 NKMed 之类没有自己 Markdown/富文本
 * 渲染能力的站点直接 DOMPurify 清洗后嵌入（见开发计划决策 #11）。
 *
 * @geo/render-react 有现成的 GeoPage/ContentBody，但 ContentBody 不是包的
 * 公开导出（见 packages/render-react/src/index.ts），而且 GeoPage 渲染的是
 * 整页外壳（<main> + 主题背景色 + page-header/footer 插槽），不是"正文"
 * 本身——本批次不能修改 packages/render-react 去导出 ContentBody，所以这里
 * 用 @geo/render-core 公开导出的 RenderPage/RenderContent/RenderBlock 等
 * 纯数据类型，独立写一份只产出 <article> 正文片段的渲染器（结构上对应
 * ContentBody 去掉主题插槽与外层配色后的样子）。用 createElement 而不是
 * JSX，避免为一个渲染小工具引入新的 tsconfig jsx 维度。
 */
import { createElement as h, Fragment, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import type {
  RenderBlock,
  RenderContent,
  RenderFigureImage,
  RenderListing,
  RenderPage,
} from "@geo/render-core"

const assertNever = (value: never): never => {
  throw new TypeError(`DELIVERY_BODY_HTML_UNSUPPORTED_BLOCK:${String(value)}`)
}

const imageFigureNode = (
  image: RenderFigureImage,
  options?: { readonly id: string | undefined; readonly key: string | undefined },
): ReactNode =>
  h(
    "figure",
    { id: options?.id, key: options?.key },
    h("img", { alt: image.alt, height: image.height, loading: "lazy", src: image.src, width: image.width }),
    image.caption === undefined ? null : h("figcaption", null, image.caption),
  )

const heroNode = (hero: RenderContent["hero"], title: string): ReactNode => {
  if (hero === undefined) {
    return h("h1", null, title)
  }
  return h(
    "header",
    null,
    h("h1", null, title),
    hero.title === title ? null : h("p", null, hero.title),
    hero.summary === undefined ? null : h("p", null, hero.summary),
    hero.image === undefined ? null : imageFigureNode(hero.image),
  )
}

const HEADING_TAG = { 2: "h2", 3: "h3", 4: "h4", 5: "h5", 6: "h6" } as const

const breadcrumbsNode = (content: RenderContent): ReactNode =>
  h(
    "nav",
    { "aria-label": "Breadcrumb" },
    h(
      "ol",
      null,
      content.breadcrumbs.map((breadcrumb) =>
        h("li", { key: breadcrumb.pathname }, h("a", { href: breadcrumb.pathname }, breadcrumb.title)),
      ),
    ),
  )

const authorNode = (content: RenderContent): ReactNode => {
  if (content.author === undefined) return null
  return h(
    "p",
    null,
    "By ",
    content.author.url === undefined
      ? content.author.name
      : h("a", { href: content.author.url }, content.author.name),
  )
}

const blockNode = (block: RenderBlock, index: number): ReactNode => {
  const key = block.id ?? `${block.kind}-${index}`
  switch (block.kind) {
    case "paragraph":
      return h("p", { id: block.id, key }, block.text)
    case "heading":
      return h(HEADING_TAG[block.level], { id: block.id, key }, block.text)
    case "figure-image":
      return imageFigureNode(block, { id: block.id, key })
    case "quote":
      return h(
        "blockquote",
        { id: block.id, key },
        h("p", null, block.text),
        block.attribution === undefined
          ? null
          : h(
              "footer",
              null,
              block.citeUrl === undefined ? block.attribution : h("cite", null, block.attribution),
            ),
      )
    case "ordered-list":
      return h(
        "ol",
        { id: block.id, key },
        block.items.map((item, itemIndex) => h("li", { key: `${key}-${itemIndex}` }, item)),
      )
    case "unordered-list":
      return h(
        "ul",
        { id: block.id, key },
        block.items.map((item, itemIndex) => h("li", { key: `${key}-${itemIndex}` }, item)),
      )
    case "table":
      return h(
        "table",
        { id: block.id, key },
        block.caption === undefined ? null : h("caption", null, block.caption),
        h(
          "thead",
          null,
          h(
            "tr",
            null,
            block.columns.map((column) => h("th", { key: column, scope: "col" }, column)),
          ),
        ),
        h(
          "tbody",
          null,
          block.rows.map((row, rowIndex) =>
            h(
              "tr",
              { key: `${key}-${rowIndex}` },
              row.map((cell, cellIndex) => h("td", { key: `${key}-${rowIndex}-${cellIndex}` }, cell)),
            ),
          ),
        ),
      )
    case "faq":
      return h(
        "section",
        { id: block.id, key },
        block.items.map((item, itemIndex) =>
          h(
            "details",
            { key: `${key}-${itemIndex}` },
            h("summary", null, item.question),
            h("p", null, item.answer),
          ),
        ),
      )
    case "callout":
      return h(
        "aside",
        { "data-tone": block.tone, id: block.id, key },
        block.title === undefined ? null : h("strong", null, block.title),
        h("p", null, block.text),
      )
    case "code":
      return h(
        "figure",
        { id: block.id, key },
        block.caption === undefined ? null : h("figcaption", null, block.caption),
        h("pre", null, h("code", { "data-language": block.language }, block.code)),
      )
    case "video":
      return h(
        "figure",
        { id: block.id, key },
        h(
          "video",
          { controls: true, poster: block.poster, src: block.src, title: block.title },
          h("a", { href: block.src }, block.title),
        ),
        block.transcript === undefined ? null : h("figcaption", null, block.transcript),
      )
    case "embed":
      return h(
        "p",
        { id: block.id, key },
        h("a", { href: block.url }, `${block.title} (${block.provider})`),
      )
    case "references":
      return h(
        "section",
        { id: block.id, key },
        h("h2", null, "References"),
        h(
          "ol",
          null,
          block.items.map((item) =>
            h("li", { key: item.citation.id }, h("a", { href: item.citation.url }, item.label)),
          ),
        ),
      )
    default:
      return assertNever(block)
  }
}

const relatedPagesNode = (content: RenderContent): ReactNode => {
  if (content.relatedPages.length === 0) return null
  return h(
    "section",
    null,
    h("h2", null, "Related pages"),
    h(
      "ul",
      null,
      content.relatedPages.map((page) =>
        h("li", { key: page.pageId }, h("a", { href: page.pathname }, page.title)),
      ),
    ),
  )
}

const listingNode = (listing: RenderListing): ReactNode =>
  h(
    Fragment,
    null,
    h(
      "section",
      { "aria-label": "Page listing" },
      h(
        "ul",
        null,
        listing.items.map((item) => h("li", { key: item.pageId }, h("a", { href: item.pathname }, item.title))),
      ),
    ),
    listing.pagination === undefined
      ? null
      : h(
          "nav",
          { "aria-label": "Pagination" },
          listing.pagination.previousPathname === undefined
            ? null
            : h("a", { href: listing.pagination.previousPathname }, "Previous"),
          h(
            "span",
            null,
            `Page ${listing.pagination.page} of ${listing.pagination.totalPages}`,
          ),
          listing.pagination.nextPathname === undefined
            ? null
            : h("a", { href: listing.pagination.nextPathname }, "Next"),
        ),
  )

const contentBodyNode = (page: Exclude<RenderPage, { readonly kind: "redirect" }>): ReactNode => {
  const content = page.content
  return h(
    "article",
    null,
    breadcrumbsNode(content),
    heroNode(content.hero, page.head.metadata.title),
    authorNode(content),
    page.pageType === "article-list" || page.pageType === "category" || page.pageType === "tag"
      ? listingNode(page.listing)
      : null,
    content.blocks.map((block, index) => blockNode(block, index)),
    relatedPagesNode(content),
  )
}

/** 把 renderPage(document) 的结果渲染为正文 HTML 字符串；redirect 页没有正文，返回空串。 */
export const renderBodyHtml = (page: RenderPage): string => {
  if (page.kind === "redirect") return ""
  return renderToStaticMarkup(contentBodyNode(page))
}
