import {
  ContentTypeSchema,
  CurrentPointerSchema,
  currentPointerKey,
  hashReleaseManifest,
  hashRoutingManifestBytes,
  releaseArtifactKey,
  releaseManifestKey,
  ReleaseArtifactPathSchema,
  ReleaseManifestSchema,
  RouteIndexSchema,
  ROUTING_POINTER_KEY,
  RoutingHostSchema,
  RoutingManifestPointerSchema,
  RoutingManifestSchema,
  routingManifestKey,
  type CurrentPointerDocument,
  type ImmutableArtifact,
  type ReleaseManifest,
  type RouteIndex,
  type RoutingManifest,
} from "@geo/schema/release/v1"
import {
  PageDocumentSchema,
  PathnameSchema,
  SiteIdSchema,
  type PageDocument,
  type RedirectPage,
} from "@geo/schema"

export type RuntimeObjectHead = {
  readonly bytes: number
  readonly contentType: string
  readonly etag: string
}

export type RuntimeObject = RuntimeObjectHead & {
  readonly body: Uint8Array
}

/** Read-only object boundary supplied by the serving host. */
export interface RuntimeObjectReader {
  head(key: string): Promise<RuntimeObjectHead | null>
  read(key: string): Promise<RuntimeObject | null>
}

export const RUNTIME_UNAVAILABLE_CODE = {
  ARTIFACT_INVALID: "RUNTIME_ARTIFACT_INVALID",
  REQUEST_INVALID: "RUNTIME_REQUEST_INVALID",
  ROUTING_INVALID: "RUNTIME_ROUTING_INVALID",
  SITE_RELEASE_INVALID: "RUNTIME_SITE_RELEASE_INVALID",
  STORAGE_UNAVAILABLE: "RUNTIME_STORAGE_UNAVAILABLE",
} as const

export type RuntimeUnavailableCode =
  (typeof RUNTIME_UNAVAILABLE_CODE)[keyof typeof RUNTIME_UNAVAILABLE_CODE]

export type RuntimeResultBase = {
  readonly releaseId: string
  readonly siteId: string
}

export type RuntimePageResult = RuntimeResultBase & {
  readonly document: PageDocument
  readonly kind: "page"
  readonly status: 200
}

export type RuntimeRedirectResult = RuntimeResultBase & {
  readonly document: RedirectPage
  readonly kind: "redirect"
  readonly status: 301
  readonly targetUrl: string
}

export type RuntimeGoneResult = RuntimeResultBase & {
  readonly kind: "gone"
  readonly status: 410
}

export type RuntimeNotFoundResult = RuntimeResultBase & {
  readonly document: PageDocument
  readonly kind: "not-found"
  readonly status: 404
}

export type RuntimeSitemapResult = RuntimeResultBase & {
  readonly body: Uint8Array
  readonly contentType: string
  readonly kind: "sitemap"
  readonly status: 200
}

export type RuntimeUnknownHostResult = {
  readonly kind: "unknown-host"
  readonly status: 404
}

export type RuntimeUnavailableResult = {
  readonly code: RuntimeUnavailableCode
  readonly kind: "unavailable"
  readonly status: 503
}

export type RuntimeResolveResult =
  | RuntimeGoneResult
  | RuntimeNotFoundResult
  | RuntimePageResult
  | RuntimeRedirectResult
  | RuntimeUnavailableResult
  | RuntimeUnknownHostResult

export type RuntimeSitemapResolveResult =
  | RuntimeSitemapResult
  | RuntimeUnavailableResult
  | RuntimeUnknownHostResult

export type RuntimeOptions = {
  readonly cache?: {
    readonly maxEntries?: number
    readonly ttlMs?: number
  }
  readonly clock?: () => number
  readonly store: RuntimeObjectReader
}

export type RuntimeRequest = {
  readonly hostname: string
  readonly pathname: string
}

type RoutingState = {
  readonly manifest: RoutingManifest
  readonly pointerEtag: string
}

type SitePointer = CurrentPointerDocument

type SiteState = {
  readonly manifest: ReleaseManifest
  readonly pointer: SitePointer
  readonly pointerEtag: string
  readonly routes: RouteIndex
}

type CacheEntry<Value> = {
  readonly expiresAt: number
  readonly value: Value
}

class TtlLruCache<Value> {
  readonly #entries = new Map<string, CacheEntry<Value>>()

