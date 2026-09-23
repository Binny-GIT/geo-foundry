/*
 * 端到端 HTTP 层测试：真起一个 createDeliveryApp() 监听临时端口，用
 * node:fetch 打真实请求，覆盖计划文档列出的验收面——
 * healthz / JSON 页 / sitemap / media / HTML 回落 / 未知站点 404，
 * 以及鉴权的 401/403（错密钥、吊销、过期）与配额 429。
 */
import type { Server } from "node:http"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createDeliveryApp } from "../../src/app.js"
import { parseSiteKeyring } from "../../src/config/site-keyring.js"
import { createDeliveryRuntime } from "../../src/runtime/delivery-runtime.js"
import {
  buildSiteRelease,
  fixtureMediaBytes,
  installRouting,
  MemoryObjectReader,
} from "./fixtures.js"

const VALID_KEY = "valid-site-a-key-0000000000"
const REVOKED_KEY = "revoked-site-a-key-000000000"
const EXPIRED_KEY = "expired-site-a-key-000000000"
const LOW_QUOTA_KEY = "low-quota-site-a-key-0000000"
const UNKNOWN_HOST_KEY = "valid-unknown-host-key-00000"

const keyring = parseSiteKeyring({
  sites: {
    "site-a.test": {
      keys: [
        { expiresAt: null, key: VALID_KEY, quotaPerMinute: 1000, status: "active" },
        { expiresAt: null, key: REVOKED_KEY, quotaPerMinute: 1000, status: "revoked" },
        {
          expiresAt: "2020-01-01T00:00:00.000Z",
          key: EXPIRED_KEY,
          quotaPerMinute: 1000,
          status: "active",
        },
        { expiresAt: null, key: LOW_QUOTA_KEY, quotaPerMinute: 1, status: "active" },
      ],
    },
    "unknown-to-runtime.test": {
      keys: [{ expiresAt: null, key: UNKNOWN_HOST_KEY, quotaPerMinute: 1000, status: "active" }],
    },
  },
})

const setup = async () => {
  const store = new MemoryObjectReader()
  const mapBytes = fixtureMediaBytes("map.webp")
  const release = await buildSiteRelease({
    canonicalDomain: "site-a.test",
    media: [{ bytes: mapBytes, contentType: "image/webp", filename: "map.webp" }],
    releaseId: "release-a-v1",
    siteId: "site-a",
    store,
  })
  store.put(release.pointerKey, release.pointerBody)
  await installRouting(store, "routing-v1", [
    { canonical: true, host: "site-a.test", siteId: "site-a" },
  ])

  const runtime = createDeliveryRuntime({ store })
  const app = createDeliveryApp({
    publicOrigin: "https://geo-delivery.test",
    runtime,
    siteKeyring: keyring,
  })
  const server = app.listen(0, "127.0.0.1")
  await new Promise<void>((resolveReady) => server.once("listening", () => resolveReady()))
  const address = server.address()
  if (typeof address !== "object" || address === null) throw new Error("failed to bind test server")
  return { mapBytes, port: address.port, release, server }
}

