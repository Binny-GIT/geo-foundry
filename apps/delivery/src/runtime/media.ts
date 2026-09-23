/*
 * 媒体对象读取：@geo/runtime 的 createRuntime() 只暴露 resolve()/resolveSitemap()，
 * 没有读取任意 release artifact 的方法，而媒体文件（release 产物里的
 * `media/<filename>`）需要按 manifest 做哈希校验后原样吐出字节。
 *
 * 本模块独立实现这一段——按站点批次的文件范围约束（只能改 apps/delivery/**），
 * 不能去改 packages/runtime 给它加方法，所以这里用 @geo/schema/release/v1
 * 导出的公开原语（routing pointer、site pointer、release manifest 的 schema
 * 与哈希/键函数）重新走一遍"host → siteId → release → artifact"的解析
 * 路径，校验逻辑与 packages/runtime/src/index.ts 内部的
 * loadRouting/loadSite/assertArtifact 保持同样的不变量（pointer 哈希、
 * manifest 规范化哈希、siteId/releaseId 一致性、artifact 字节数与
 * sha256），只是省去了 routes.json 的读取——媒体对象不经过路由表，
 * 直接就是 manifest.objects 里的一条 `media/<filename>` 记录。
 *
 * createDeliveryRuntime()（见 delivery-runtime.ts）把这里的 resolveMedia
 * 和 @geo/runtime 原生的 resolve/resolveSitemap 组合成同一个 runtime 对象，
 * 这样从 app.ts 的视角看,"runtime 多了一个读媒体的方法"。
 */
import {
  currentPointerKey,
  CurrentPointerSchema,
  hashReleaseManifest,
  hashRoutingManifestBytes,
  releaseArtifactKey,
  releaseManifestKey,
  ReleaseArtifactPathSchema,
  ReleaseManifestSchema,
  ROUTING_POINTER_KEY,
  RoutingHostSchema,
  RoutingManifestPointerSchema,
  RoutingManifestSchema,
  routingManifestKey,
  SiteIdSchema,
  type CurrentPointerDocument,
  type ReleaseManifest,
  type RoutingManifest,
} from "@geo/schema/release/v1"

import type { RuntimeObject, RuntimeObjectHead, RuntimeObjectReader } from "@geo/runtime"

export const MEDIA_UNAVAILABLE_CODE = {
  ARTIFACT_INVALID: "DELIVERY_MEDIA_ARTIFACT_INVALID",
  ROUTING_INVALID: "DELIVERY_MEDIA_ROUTING_INVALID",
  SITE_RELEASE_INVALID: "DELIVERY_MEDIA_SITE_RELEASE_INVALID",
  STORAGE_UNAVAILABLE: "DELIVERY_MEDIA_STORAGE_UNAVAILABLE",
} as const

export type MediaUnavailableCode = (typeof MEDIA_UNAVAILABLE_CODE)[keyof typeof MEDIA_UNAVAILABLE_CODE]

export type MediaRequest = {
  readonly filename: string
  readonly hostname: string
}

export type MediaObjectResult = {
  readonly body: Uint8Array
  readonly contentType: string
  readonly etag: string
  readonly kind: "media"
  readonly releaseId: string
  readonly siteId: string
  readonly status: 200
}

export type MediaNotFoundResult = { readonly kind: "not-found"; readonly status: 404 }
export type MediaUnknownHostResult = { readonly kind: "unknown-host"; readonly status: 404 }
export type MediaUnavailableResult = {
  readonly code: MediaUnavailableCode
  readonly kind: "unavailable"
  readonly status: 503
}

export type MediaResolveResult =
  | MediaNotFoundResult
  | MediaObjectResult
  | MediaUnavailableResult
  | MediaUnknownHostResult

export type MediaResolverOptions = {
  readonly cache?: {
    readonly maxEntries?: number
    readonly ttlMs?: number
  }
  readonly clock?: () => number
  readonly store: RuntimeObjectReader
}

class MediaResolutionFailure extends Error {
  constructor(readonly code: MediaUnavailableCode) {
    super(code)
  }
}

type CacheEntry<Value> = { readonly expiresAt: number; readonly value: Value }

/** 与 packages/runtime 内部同名类同样的最小 TTL LRU 实现，规模很小，独立维护。 */
class TtlLruCache<Value> {
  readonly #entries = new Map<string, CacheEntry<Value>>()

  constructor(
    private readonly maxEntries: number,
    private readonly now: () => number,
    private readonly ttlMs: number,
  ) {}

  get(key: string): Value | undefined {
    const entry = this.#entries.get(key)
    if (entry === undefined) return undefined
    if (entry.expiresAt <= this.now()) {
      this.#entries.delete(key)
      return undefined
    }
    this.#entries.delete(key)
    this.#entries.set(key, entry)
    return entry.value
  }

  set(key: string, value: Value): void {
    this.#entries.delete(key)
    this.#entries.set(key, { expiresAt: this.now() + this.ttlMs, value })
    while (this.#entries.size > this.maxEntries) {
      const first = this.#entries.keys().next().value
      if (first === undefined) return
      this.#entries.delete(first)
    }
  }

