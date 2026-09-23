/*
 * 交付服务的依赖注入工厂函数：createDeliveryApp({ runtime, siteKeyring, ... })。
 * 由 examples/site-b-express 的 createSiteBApp({ runtime }) 产品化而来，
 * 流式渲染 HTML 出口的写法（writeHead + renderToPipeableStream）与缓存头
 * 约定直接沿用；新增的部分是 JSON 出口、sitemap 出口、media 出口和站点
 * 密钥鉴权。
 *
 * 路由不使用 Express 5 的动态路径参数（`:param`/通配符）——与示例保持
 * 同一种防御性写法：示例本身也只用了一个静态路径（/sitemap.xml）加一个
 * 完全不带路径的兜底 app.use()，从不依赖 path-to-regexp 的语法。这里同样
 * 只注册一个 app.use(handler)，路由分发在处理函数内部用普通正则手写，
 * 顺带也让"站点身份不能从路径/请求头以外的地方推断"这条约束更容易审查。
 */
import { createElement as h, type ReactNode } from "react"
import { renderToPipeableStream } from "react-dom/server"
import express, { type Application, type Request, type Response } from "express"

import { renderPage } from "@geo/render-core"
import { GeoHead, GeoPage } from "@geo/render-react"
import type { PageDocument } from "@geo/schema"

import { authorizeSiteRequest, quotaBucketKeyOf, QuotaTracker } from "./auth/site-auth.js"
import type { SiteKeyring } from "./config/site-keyring.js"
import { absolutizePageDocumentMedia } from "./render/absolute-media.js"
import { renderBodyHtml } from "./render/body-html.js"
import type { DeliveryRuntime } from "./runtime/delivery-runtime.js"

export type CreateDeliveryAppOptions = {
  /** 测试用可注入时钟；生产默认 Date.now。 */
  readonly clock?: () => number
  /** 对外公网地址，用于把 JSON/HTML 里的站内媒体引用改写为绝对地址。 */
  readonly publicOrigin: string
  /** 测试用可注入配额计数器；生产默认新建一个进程内单例。 */
  readonly quota?: QuotaTracker
  readonly runtime: DeliveryRuntime
  readonly siteKeyring: SiteKeyring
}

const REVALIDATE = "public, max-age=0, must-revalidate"
const MEDIA_CACHE_CONTROL = "public, max-age=31536000, immutable"
const NO_STORE = "no-store"

const JSON_PAGE_PATTERN = /^\/v1\/sites\/([^/]+)\/pages(\/.*)?$/
const SITEMAP_PATTERN = /^\/v1\/sites\/([^/]+)\/sitemap\.xml$/
const MEDIA_PATTERN = /^\/v1\/sites\/([^/]+)\/media\/([^/]+)$/

const decodeSegment = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const firstHeaderValue = (value: string | readonly string[] | undefined): string | undefined => {
  if (value === undefined) return undefined
  return Array.isArray(value) ? value[0] : (value as string)
}

const mediaBaseUrlOf = (origin: string, host: string): string =>
  `${origin}/v1/sites/${encodeURIComponent(host)}/media`

const sendJson = (
  response: Response,
  status: number,
  body: unknown,
  cacheControl: string,
  extraHeaders?: Record<string, string>,
): void => {
  if (response.headersSent) return
  response.writeHead(status, {
    "Cache-Control": cacheControl,
    "Content-Type": "application/json; charset=utf-8",
    ...extraHeaders,
  })
  response.end(JSON.stringify(body))
}

const sendBinary = (
  response: Response,
  status: number,
  body: Uint8Array,
  headers: Record<string, string>,
): void => {
  if (response.headersSent) return
  response.writeHead(status, headers)
  response.end(Buffer.from(body))
}

const pageShellNode = (document: PageDocument): ReactNode => {
  const page = renderPage(document)
  return h(
    "html",
    { lang: "en" },
    h("head", null, h(GeoHead, { head: page.head })),
    h("body", null, h(GeoPage, { page })),
  )
}

const statusShellNode = (title: string, detail: string): ReactNode =>
  h(
    "html",
    { lang: "en" },
    h("head", null, h("title", null, title)),
    h("body", null, h("main", null, h("h1", null, title), h("p", null, detail))),
  )

const streamHtml = (
  response: Response,
  status: number,
  headers: Record<string, string>,
  node: ReactNode,
): void => {
  if (response.headersSent) return
  response.writeHead(status, { "Content-Type": "text/html; charset=utf-8", ...headers })
  response.write("<!doctype html>")
  const { pipe } = renderToPipeableStream(node, {
    onError() {
      // 流式渲染中途出错时无法再改状态码；仅静默失败，交由客户端按连接中断处理，
      // 与 examples/site-b-express 的既有行为一致。
    },
  })
  pipe(response)
}

type AuthOutcome = { readonly ok: false } | { readonly ok: true }