describe("createDeliveryApp routes", () => {
  let world: Awaited<ReturnType<typeof setup>>
  let server: Server

  beforeAll(async () => {
    world = await setup()
    server = world.server
  })

  afterAll(async () => {
    await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()))
  })

  const baseUrl = () => `http://127.0.0.1:${world.port}`
  const authed = (token = VALID_KEY) => ({ Authorization: `Bearer ${token}` })

  it("answers /healthz without any credentials and without touching the object store", async () => {
    const response = await fetch(`${baseUrl()}/healthz`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "ok" })
  })

  it("uses the configured media origin even when forwarded headers are forged", async () => {
    const response = await fetch(`${baseUrl()}/v1/sites/site-a.test/pages/guides/article`, {
      headers: {
        ...authed(),
        "X-Forwarded-Host": "attacker.test",
        "X-Forwarded-Proto": "https",
      },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { bodyHtml: string }
    expect(body.bodyHtml).toContain("https://geo-delivery.test/v1/sites/site-a.test/media/map.webp")
    expect(body.bodyHtml).not.toContain("attacker.test")
  })

  it("serves the JSON page export with the PageDocument, rendered body HTML, and absolute media URLs", async () => {
    const response = await fetch(`${baseUrl()}/v1/sites/site-a.test/pages/guides/article`, {
      headers: authed(),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("x-geo-release-id")).toBe("release-a-v1")
    const body = (await response.json()) as {
      bodyHtml: string
      document: { body: readonly { src?: string; type: string }[] }
      releaseId: string
      siteId: string
    }
    expect(body.releaseId).toBe("release-a-v1")
    expect(body.siteId).toBe("site-a")
    expect(body.bodyHtml).toContain("Portable structured content.")
    expect(body.bodyHtml).toContain("https://geo-delivery.test/v1/sites/site-a.test/media/map.webp")
    const imageBlock = body.document.body.find((block) => block.type === "image")
    expect(imageBlock?.src).toBe("https://geo-delivery.test/v1/sites/site-a.test/media/map.webp")
  })

  it("returns 410 for a gone pathname and 404 with a rendered not-found document for an unmapped one", async () => {
    const gone = await fetch(`${baseUrl()}/v1/sites/site-a.test/pages/retired`, {
      headers: authed(),
    })
    expect(gone.status).toBe(410)

    const missing = await fetch(`${baseUrl()}/v1/sites/site-a.test/pages/does-not-exist`, {
      headers: authed(),
    })
    expect(missing.status).toBe(404)
    const body = (await missing.json()) as { document: { pageType: string } }
    expect(body.document.pageType).toBe("not-found")
  })

  it("serves the sitemap with the release id and XML content type", async () => {
    const response = await fetch(`${baseUrl()}/v1/sites/site-a.test/sitemap.xml`, {
      headers: authed(),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/xml")
    expect(await response.text()).toContain('data-release="release-a-v1"')
  })

  it("serves a media object byte-for-byte with a long cache header once the manifest hash verifies", async () => {
    const response = await fetch(`${baseUrl()}/v1/sites/site-a.test/media/map.webp`, {
      headers: authed(),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("image/webp")
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable")
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(new TextDecoder().decode(bytes)).toBe(new TextDecoder().decode(world.mapBytes))
  })

  it("serves the HTML fallback export using X-Geo-Site-Host instead of the Host header", async () => {
    const response = await fetch(`${baseUrl()}/guides/article`, {
      headers: { ...authed(), "X-Geo-Site-Host": "site-a.test" },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8")
    const html = await response.text()
    expect(html).toContain("Portable structured content.")
    expect(html).toContain("https://geo-delivery.test/v1/sites/site-a.test/media/map.webp")
  })

  it("rejects requests with no Authorization header as 401", async () => {
    const response = await fetch(`${baseUrl()}/v1/sites/site-a.test/pages/guides/article`)
    expect(response.status).toBe(401)
  })

  it("rejects a token that does not belong to the site as 403", async () => {
    const response = await fetch(`${baseUrl()}/v1/sites/site-a.test/pages/guides/article`, {
      headers: authed("not-a-real-key"),
    })
    expect(response.status).toBe(403)
  })

  it("does not reveal whether a rejected key is unknown, revoked or expired", async () => {
    const responses = await Promise.all(
      ["not-a-real-key", REVOKED_KEY, EXPIRED_KEY].map((token) =>
        fetch(`${baseUrl()}/v1/sites/site-a.test/pages/guides/article`, {
          headers: authed(token),
        }),
      ),
    )
    for (const response of responses) {
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: { code: "DELIVERY_AUTH_KEY_INVALID" } })
    }
  })

  it("returns 404 for a host the release store does not know, even with a key the keyring accepts", async () => {
    const response = await fetch(`${baseUrl()}/v1/sites/unknown-to-runtime.test/pages/anything`, {
      headers: authed(UNKNOWN_HOST_KEY),
    })
    expect(response.status).toBe(404)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe("DELIVERY_UNKNOWN_HOST")
  })

  it("limits failed authentication attempts per known site", async () => {
    const responses = []
    for (let attempt = 0; attempt < 31; attempt += 1) {
      responses.push(
        await fetch(`${baseUrl()}/v1/sites/site-a.test/sitemap.xml`, {
          headers: authed(`invalid-${attempt}`),
        }),
      )
    }
    expect(responses[0]?.status).toBe(403)
    expect(responses[30]?.status).toBe(429)
    expect(responses[30]?.headers.get("retry-after")).not.toBeNull()
  })

  it("enforces the per-key quota from the credential file and returns 429 once exceeded", async () => {
    const first = await fetch(`${baseUrl()}/v1/sites/site-a.test/sitemap.xml`, {
      headers: authed(LOW_QUOTA_KEY),
    })
    expect(first.status).toBe(200)
    const second = await fetch(`${baseUrl()}/v1/sites/site-a.test/sitemap.xml`, {
      headers: authed(LOW_QUOTA_KEY),
    })
    expect(second.status).toBe(429)
    expect(second.headers.get("retry-after")).not.toBeNull()
  })

  it("rejects non-GET methods as 405", async () => {
    const response = await fetch(`${baseUrl()}/healthz`, { method: "POST" })
    expect(response.status).toBe(405)
  })
})
