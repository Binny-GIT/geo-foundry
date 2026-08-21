import { createServer } from "node:http"
import { fileURLToPath } from "node:url"

import next from "next"

import { createRuntime } from "@geo/runtime"

import { siteAEnvironmentOf } from "./environment.mjs"
import { pageHtml, redirectHtml, statusHtml } from "./response.mjs"
import { createSiteAObjectReader } from "./s3-reader.mjs"

const environment = siteAEnvironmentOf()
const reader = createSiteAObjectReader(environment)
const runtime = createRuntime({ store: reader })
const port = Number(process.env.PORT ?? "3101")
const hostname = process.env.HOSTNAME ?? "127.0.0.1"

const nextApp = next({ dev: false, dir: fileURLToPath(new URL("..", import.meta.url)) })
await nextApp.prepare()

const send = (response, status, body, headers = {}) => {
  response.writeHead(status, { "Content-Type": "text/html; charset=utf-8", ...headers })
  response.end(body)
}

const respondPage = (response, result) => {
  const releaseHeader = "releaseId" in result ? { "X-Geo-Release-Id": result.releaseId } : {}
  switch (result.kind) {
    case "page":
    case "not-found":
      send(response, result.status, pageHtml(result.document), releaseHeader)
      return
    case "redirect":
      send(response, result.status, redirectHtml(result.targetUrl), {
        ...releaseHeader,
        Location: result.targetUrl,
      })
      return
    case "gone":
      send(
        response,
        result.status,
        statusHtml({ detail: "This resource is no longer available.", title: "Gone" }),
        releaseHeader,
      )
      return
    case "unknown-host":
      send(
        response,
        result.status,
        statusHtml({ detail: "The requested host is not published.", title: "Not found" }),
      )
      return
    case "unavailable":
      send(
        response,
        result.status,
        statusHtml({
          detail: "The published site is temporarily unavailable.",
          title: "Temporarily unavailable",
        }),
      )
      return
    default:
      throw new TypeError(`SITE_A_UNHANDLED_RESULT:${String(result)}`)
  }
}

const server = createServer(async (request, response) => {
  try {
    const host = request.headers.host ?? ""
    const url = new URL(request.url ?? "/", "http://site-a.local")
    if (url.pathname === "/sitemap.xml") {
      const result = await runtime.resolveSitemap({ hostname: host })
      if (result.kind === "sitemap") {
        response.writeHead(result.status, {
          "Content-Type": result.contentType,
          "X-Geo-Release-Id": result.releaseId,
        })
        response.end(result.body)
        return
      }
      respondPage(response, result)
      return
    }
    respondPage(response, await runtime.resolve({ hostname: host, pathname: url.pathname }))
  } catch {
    send(
      response,
      503,
      statusHtml({
        detail: "The published site is temporarily unavailable.",
        title: "Temporarily unavailable",
      }),
    )
  }
})

server.listen(port, hostname)

const shutdown = () =>
  server.close(() => {
    reader.destroy()
    process.exit(0)
  })
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
