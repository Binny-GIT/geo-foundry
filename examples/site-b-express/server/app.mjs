import express from "express"
import { createElement } from "react"
import { renderToPipeableStream } from "react-dom/server"

import { renderPage } from "@geo/render-core"
import { GeoHead, GeoPage } from "@geo/render-react"

import { siteBTheme } from "./theme.mjs"

const element = createElement
const REVALIDATE = "public, max-age=0, must-revalidate"

const pageShell = (document) => {
  const page = renderPage(document)
  return element(
    "html",
    { lang: "en" },
    element("head", null, element(GeoHead, { head: page.head })),
    element("body", null, element(GeoPage, { page, theme: siteBTheme })),
  )
}

const statusShell = (title, detail) =>
  element(
    "html",
    { lang: "en" },
    element("head", null, element("title", null, title)),
    element(
      "body",
      null,
      element("main", null, element("h1", null, title), element("p", null, detail)),
    ),
  )

const streamElement = (response, status, headers, target) => {
  response.writeHead(status, { "Content-Type": "text/html; charset=utf-8", ...headers })
  response.write("<!doctype html>")
  const { pipe } = renderToPipeableStream(target, {
    onError(error) {
      response.locals?.logger?.(error)
    },
  })
  pipe(response)
}

const respond = (response, result) => {
  switch (result.kind) {
    case "page":
    case "not-found":
      streamElement(
        response,
        result.status,
        { "Cache-Control": REVALIDATE, "X-Geo-Release-Id": result.releaseId },
        pageShell(result.document),
      )
      return
    case "redirect":
      streamElement(
        response,
        result.status,
        {
          "Cache-Control": REVALIDATE,
          Location: result.targetUrl,
          "X-Geo-Release-Id": result.releaseId,
        },
        pageShell(result.document),
      )
      return
    case "gone":
      streamElement(
        response,
        result.status,
        { "Cache-Control": "no-store", "X-Geo-Release-Id": result.releaseId },
        statusShell("Gone", "This resource is no longer available."),
      )
      return
    case "unknown-host":
      streamElement(
        response,
        result.status,
        { "Cache-Control": "no-store" },
        statusShell("Not found", "The requested host is not published."),
      )
      return
    case "unavailable":
      streamElement(
        response,
        result.status,
        { "Cache-Control": "no-store" },
        statusShell("Temporarily unavailable", "The published site is temporarily unavailable."),
      )
      return
    default:
      throw new TypeError(`SITE_B_UNHANDLED_RESULT:${String(result)}`)
  }
}

export const createSiteBApp = ({ runtime }) => {
  const app = express()
  app.disable("x-powered-by")
  app.get("/sitemap.xml", async (request, response) => {
    const result = await runtime.resolveSitemap({ hostname: request.headers.host ?? "" })
    if (result.kind === "sitemap") {
      response.writeHead(result.status, {
        "Cache-Control": REVALIDATE,
        "Content-Type": result.contentType,
        "X-Geo-Release-Id": result.releaseId,
      })
      response.end(result.body)
      return
    }
    respond(response, result)
  })
  app.use(async (request, response) => {
    try {
      const url = new URL(request.url, "http://site-b.local")
      respond(
        response,
        await runtime.resolve({ hostname: request.headers.host ?? "", pathname: url.pathname }),
      )
    } catch {
      streamElement(
        response,
        503,
        { "Cache-Control": "no-store" },
        statusShell("Temporarily unavailable", "The published site is temporarily unavailable."),
      )
    }
  })
  return app
}
