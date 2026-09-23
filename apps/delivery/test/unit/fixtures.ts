/*
 * 测试专用的内存对象存储 + release/路由 fixture 构建器。写法参照
 * packages/runtime/test/runtime.test.ts 里的 MemoryObjectReader /
 * buildSiteRelease / installRouting（那份不是包的公开导出，不能跨包引入，
 * 这里按相同结构独立实现），并在其基础上追加了媒体产物（media/<filename>），
 * 覆盖本包新增的 resolveMedia 与图片绝对化能力。
 */
import {
  CurrentPointerSchema,
  currentPointerKey,
  hashReleaseManifest,
  hashRoutingManifest,
  ReleaseManifestSchema,
  releaseArtifactKey,
  releaseManifestKey,
  RoutingManifestPointerSchema,
  routingManifestKey,
  serializeReleaseManifest,
  serializeRoutingManifest,
} from "@geo/schema/release/v1"
import { articlePageFixture, type PageDocument, PageDocumentSchema } from "@geo/schema"

import type { RuntimeObject, RuntimeObjectHead, RuntimeObjectReader } from "@geo/runtime"

const encoder = new TextEncoder()

export type StoredObject = {
  readonly body: Uint8Array
  readonly contentType: string
  readonly etag: string
}

export class MemoryObjectReader implements RuntimeObjectReader {
  readonly #objects = new Map<string, StoredObject>()
  readonly #reads = new Map<string, number>()
  #etag = 0

  put(key: string, body: Uint8Array, contentType = "application/json"): void {
    this.#etag += 1
    this.#objects.set(key, { body: new Uint8Array(body), contentType, etag: `"etag-${this.#etag}"` })
  }

  reads(key: string): number {
    return this.#reads.get(key) ?? 0
  }

  async head(key: string): Promise<RuntimeObjectHead | null> {
    const object = this.#objects.get(key)
    return object === undefined
      ? null
      : { bytes: object.body.byteLength, contentType: object.contentType, etag: object.etag }
  }

  async read(key: string): Promise<RuntimeObject | null> {
    this.#reads.set(key, this.reads(key) + 1)
    const object = this.#objects.get(key)
    return object === undefined
      ? null
      : {
          body: new Uint8Array(object.body),
          bytes: object.body.byteLength,
          contentType: object.contentType,
          etag: object.etag,
        }
  }
}

const jsonBody = (value: unknown): Uint8Array => encoder.encode(JSON.stringify(value))

const sha256Of = async (body: Uint8Array): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(body))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

const objectPathOf = (pathname: string): string => `pages${pathname}.json`

/** 一张最小合法的 1x1 webp 字节序列，仅用作测试媒体内容，不追求真实解码。 */
export const fixtureMediaBytes = (label: string): Uint8Array =>
  encoder.encode(`geo-foundry-delivery-test-media:${label}`)

export type MediaFixture = { readonly bytes: Uint8Array; readonly contentType: string; readonly filename: string }

export type BuiltSiteRelease = {
  readonly pointerBody: Uint8Array
  readonly pointerKey: string
  readonly releaseId: string
  readonly siteId: string
}

export const buildSiteRelease = async (input: {
  readonly canonicalDomain: string
  readonly media?: readonly MediaFixture[]
  readonly releaseId: string
  readonly siteId: string
  readonly store: MemoryObjectReader
}): Promise<BuiltSiteRelease> => {
  const media = input.media ?? []
  const articlePathname = articlePageFixture.route.pathname
  const article: PageDocument = PageDocumentSchema.parse({
    ...articlePageFixture,
    identity: { ...articlePageFixture.identity, siteId: input.siteId },
    route: {
      ...articlePageFixture.route,
      canonicalUrl: `https://${input.canonicalDomain}${articlePathname}`,
    },
  })
  const notFoundDocument: PageDocument = PageDocumentSchema.parse({
    body: [{ text: "Not found.", type: "paragraph" }],
    breadcrumbs: [{ pathname: "/", title: "Home" }],
    identity: { pageId: "page-not-found", siteId: input.siteId },
    metadata: { description: "Not found.", title: "Not found" },
    pageType: "not-found",
    route: { canonicalUrl: `https://${input.canonicalDomain}/404`, locale: "en-US", pathname: "/404" },
    schemaVersion: 1,
    seo: { description: "Not found.", robots: { follow: false, index: false }, title: "Not found" },
  })
  const artifacts = [
    { body: jsonBody(article), contentType: "application/json", path: objectPathOf(articlePathname) },
    { body: jsonBody(notFoundDocument), contentType: "application/json", path: objectPathOf("/404") },
    {
      body: encoder.encode(`<urlset data-site="${input.siteId}" data-release="${input.releaseId}"/>`),
      contentType: "application/xml",
      path: "sitemap.xml",
    },
    ...media.map((entry) => ({
      body: entry.bytes,
      contentType: entry.contentType,
      path: `media/${entry.filename}`,
    })),
  ]
  const routes = {
    canonicalDomain: input.canonicalDomain,
    routes: [
      { objectKey: objectPathOf(articlePathname), pageType: "article", pathname: articlePathname, status: "active" },
      { objectKey: objectPathOf("/404"), pageType: "not-found", pathname: "/404", status: "not-found" },
      { pathname: "/retired", status: "gone" },
    ],
    schemaVersion: 1,
    siteId: input.siteId,
  }
  artifacts.push({ body: jsonBody(routes), contentType: "application/json", path: "routes.json" })

  const manifest = ReleaseManifestSchema.parse({
    compilerVersion: "1.0.0",
    createdAt: "2026-09-23T00:00:00.000Z",
    objects: await Promise.all(
      artifacts.map(async (artifact) => ({
        bytes: artifact.body.byteLength,
        contentType: artifact.contentType,
        path: artifact.path,
        sha256: await sha256Of(artifact.body),
      })),
    ),
    releaseId: input.releaseId,
    schemaVersion: 1,
    siteId: input.siteId,
    sourceVersionIds: [`source-${input.releaseId}`],
  })
  for (const artifact of artifacts) {
    input.store.put(
      releaseArtifactKey(manifest.siteId, manifest.releaseId, artifact.path as never),
      artifact.body,
      artifact.contentType,
    )
  }
  input.store.put(releaseManifestKey(manifest.siteId, manifest.releaseId), serializeReleaseManifest(manifest))

  const pointer = CurrentPointerSchema.parse({
    actor: { actorId: "delivery-fixture", kind: "service" },
    manifestSha256: await hashReleaseManifest(manifest),
    releaseId: manifest.releaseId,
    schemaVersion: 1,
    siteId: manifest.siteId,
    updatedAt: "2026-09-23T00:00:00.000Z",
  })
  return {
    pointerBody: jsonBody(pointer),
    pointerKey: currentPointerKey(manifest.siteId),
    releaseId: manifest.releaseId,
    siteId: manifest.siteId,
  }
}

export const installRouting = async (
  store: MemoryObjectReader,
  routingId: string,
  hosts: readonly { readonly canonical: boolean; readonly host: string; readonly siteId: string }[],
): Promise<void> => {
  const manifest = { hosts, schemaVersion: 1 as const }
  const pointer = RoutingManifestPointerSchema.parse({
    manifestSha256: await hashRoutingManifest(manifest),
    routingId,
    updatedAt: "2026-09-23T00:00:00.000Z",
  })
  store.put(routingManifestKey(pointer.routingId), serializeRoutingManifest(manifest))
  store.put("routing/channels/current.json", jsonBody(pointer))
}