  constructor(
    private readonly maxEntries: number,
    private readonly now: () => number,
    private readonly ttlMs: number,
  ) {}

  get(key: string): Value | undefined {
    const entry = this.#entries.get(key)
    if (entry === undefined) {
      return undefined
    }
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
      if (first === undefined) {
        return
      }
      this.#entries.delete(first)
    }
  }

  invalidate(predicate: (key: string) => boolean): void {
    for (const key of this.#entries.keys()) {
      if (predicate(key)) {
        this.#entries.delete(key)
      }
    }
  }
}

class RuntimeFailure extends Error {
  constructor(readonly code: RuntimeUnavailableCode) {
    super(code)
  }
}

const JSON_CONTENT_TYPE = ContentTypeSchema.parse("application/json")

const textDecoder = new TextDecoder()

const sha256Of = async (body: Uint8Array): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(body))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

const jsonOf = (body: Uint8Array, failure: RuntimeUnavailableCode): unknown => {
  try {
    return JSON.parse(textDecoder.decode(body))
  } catch {
    throw new RuntimeFailure(failure)
  }
}

const normalizedHostname = (input: string): string | null => {
  const value = input.trim().toLowerCase()
  const withPort = /^(.+):(\d+)$/.exec(value)
  if (withPort !== null) {
    const host = withPort[1]
    const port = Number(withPort[2])
    if (host === undefined || !Number.isInteger(port) || port < 1 || port > 65535) {
      return null
    }
    return RoutingHostSchema.safeParse(host).success ? host : null
  }
  return RoutingHostSchema.safeParse(value).success ? value : null
}

const normalizedPathname = (input: string): string | null =>
  PathnameSchema.safeParse(input).success ? input : null

const pageCacheKey = (siteId: string, releaseId: string, pathname: string): string =>
  `${siteId}\u0000${releaseId}\u0000${pathname}`

const parseJsonObject = async (
  store: RuntimeObjectReader,
  key: string,
  expectedEtag: string | undefined,
  failure: RuntimeUnavailableCode,
): Promise<RuntimeObject> => {
  let object: RuntimeObject | null
  try {
    object = await store.read(key)
  } catch {
    throw new RuntimeFailure(RUNTIME_UNAVAILABLE_CODE.STORAGE_UNAVAILABLE)
  }
  if (object === null || object.contentType !== JSON_CONTENT_TYPE) {
    throw new RuntimeFailure(failure)
  }
  if (expectedEtag !== undefined && object.etag !== expectedEtag) {
    throw new RuntimeFailure(RUNTIME_UNAVAILABLE_CODE.STORAGE_UNAVAILABLE)
  }
  if (object.bytes !== object.body.byteLength) {
    throw new RuntimeFailure(failure)
  }
  return object
}

const expectedArtifact = (manifest: ReleaseManifest, path: string): ImmutableArtifact => {
  const expected = manifest.objects.find((artifact) => artifact.path === path)
  if (expected === undefined) {
    throw new RuntimeFailure(RUNTIME_UNAVAILABLE_CODE.ARTIFACT_INVALID)
  }
  return expected
}

const assertArtifact = async (
  store: RuntimeObjectReader,
  pointer: SitePointer,
  manifest: ReleaseManifest,
  path: string,
): Promise<RuntimeObject> => {
  const artifactPath = ReleaseArtifactPathSchema.safeParse(path)
  if (!artifactPath.success) {
    throw new RuntimeFailure(RUNTIME_UNAVAILABLE_CODE.ARTIFACT_INVALID)
  }
  const expected = expectedArtifact(manifest, artifactPath.data)
  const key = releaseArtifactKey(pointer.siteId, pointer.releaseId, artifactPath.data)
  let object: RuntimeObject | null
  try {
    object = await store.read(key)
  } catch {
    throw new RuntimeFailure(RUNTIME_UNAVAILABLE_CODE.STORAGE_UNAVAILABLE)
  }
  if (object === null) {
    throw new RuntimeFailure(RUNTIME_UNAVAILABLE_CODE.ARTIFACT_INVALID)
  }
  if (
    object.bytes !== object.body.byteLength ||
    object.bytes !== expected.bytes ||
    object.contentType !== expected.contentType ||
    (await sha256Of(object.body)) !== expected.sha256
  ) {
    throw new RuntimeFailure(RUNTIME_UNAVAILABLE_CODE.ARTIFACT_INVALID)
  }
  return object
}

