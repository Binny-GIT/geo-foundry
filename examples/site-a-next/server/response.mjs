import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { renderPage } from "@geo/render-core"
import { GeoHead, GeoPage } from "@geo/render-react"

import { siteATheme } from "./theme.mjs"

const element = createElement

const shell = ({ body, head = null }) =>
  `<!doctype html>${renderToStaticMarkup(element("html", { lang: "en" }, element("head", null, head), element("body", null, body)))}`

export const pageHtml = (document) => {
  const page = renderPage(document)
  return shell({
    body: element(GeoPage, { page, theme: siteATheme }),
    head: element(GeoHead, { head: page.head }),
  })
}

export const statusHtml = ({ detail, title }) =>
  shell({
    body: element("main", null, element("h1", null, title), element("p", null, detail)),
    head: element("title", null, title),
  })

const escapeHtml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")

export const redirectHtml = (targetUrl) =>
  `<!doctype html><html lang="en"><head><meta name="robots" content="noindex,follow"></head><body><main><h1>Moved</h1><p><a href="${escapeHtml(targetUrl)}">Continue to the current page</a></p></main></body></html>`