/** 站点密钥鉴权 + 配额，未通过时经 respondUnauthorized 回调写响应并返回 ok:false。 */
const authorizeOrRespond = (
  authorizationHeader: string | undefined,
  siteKeyring: SiteKeyring,
  quota: QuotaTracker,
  host: string,
  now: number,
  respondUnauthorized: (status: number, code: string, extra?: Record<string, string>) => void,
): AuthOutcome => {
  const decision = authorizeSiteRequest(siteKeyring, host, authorizationHeader, now)
  if (decision.kind !== "ok") {
    const normalizedHost = host.trim().toLowerCase()
    const failureBucket = siteKeyring.has(normalizedHost) ? normalizedHost : "unknown-host"
    const check = quota.consume(`auth-failure\u0000${failureBucket}`, 30, now)
    if (!check.allowed) {
      respondUnauthorized(429, "DELIVERY_AUTH_RATE_LIMITED", {
        "Retry-After": String(check.retryAfterSeconds),
      })
      return { ok: false }
    }
  }
  switch (decision.kind) {
    case "missing-credentials":
      respondUnauthorized(401, "DELIVERY_AUTH_REQUIRED", { "WWW-Authenticate": "Bearer" })
      return { ok: false }
    case "invalid-key":
    case "revoked":
    case "expired":
      respondUnauthorized(403, "DELIVERY_AUTH_KEY_INVALID")
      return { ok: false }
    case "ok": {
      const bucketKey = quotaBucketKeyOf(host, decision.entry)
      const check = quota.consume(bucketKey, decision.entry.quotaPerMinute, now)
      if (!check.allowed) {
        respondUnauthorized(429, "DELIVERY_QUOTA_EXCEEDED", {
          "Retry-After": String(check.retryAfterSeconds),
        })
        return { ok: false }
      }
      return { ok: true }
    }
  }
}