  invalidate(predicate: (key: string) => boolean): void {
    for (const key of this.#entries.keys()) {
      if (predicate(key)) this.#entries.delete(key)
    }
  }
}

const textDecoder = new TextDecoder()

const sha256Of = async (body: Uint8Array): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(body))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

const jsonOf = (body: Uint8Array, failure: MediaUnavailableCode): unknown => {
  try {
    return JSON.parse(textDecoder.decode(body))
  } catch {
    throw new MediaResolutionFailure(failure)
  }
}

const normalizedHostname = (input: string): string | null => {
  const value = input.trim().toLowerCase()
  const withPort = /^(.+):(\d+)$/.exec(value)
  if (withPort !== null) {
    const host = withPort[1]
    const port = Number(withPort[2])
    if (host === undefined || !Number.isInteger(port) || port < 1 || port > 65535) return null
    return RoutingHostSchema.safeParse(host).success ? host : null
  }
  return RoutingHostSchema.safeParse(value).success ? value : null
}

/** 文件名必须是不含路径分隔符的单段标识，与 worker 侧收集媒体对象时的假设一致。 */
const normalizedFilename = (input: string): string | null => {
  if (input.length === 0 || input.includes("/")) return null
  return input
}

type SiteReleaseState = {
  readonly manifest: ReleaseManifest
  readonly pointer: CurrentPointerDocument
}