/**
 * Creates an independent, read-only serving resolver. Every served release
 * object is manifest-covered and hash-verified before it enters the L1 cache.
 */
export const createRuntime = (options: RuntimeOptions) => {
  const clock = options.clock ?? Date.now
  const maxEntries = options.cache?.maxEntries ?? 256
  const ttlMs = options.cache?.ttlMs ?? 30_000
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || !Number.isFinite(ttlMs) || ttlMs < 1) {
    throw new Error("Runtime cache configuration must use positive finite values")
  }

  const routingCache = new TtlLruCache<RoutingState>(1, clock, ttlMs)
  const siteCache = new TtlLruCache<SiteState>(maxEntries, clock, ttlMs)
  const pageCache = new TtlLruCache<PageDocument>(maxEntries, clock, ttlMs)
  const sitemapCache = new TtlLruCache<RuntimeSitemapResult>(maxEntries, clock, ttlMs)

  const loadRouting = async (): Promise<RoutingState> => {
    let head: RuntimeObjectHead | null
    try {
      head = await options.store.head(ROUTING_POINTER_KEY)
    } catch {
      throw new RuntimeFailure(RUNTIME_UNAVAILABLE_CODE.STORAGE_UNAVAILABLE)
    }
    if (head === null) {
      throw new RuntimeFailure(RUNTIME_UNAVAILABLE_CODE.ROUTING_INVALID)
    }
    const cached = routingCache.get(ROUTING_POINTER_KEY)
    if (cached !== undefined && cached.pointerEtag === head.etag) {
      return cached
    }

    const pointerObject = await parseJsonObject(
      options.store,
      ROUTING_POINTER_KEY,
      head.etag,
      RUNTIME_UNAVAILABLE_CODE.ROUTING_INVALID,
    )
    const pointer = RoutingManifestPointerSchema.safeParse(
      jsonOf(pointerObject.body, RUNTIME_UNAVAILABLE_CODE.ROUTING_INVALID),
    )
    if (!pointer.success) {
      throw new RuntimeFailure(RUNTIME_UNAVAILABLE_CODE.ROUTING_INVALID)
    }
    const manifestObject = await parseJsonObject(
      options.store,
      routingManifestKey(pointer.data.routingId),
      undefined,
      RUNTIME_UNAVAILABLE_CODE.ROUTING_INVALID,
    )
    if ((await hashRoutingManifestBytes(manifestObject.body)) !== pointer.data.manifestSha256) {
      throw new RuntimeFailure(RUNTIME_UNAVAILABLE_CODE.ROUTING_INVALID)
    }
    const manifest = RoutingManifestSchema.safeParse(
      jsonOf(manifestObject.body, RUNTIME_UNAVAILABLE_CODE.ROUTING_INVALID),
    )
    if (!manifest.success) {
      throw new RuntimeFailure(RUNTIME_UNAVAILABLE_CODE.ROUTING_INVALID)
    }
    const state = { manifest: manifest.data, pointerEtag: head.etag }
    routingCache.set(ROUTING_POINTER_KEY, state)
    return state
  }

  const loadSite = async (siteId: string, canonicalDomain: string): Promise<SiteState> => {
    const parsedSiteId = SiteIdSchema.safeParse(siteId)
    if (!parsedSiteId.success) {
      throw new RuntimeFailure(RUNTIME_UNAVAILABLE_CODE.ROUTING_INVALID)
    }
    const pointerKey = currentPointerKey(parsedSiteId.data)
    let head: RuntimeObjectHead | null
    try {
      head = await options.store.head(pointerKey)
    } catch {
      throw new RuntimeFailure(RUNTIME_UNAVAILABLE_CODE.STORAGE_UNAVAILABLE)
    }
    if (head === null) {
      throw new RuntimeFailure(RUNTIME_UNAVAILABLE_CODE.SITE_RELEASE_INVALID)
    }
    const cached = siteCache.get(siteId)
    if (
      cached !== undefined &&
      cached.pointerEtag === head.etag &&
      cached.routes.canonicalDomain === canonicalDomain
    ) {
      return cached
    }
    siteCache.invalidate((key) => key === siteId)
    pageCache.invalidate((key) => key.startsWith(`${siteId}\u0000`))
    sitemapCache.invalidate((key) => key.startsWith(`${siteId}\u0000`))

    const pointerObject = await parseJsonObject(
      options.store,
      pointerKey,
      head.etag,
      RUNTIME_UNAVAILABLE_CODE.SITE_RELEASE_INVALID,
    )
    const pointer = CurrentPointerSchema.safeParse(
      jsonOf(pointerObject.body, RUNTIME_UNAVAILABLE_CODE.SITE_RELEASE_INVALID),
    )
    if (!pointer.success || pointer.data.siteId !== parsedSiteId.data) {
      throw new RuntimeFailure(RUNTIME_UNAVAILABLE_CODE.SITE_RELEASE_INVALID)
    }
    const manifestObject = await parseJsonObject(
      options.store,
      releaseManifestKey(pointer.data.siteId, pointer.data.releaseId),
      undefined,
      RUNTIME_UNAVAILABLE_CODE.SITE_RELEASE_INVALID,
    )
    const manifest = ReleaseManifestSchema.safeParse(
      jsonOf(manifestObject.body, RUNTIME_UNAVAILABLE_CODE.SITE_RELEASE_INVALID),
    )
    if (!manifest.success) {
      throw new RuntimeFailure(RUNTIME_UNAVAILABLE_CODE.SITE_RELEASE_INVALID)
    }
    const rawManifestHash = await sha256Of(manifestObject.body)
    const canonicalManifestHash = await hashReleaseManifest(manifest.data)
    if (
      rawManifestHash !== pointer.data.manifestSha256 ||
      canonicalManifestHash !== pointer.data.manifestSha256 ||
      manifest.data.siteId !== pointer.data.siteId ||
      manifest.data.releaseId !== pointer.data.releaseId
    ) {
      throw new RuntimeFailure(RUNTIME_UNAVAILABLE_CODE.SITE_RELEASE_INVALID)
    }

    const routesObject = await assertArtifact(options.store, pointer.data, manifest.data, "routes.json")
    const routes = RouteIndexSchema.safeParse(jsonOf(routesObject.body, RUNTIME_UNAVAILABLE_CODE.ARTIFACT_INVALID))
    if (
      !routes.success ||
      routes.data.siteId !== pointer.data.siteId ||
      routes.data.canonicalDomain !== canonicalDomain
    ) {
      throw new RuntimeFailure(RUNTIME_UNAVAILABLE_CODE.ARTIFACT_INVALID)
    }
    const state = {
      manifest: manifest.data,
      pointer: pointer.data,
      pointerEtag: head.etag,
      routes: routes.data,
    }
    siteCache.set(siteId, state)
    return state
  }

  const loadPage = async (state: SiteState, pathname: string, objectKey: string): Promise<PageDocument> => {
    const key = pageCacheKey(state.pointer.siteId, state.pointer.releaseId, pathname)
    const cached = pageCache.get(key)
    if (cached !== undefined) {
      return cached
    }
    const object = await assertArtifact(options.store, state.pointer, state.manifest, objectKey)
    const document = PageDocumentSchema.safeParse(
      jsonOf(object.body, RUNTIME_UNAVAILABLE_CODE.ARTIFACT_INVALID),
    )
    if (
      !document.success ||
      document.data.identity.siteId !== state.pointer.siteId ||
      document.data.route.pathname !== pathname
    ) {
      throw new RuntimeFailure(RUNTIME_UNAVAILABLE_CODE.ARTIFACT_INVALID)
    }
    pageCache.set(key, document.data)
    return document.data
  }

  const loadSitemap = async (state: SiteState): Promise<RuntimeSitemapResult> => {
    const key = pageCacheKey(state.pointer.siteId, state.pointer.releaseId, "sitemap.xml")
    const cached = sitemapCache.get(key)
    if (cached !== undefined) {
      return cached
    }
    const object = await assertArtifact(options.store, state.pointer, state.manifest, "sitemap.xml")
    if (object.contentType !== "application/xml") {
      throw new RuntimeFailure(RUNTIME_UNAVAILABLE_CODE.ARTIFACT_INVALID)
    }
    const result: RuntimeSitemapResult = {
      body: object.body,
      contentType: object.contentType,
      kind: "sitemap",
      releaseId: state.pointer.releaseId,
      siteId: state.pointer.siteId,
      status: 200,
    }
    sitemapCache.set(key, result)
    return result
  }

  const siteForHostname = async (hostname: string): Promise<SiteState | RuntimeUnknownHostResult> => {
    const routing = await loadRouting()
    const host = routing.manifest.hosts.find((entry) => entry.host === hostname)
    if (host === undefined) {
      return { kind: "unknown-host", status: 404 }
    }
    const canonicalHost = routing.manifest.hosts.find(
      (entry) => entry.siteId === host.siteId && entry.canonical,
    )
    if (canonicalHost === undefined) {
      throw new RuntimeFailure(RUNTIME_UNAVAILABLE_CODE.ROUTING_INVALID)
    }
    return loadSite(host.siteId, canonicalHost.host)
  }

  const notFound = async (state: SiteState): Promise<RuntimeNotFoundResult> => {
    const route = state.routes.routes.find((entry) => entry.status === "not-found")
    if (route === undefined || route.status !== "not-found") {
      throw new RuntimeFailure(RUNTIME_UNAVAILABLE_CODE.ARTIFACT_INVALID)
    }
    const document = await loadPage(state, route.pathname, route.objectKey)
    if (document.pageType !== "not-found") {
      throw new RuntimeFailure(RUNTIME_UNAVAILABLE_CODE.ARTIFACT_INVALID)
    }
    return {
      document,
      kind: "not-found",
      releaseId: state.pointer.releaseId,
      siteId: state.pointer.siteId,
      status: 404,
    }
  }

  return Object.freeze({
    async resolve(request: RuntimeRequest): Promise<RuntimeResolveResult> {
      const hostname = normalizedHostname(request.hostname)
      if (hostname === null) {
        return { kind: "unknown-host", status: 404 }
      }
      const pathname = normalizedPathname(request.pathname)
      if (pathname === null) {
        return {
          code: RUNTIME_UNAVAILABLE_CODE.REQUEST_INVALID,
          kind: "unavailable",
          status: 503,
        }
      }
      try {
        const site = await siteForHostname(hostname)
        if ("kind" in site) {
          return site
        }
        const route = site.routes.routes.find((entry) => entry.pathname === pathname)
        if (route === undefined) {
          return notFound(site)
        }
        if (route.status === "gone") {
          return {
            kind: "gone",
            releaseId: site.pointer.releaseId,
            siteId: site.pointer.siteId,
            status: 410,
          }
        }
        const document = await loadPage(site, route.pathname, route.objectKey)
        if (document.pageType !== route.pageType) {
          throw new RuntimeFailure(RUNTIME_UNAVAILABLE_CODE.ARTIFACT_INVALID)
        }
        if (route.status === "redirect") {
          if (document.pageType !== "redirect") {
            throw new RuntimeFailure(RUNTIME_UNAVAILABLE_CODE.ARTIFACT_INVALID)
          }
          return {
            document,
            kind: "redirect",
            releaseId: site.pointer.releaseId,
            siteId: site.pointer.siteId,
            status: 301,
            targetUrl: document.redirect.targetUrl,
          }
        }
        return {
          document,
          kind: "page",
          releaseId: site.pointer.releaseId,
          siteId: site.pointer.siteId,
          status: 200,
        }
      } catch (error) {
        if (error instanceof RuntimeFailure) {
          return { code: error.code, kind: "unavailable", status: 503 }
        }
        return {
          code: RUNTIME_UNAVAILABLE_CODE.STORAGE_UNAVAILABLE,
          kind: "unavailable",
          status: 503,
        }
      }
    },
    async resolveSitemap(request: Pick<RuntimeRequest, "hostname">): Promise<RuntimeSitemapResolveResult> {
      const hostname = normalizedHostname(request.hostname)
      if (hostname === null) {
        return { kind: "unknown-host", status: 404 }
      }
      try {
        const site = await siteForHostname(hostname)
        if ("kind" in site) {
          return site
        }
        return await loadSitemap(site)
      } catch (error) {
        if (error instanceof RuntimeFailure) {
          return { code: error.code, kind: "unavailable", status: 503 }
        }
        return {
          code: RUNTIME_UNAVAILABLE_CODE.STORAGE_UNAVAILABLE,
          kind: "unavailable",
          status: 503,
        }
      }
    },
  })
}