export const createDeliveryApp = (options: CreateDeliveryAppOptions): Application => {
  const clock = options.clock ?? Date.now
  const quota = options.quota ?? new QuotaTracker()
  const { runtime, siteKeyring } = options

  const handleHealthz = (response: Response): void => {
    sendJson(response, 200, { status: "ok" }, NO_STORE)
  }

  const handleJsonPage = async (
    response: Response,
    host: string,
    sitePathname: string,
    origin: string,
  ): Promise<void> => {
    const result = await runtime.resolve({ hostname: host, pathname: sitePathname })
    const mediaBaseUrl = mediaBaseUrlOf(origin, host)
    switch (result.kind) {
      case "page":
      case "not-found": {
        const document = absolutizePageDocumentMedia(result.document, mediaBaseUrl)
        sendJson(
          response,
          result.status,
          {
            bodyHtml: renderBodyHtml(renderPage(document)),
            document,
            releaseId: result.releaseId,
            siteId: result.siteId,
          },
          REVALIDATE,
          { "X-Geo-Release-Id": result.releaseId },
        )
        return
      }
      case "redirect": {
        const document = absolutizePageDocumentMedia(result.document, mediaBaseUrl)
        sendJson(
          response,
          result.status,
          {
            bodyHtml: renderBodyHtml(renderPage(document)),
            document,
            redirect: { statusCode: 301 as const, targetUrl: result.targetUrl },
            releaseId: result.releaseId,
            siteId: result.siteId,
          },
          REVALIDATE,
          { "X-Geo-Release-Id": result.releaseId, Location: result.targetUrl },
        )
        return
      }
      case "gone":
        sendJson(
          response,
          result.status,
          {
            error: { code: "DELIVERY_PAGE_GONE" },
            releaseId: result.releaseId,
            siteId: result.siteId,
          },
          NO_STORE,
          { "X-Geo-Release-Id": result.releaseId },
        )
        return
      case "unknown-host":
        sendJson(response, result.status, { error: { code: "DELIVERY_UNKNOWN_HOST" } }, NO_STORE)
        return
      case "unavailable":
        sendJson(response, result.status, { error: { code: result.code } }, NO_STORE)
        return
    }
  }

  const handleSitemap = async (response: Response, host: string): Promise<void> => {
    const result = await runtime.resolveSitemap({ hostname: host })
    switch (result.kind) {
      case "sitemap":
        sendBinary(response, result.status, result.body, {
          "Cache-Control": REVALIDATE,
          "Content-Type": result.contentType,
          "X-Geo-Release-Id": result.releaseId,
        })
        return
      case "unknown-host":
        sendJson(response, result.status, { error: { code: "DELIVERY_UNKNOWN_HOST" } }, NO_STORE)
        return
      case "unavailable":
        sendJson(response, result.status, { error: { code: result.code } }, NO_STORE)
        return
    }
  }

  const handleMedia = async (response: Response, host: string, filename: string): Promise<void> => {
    const result = await runtime.resolveMedia({ filename, hostname: host })
    switch (result.kind) {
      case "media":
        sendBinary(response, result.status, result.body, {
          "Cache-Control": MEDIA_CACHE_CONTROL,
          "Content-Type": result.contentType,
          ETag: result.etag,
          "X-Geo-Release-Id": result.releaseId,
        })
        return
      case "not-found":
        sendJson(response, result.status, { error: { code: "DELIVERY_MEDIA_NOT_FOUND" } }, NO_STORE)
        return
      case "unknown-host":
        sendJson(response, result.status, { error: { code: "DELIVERY_UNKNOWN_HOST" } }, NO_STORE)
        return
      case "unavailable":
        sendJson(response, result.status, { error: { code: result.code } }, NO_STORE)
        return
    }
  }

  const handleHtmlFallback = async (
    response: Response,
    host: string,
    pathname: string,
    origin: string,
  ): Promise<void> => {
    const result = await runtime.resolve({ hostname: host, pathname })
    const mediaBaseUrl = mediaBaseUrlOf(origin, host)
    switch (result.kind) {
      case "page":
      case "not-found": {
        const document = absolutizePageDocumentMedia(result.document, mediaBaseUrl)
        streamHtml(
          response,
          result.status,
          { "Cache-Control": REVALIDATE, "X-Geo-Release-Id": result.releaseId },
          pageShellNode(document),
        )
        return
      }
      case "redirect": {
        const document = absolutizePageDocumentMedia(result.document, mediaBaseUrl)
        streamHtml(
          response,
          result.status,
          {
            "Cache-Control": REVALIDATE,
            Location: result.targetUrl,
            "X-Geo-Release-Id": result.releaseId,
          },
          pageShellNode(document),
        )
        return
      }
      case "gone":
        streamHtml(
          response,
          result.status,
          { "Cache-Control": NO_STORE, "X-Geo-Release-Id": result.releaseId },
          statusShellNode("Gone", "This resource is no longer available."),
        )
        return
      case "unknown-host":
        streamHtml(
          response,
          result.status,
          { "Cache-Control": NO_STORE },
          statusShellNode("Not found", "The requested host is not published."),
        )
        return
      case "unavailable":
        streamHtml(
          response,
          result.status,
          { "Cache-Control": NO_STORE },
          statusShellNode(
            "Temporarily unavailable",
            "The published site is temporarily unavailable.",
          ),
        )
        return
    }
  }

  const app = express()
  app.disable("x-powered-by")

  app.use(async (request: Request, response: Response) => {
    try {
      if (request.method !== "GET") {
        sendJson(response, 405, { error: { code: "DELIVERY_METHOD_NOT_ALLOWED" } }, NO_STORE)
        return
      }
      const url = new URL(request.url ?? "/", "http://delivery.local")
      const pathname = url.pathname

      if (pathname === "/healthz") {
        handleHealthz(response)
        return
      }

      const now = clock()
      const authorizationHeader = firstHeaderValue(request.headers["authorization"])
      const respondUnauthorized = (
        status: number,
        code: string,
        extra?: Record<string, string>,
      ): void => sendJson(response, status, { error: { code } }, NO_STORE, extra)

      const jsonPageMatch = JSON_PAGE_PATTERN.exec(pathname)
      if (jsonPageMatch !== null) {
        const host = decodeSegment(jsonPageMatch[1] ?? "")
        const outcome = authorizeOrRespond(
          authorizationHeader,
          siteKeyring,
          quota,
          host,
          now,
          respondUnauthorized,
        )
        if (!outcome.ok) return
        const rest = jsonPageMatch[2]
        const sitePathname = rest === undefined || rest.length === 0 ? "/" : rest
        await handleJsonPage(response, host, sitePathname, options.publicOrigin)
        return
      }

      const sitemapMatch = SITEMAP_PATTERN.exec(pathname)
      if (sitemapMatch !== null) {
        const host = decodeSegment(sitemapMatch[1] ?? "")
        const outcome = authorizeOrRespond(
          authorizationHeader,
          siteKeyring,
          quota,
          host,
          now,
          respondUnauthorized,
        )
        if (!outcome.ok) return
        await handleSitemap(response, host)
        return
      }

      const mediaMatch = MEDIA_PATTERN.exec(pathname)
      if (mediaMatch !== null) {
        const host = decodeSegment(mediaMatch[1] ?? "")
        const filename = decodeSegment(mediaMatch[2] ?? "")
        const outcome = authorizeOrRespond(
          authorizationHeader,
          siteKeyring,
          quota,
          host,
          now,
          respondUnauthorized,
        )
        if (!outcome.ok) return
        await handleMedia(response, host, filename)
        return
      }

      // 其余路径：第 3 层 HTML 出口，站点身份只认 X-Geo-Site-Host 头
      // （Host 头在 Cloudflare 隧道之后固定是交付服务自己的主机名，不能用于站点识别）。
      const host = firstHeaderValue(request.headers["x-geo-site-host"]) ?? ""
      const outcome = authorizeOrRespond(
        authorizationHeader,
        siteKeyring,
        quota,
        host,
        now,
        respondUnauthorized,
      )
      if (!outcome.ok) return
      await handleHtmlFallback(response, host, pathname, options.publicOrigin)
    } catch {
      if (response.headersSent) {
        response.end()
        return
      }
      sendJson(response, 503, { error: { code: "DELIVERY_INTERNAL_ERROR" } }, NO_STORE)
    }
  })

  return app
}