export const createMediaResolver = (
  options: MediaResolverOptions,
): { readonly resolveMedia: (request: MediaRequest) => Promise<MediaResolveResult> } => {
  const clock = options.clock ?? Date.now
  const maxEntries = options.cache?.maxEntries ?? 256
  const ttlMs = options.cache?.ttlMs ?? 30_000

  const routingCache = new TtlLruCache<{ readonly manifest: RoutingManifest; readonly pointerEtag: string }>(
    1,
    clock,
    ttlMs,
  )
  const releaseCache = new TtlLruCache<SiteReleaseState & { readonly pointerEtag: string }>(
    maxEntries,
    clock,
    ttlMs,
  )

  const loadRouting = async (): Promise<RoutingManifest> => {
    let head: RuntimeObjectHead | null
    try {
      head = await options.store.head(ROUTING_POINTER_KEY)
    } catch {
      throw new MediaResolutionFailure(MEDIA_UNAVAILABLE_CODE.STORAGE_UNAVAILABLE)
    }
    if (head === null) throw new MediaResolutionFailure(MEDIA_UNAVAILABLE_CODE.ROUTING_INVALID)
    const cached = routingCache.get(ROUTING_POINTER_KEY)
    if (cached !== undefined && cached.pointerEtag === head.etag) return cached.manifest

    const pointerObject = await readVerifiedJson(
      options.store,
      ROUTING_POINTER_KEY,
      head.etag,
      MEDIA_UNAVAILABLE_CODE.ROUTING_INVALID,
    )
    const pointer = RoutingManifestPointerSchema.safeParse(
      jsonOf(pointerObject.body, MEDIA_UNAVAILABLE_CODE.ROUTING_INVALID),
    )
    if (!pointer.success) throw new MediaResolutionFailure(MEDIA_UNAVAILABLE_CODE.ROUTING_INVALID)
    const manifestObject = await readVerifiedJson(
      options.store,
      routingManifestKey(pointer.data.routingId),
      undefined,
      MEDIA_UNAVAILABLE_CODE.ROUTING_INVALID,
    )
    if ((await hashRoutingManifestBytes(manifestObject.body)) !== pointer.data.manifestSha256) {
      throw new MediaResolutionFailure(MEDIA_UNAVAILABLE_CODE.ROUTING_INVALID)
    }
    const manifest = RoutingManifestSchema.safeParse(
      jsonOf(manifestObject.body, MEDIA_UNAVAILABLE_CODE.ROUTING_INVALID),
    )
    if (!manifest.success) throw new MediaResolutionFailure(MEDIA_UNAVAILABLE_CODE.ROUTING_INVALID)
    routingCache.set(ROUTING_POINTER_KEY, { manifest: manifest.data, pointerEtag: head.etag })
    return manifest.data
  }

  const readVerifiedJson = async (
    store: RuntimeObjectReader,
    key: string,
    expectedEtag: string | undefined,
    failure: MediaUnavailableCode,
  ): Promise<RuntimeObject> => {
    let object: RuntimeObject | null
    try {
      object = await store.read(key)
    } catch {
      throw new MediaResolutionFailure(MEDIA_UNAVAILABLE_CODE.STORAGE_UNAVAILABLE)
    }
    if (object === null || object.contentType !== "application/json") {
      throw new MediaResolutionFailure(failure)
    }
    if (expectedEtag !== undefined && object.etag !== expectedEtag) {
      throw new MediaResolutionFailure(MEDIA_UNAVAILABLE_CODE.STORAGE_UNAVAILABLE)
    }
    if (object.bytes !== object.body.byteLength) throw new MediaResolutionFailure(failure)
    return object
  }

  const loadSiteRelease = async (siteId: string): Promise<SiteReleaseState> => {
    const parsedSiteId = SiteIdSchema.safeParse(siteId)
    if (!parsedSiteId.success) {
      throw new MediaResolutionFailure(MEDIA_UNAVAILABLE_CODE.ROUTING_INVALID)
    }
    const pointerKey = currentPointerKey(parsedSiteId.data)
    let head: RuntimeObjectHead | null
    try {
      head = await options.store.head(pointerKey)
    } catch {
      throw new MediaResolutionFailure(MEDIA_UNAVAILABLE_CODE.STORAGE_UNAVAILABLE)
    }
    if (head === null) throw new MediaResolutionFailure(MEDIA_UNAVAILABLE_CODE.SITE_RELEASE_INVALID)
    const cached = releaseCache.get(siteId)
    if (cached !== undefined && cached.pointerEtag === head.etag) return cached

    const pointerObject = await readVerifiedJson(
      options.store,
      pointerKey,
      head.etag,
      MEDIA_UNAVAILABLE_CODE.SITE_RELEASE_INVALID,
    )
    const pointer = CurrentPointerSchema.safeParse(
      jsonOf(pointerObject.body, MEDIA_UNAVAILABLE_CODE.SITE_RELEASE_INVALID),
    )
    if (!pointer.success || pointer.data.siteId !== parsedSiteId.data) {
      throw new MediaResolutionFailure(MEDIA_UNAVAILABLE_CODE.SITE_RELEASE_INVALID)
    }
    const manifestObject = await readVerifiedJson(
      options.store,
      releaseManifestKey(pointer.data.siteId, pointer.data.releaseId),
      undefined,
      MEDIA_UNAVAILABLE_CODE.SITE_RELEASE_INVALID,
    )
    const manifest = ReleaseManifestSchema.safeParse(
      jsonOf(manifestObject.body, MEDIA_UNAVAILABLE_CODE.SITE_RELEASE_INVALID),
    )
    if (!manifest.success) throw new MediaResolutionFailure(MEDIA_UNAVAILABLE_CODE.SITE_RELEASE_INVALID)
    const rawManifestHash = await sha256Of(manifestObject.body)
    const canonicalManifestHash = await hashReleaseManifest(manifest.data)
    if (
      rawManifestHash !== pointer.data.manifestSha256 ||
      canonicalManifestHash !== pointer.data.manifestSha256 ||
      manifest.data.siteId !== pointer.data.siteId ||
      manifest.data.releaseId !== pointer.data.releaseId
    ) {
      throw new MediaResolutionFailure(MEDIA_UNAVAILABLE_CODE.SITE_RELEASE_INVALID)
    }
    const state: SiteReleaseState & { readonly pointerEtag: string } = {
      manifest: manifest.data,
      pointer: pointer.data,
      pointerEtag: head.etag,
    }
    releaseCache.set(siteId, state)
    return state
  }

  const resolveMedia = async (request: MediaRequest): Promise<MediaResolveResult> => {
    const hostname = normalizedHostname(request.hostname)
    if (hostname === null) return { kind: "unknown-host", status: 404 }
    const filename = normalizedFilename(request.filename)
    if (filename === null) return { kind: "not-found", status: 404 }
    const artifactPathResult = ReleaseArtifactPathSchema.safeParse(`media/${filename}`)
    if (!artifactPathResult.success) return { kind: "not-found", status: 404 }
    const artifactPath = artifactPathResult.data

    try {
      const routing = await loadRouting()
      const hostEntry = routing.hosts.find((entry) => entry.host === hostname)
      if (hostEntry === undefined) return { kind: "unknown-host", status: 404 }

      const site = await loadSiteRelease(hostEntry.siteId)
      const expected = site.manifest.objects.find((artifact) => artifact.path === artifactPath)
      if (expected === undefined) return { kind: "not-found", status: 404 }

      const key = releaseArtifactKey(site.pointer.siteId, site.pointer.releaseId, artifactPath)
      let object: RuntimeObject | null
      try {
        object = await options.store.read(key)
      } catch {
        throw new MediaResolutionFailure(MEDIA_UNAVAILABLE_CODE.STORAGE_UNAVAILABLE)
      }
      if (object === null) throw new MediaResolutionFailure(MEDIA_UNAVAILABLE_CODE.ARTIFACT_INVALID)
      if (
        object.bytes !== object.body.byteLength ||
        object.bytes !== expected.bytes ||
        object.contentType !== expected.contentType ||
        (await sha256Of(object.body)) !== expected.sha256
      ) {
        throw new MediaResolutionFailure(MEDIA_UNAVAILABLE_CODE.ARTIFACT_INVALID)
      }
      return {
        body: object.body,
        contentType: object.contentType,
        etag: object.etag,
        kind: "media",
        releaseId: site.pointer.releaseId,
        siteId: site.pointer.siteId,
        status: 200,
      }
    } catch (error) {
      if (error instanceof MediaResolutionFailure) {
        return { code: error.code, kind: "unavailable", status: 503 }
      }
      return { code: MEDIA_UNAVAILABLE_CODE.STORAGE_UNAVAILABLE, kind: "unavailable", status: 503 }
    }
  }

  return Object.freeze({ resolveMedia })
}
