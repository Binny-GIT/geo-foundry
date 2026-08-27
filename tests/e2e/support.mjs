import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { appendFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { request } from "node:http"
import { createServer } from "node:net"
import { join, resolve } from "node:path"

import { DeleteObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3"
import { compileSite } from "@geo/compiler"
import {
  createS3ArtifactStore,
  createS3RoutingStore,
  planRelease,
  publishRelease,
  publishRoutingManifest,
} from "@geo/publisher"
import { verifyManifest } from "@geo/schema/release/v1"

import { acquireProjectLock } from "../../scripts/shared-services/lock.mjs"

import { assertSitemapScope } from "./assertions.mjs"

const root = resolve(import.meta.dirname, "../..")
const bucket = "geo-foundry"
const requestTimeoutMs = 15_000
const required = (name) => {
  const value = process.env[name]
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`E2E_ENV_REQUIRED:${name}`)
  }
  return value.trim()
}

const secureFile = async (name) => {
  const path = required(name)
  const metadata = await stat(path)
  if ((metadata.mode & 0o077) !== 0 || metadata.uid !== process.getuid()) {
    throw new Error(`E2E_CREDENTIAL_FILE_INSECURE:${name}`)
  }
  const value = (await readFile(path, "utf8")).trim()
  if (value.length === 0) {
    throw new Error(`E2E_CREDENTIAL_FILE_EMPTY:${name}`)
  }
  return { path, value }
}

const evidenceDirectoryOf = async () => {
  const configured = process.env.GEO_FOUNDRY_EVIDENCE_DIR ?? resolve(root, "temp/e2e")
  const directory = resolve(configured)
  if (directory === root || directory.startsWith(resolve(root, ".zcode"))) {
    throw new Error("E2E_EVIDENCE_DIRECTORY_FORBIDDEN")
  }
  await mkdir(directory, { recursive: true, mode: 0o700 })
  return directory
}

const reservePort = async () =>
  new Promise((resolvePort, rejectPort) => {
    const server = createServer()
    server.once("error", rejectPort)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      server.close((error) => {
        if (error !== undefined || typeof address !== "object" || address === null) {
          rejectPort(error ?? new Error("E2E_PORT_RESERVATION_FAILED"))
          return
        }
        resolvePort(address.port)
      })
    })
  })

export const requestHost = (input) =>
  new Promise((resolveRequest, rejectRequest) => {
    const startedAt = Date.now()
    const client = request(
      {
        headers: { Host: input.host },
        hostname: "127.0.0.1",
        method: "GET",
        path: input.path,
        port: input.port,
        timeout: requestTimeoutMs,
      },
      (response) => {
        const chunks = []
        response.on("data", (chunk) => chunks.push(chunk))
        response.on("end", () =>
          resolveRequest({
            body: Buffer.concat(chunks).toString("utf8"),
            durationMs: Date.now() - startedAt,
            headers: response.headers,
            status: response.statusCode ?? 0,
          }),
        )
      },
    )
    client.on("timeout", () => client.destroy(new Error("E2E_HTTP_TIMEOUT")))
    client.on("error", rejectRequest)
    client.end()
  })

const waitFor = async (predicate, code) => {
  const deadline = Date.now() + requestTimeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) {
      return
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 125))
  }
  throw new Error(code)
}

const startHost = async (input) => {
  const port = await reservePort()
  const logPath = join(input.directory, `${input.name}.log`)
  const child = spawn(process.execPath, ["server/server.mjs"], {
    cwd: input.packageRoot,
    detached: true,
    env: input.environment(port),
    stdio: ["ignore", "pipe", "pipe"],
  })
  child.stdout.on("data", (chunk) => void appendFile(logPath, chunk))
  child.stderr.on("data", (chunk) => void appendFile(logPath, chunk))
  await waitFor(async () => {
    try {
      await requestHost({ host: "unknown.test", path: "/", port })
      return true
    } catch {
      return false
    }
  }, `E2E_HOST_READY_TIMEOUT:${input.name}`)
  return { child, port }
}

const stopHost = async (host) => {
  if (host.child.exitCode !== null || host.child.pid === undefined) {
    return
  }
  try {
    process.kill(-host.child.pid, "SIGTERM")
  } catch {
    return
  }
  await Promise.race([
    new Promise((resolveExit) => host.child.once("exit", resolveExit)),
    new Promise((resolveExit) => setTimeout(resolveExit, 10_000)),
  ])
  if (host.child.exitCode === null) {
    try {
      process.kill(-host.child.pid, "SIGKILL")
    } catch {}
  }
}

const editionOf = (input) => ({
  assessmentInputHash: input.assessmentInputHash,
  assessmentState: "passed",
  author: {
    id: `author-${input.siteId}`,
    name: input.authorName,
    url: `https://${input.canonicalDomain}/authors/editorial-team`,
  },
  body: [
    { blockType: "heading", level: "2", text: input.heading },
    { blockType: "paragraph", text: input.body },
  ],
  categories: [input.category],
  contentId: input.contentId,
  editionId: input.editionId,
  media: [],
  modifiedAt: input.modifiedAt,
  publishedAt: "2026-08-21T00:00:00Z",
  siteId: input.siteId,
  status: "approved",
  summary: input.summary,
  tags: [input.tag],
  title: input.title,
  urlPathname: input.pathname,
  urlStatus: "active",
})

const requestOf = (input) => ({
  clock: { now: input.modifiedAt },
  compilerVersion: "1.0.0",
  editions: [editionOf(input)],
  gonePathnames: [input.gonePathname],
  listings: {
    articles: { pathname: "/articles", pageSize: 10 },
    categories: [
      {
        id: `cat-${input.category}`,
        pathname: `/${input.category}`,
        slug: input.category,
        title: input.category.charAt(0).toUpperCase() + input.category.slice(1),
      },
    ],
    tags: [
      {
        id: `tag-${input.tag}`,
        pathname: `/tags/${input.tag}`,
        slug: input.tag,
        title: input.tag,
      },
    ],
  },
  notFound: { pathname: "/not-found" },
  redirects: input.redirects,
  site: {
    canonicalDomain: input.canonicalDomain,
    locale: "en-US",
    name: input.siteName,
    organization: { name: input.siteName },
    seoDefaults: { description: input.siteDescription, title: input.siteName },
    siteId: input.siteId,
    timezone: "UTC",
  },
})

const release = async (input) => {
  const output = await compileSite(requestOf(input))
  const plan = planRelease({
    compileOutput: output,
    createdAt: input.modifiedAt,
    releaseId: input.releaseId,
    routingManifest: input.routingManifest,
    siteId: input.siteId,
    sourceVersionIds: [`source-${input.releaseId}`],
  })
  await publishRelease({
    actor: { actorId: "geo-foundry-e2e", kind: "service" },
    planned: plan,
    store: input.store,
    verifiedManifest: await verifyManifest(plan.manifest),
  })
  return plan
}

const publishRouting = async (input) =>
  publishRoutingManifest({
    manifest: input.routingManifest,
    routingId: input.routingId,
    routingStore: input.routingStore,
    sitePointerObjectKeys: input.siteIds.map((siteId) => `sites/${siteId}/channels/current.json`),
    siteReleaseObjectKeys: input.releases.map(
      (release) => `sites/${release.siteId}/releases/${release.releaseId}/manifest.json`,
    ),
    updatedAt: input.updatedAt,
  })

const deletePrefix = async (client, keyPrefix) => {
  let continuationToken
  do {
    const listed = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ...(continuationToken === undefined ? {} : { ContinuationToken: continuationToken }),
        Prefix: `${keyPrefix}/`,
      }),
    )
    for (const object of listed.Contents ?? []) {
      if (object.Key === undefined || !object.Key.startsWith(`${keyPrefix}/`)) {
        throw new Error("E2E_FOREIGN_CLEANUP_KEY")
      }
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }))
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined
  } while (continuationToken !== undefined)
}

const asText = (value) => (typeof value === "string" ? value : "")
const requireEqual = (actual, expected, code) => {
  if (actual !== expected) {
    throw new Error(`${code}:${String(actual)}:${String(expected)}`)
  }
}

const rawMatrix = async (input) => {
  const matrix = []
  const check = async (entry) => {
    const response = await requestHost(entry)
    requireEqual(response.status, entry.status, "E2E_HTTP_STATUS")
    if (entry.releaseId !== undefined) {
      requireEqual(
        asText(response.headers["x-geo-release-id"]),
        entry.releaseId,
        "E2E_RELEASE_HEADER",
      )
    } else if (response.headers["x-geo-release-id"] !== undefined) {
      throw new Error("E2E_UNKNOWN_HOST_RELEASE_LEAK")
    }
    matrix.push({
      canonical: entry.canonical ?? null,
      host: entry.host,
      location: asText(response.headers.location) || null,
      path: entry.path,
      releaseId: asText(response.headers["x-geo-release-id"]) || null,
      robots: /name="robots" content="([^"]+)"/.exec(response.body)?.[1] ?? null,
      status: response.status,
    })
    return response
  }

  const aArticle = await check({
    host: input.siteA.host,
    path: input.siteA.pathname,
    port: input.siteA.port,
    releaseId: input.siteA.releaseId,
    status: 200,
  })
  if (!aArticle.body.includes(input.siteA.title) || aArticle.body.includes(input.siteB.siteName)) {
    throw new Error("E2E_BRAND_ISOLATION_FAILED:site-a")
  }
  const aAlias = await check({
    host: input.siteA.alias,
    path: input.siteA.pathname,
    port: input.siteA.port,
    releaseId: input.siteA.releaseId,
    status: 200,
  })
  if (!aAlias.body.includes(`https://${input.siteA.host}${input.siteA.pathname}`)) {
    throw new Error("E2E_ALIAS_CANONICAL_FAILED:site-a")
  }
  const aRedirect = await check({
    host: input.siteA.host,
    path: input.siteA.oldPathname,
    port: input.siteA.port,
    releaseId: input.siteA.releaseId,
    status: 301,
  })
  requireEqual(
    asText(aRedirect.headers.location),
    `https://${input.siteA.host}${input.siteA.pathname}`,
    "E2E_REDIRECT_TARGET",
  )
  if (
    !aRedirect.body.includes(`https://${input.siteA.host}${input.siteA.oldPathname}`) ||
    !/name="robots"[^>]*content="noindex,follow"|content="noindex,follow"[^>]*name="robots"/.test(
      aRedirect.body,
    ) ||
    aRedirect.body.includes("application/ld+json")
  ) {
    throw new Error("E2E_REDIRECT_SEO_FAILED:site-a")
  }
  const aSitemap = await check({
    host: input.siteA.host,
    path: "/sitemap.xml",
    port: input.siteA.port,
    releaseId: input.siteA.releaseId,
    status: 200,
  })
  assertSitemapScope(aSitemap.body, {
    forbidden: [
      `https://${input.siteA.host}${input.siteA.oldPathname}`,
      `https://${input.siteA.host}${input.siteA.gonePathname}`,
    ],
    forbiddenHosts: [input.siteB.host],
    required: [`https://${input.siteA.host}${input.siteA.pathname}`],
  })
  await check({
    host: input.siteA.host,
    path: "/missing",
    port: input.siteA.port,
    releaseId: input.siteA.releaseId,
    status: 404,
  })
  await check({
    host: input.siteA.host,
    path: input.siteA.gonePathname,
    port: input.siteA.port,
    releaseId: input.siteA.releaseId,
    status: 410,
  })

  const bArticle = await check({
    host: input.siteB.host,
    path: input.siteB.pathname,
    port: input.siteB.port,
    releaseId: input.siteB.releaseId,
    status: 200,
  })
  if (!bArticle.body.includes(input.siteB.title) || bArticle.body.includes(input.siteA.siteName)) {
    throw new Error("E2E_BRAND_ISOLATION_FAILED:site-b")
  }
  const bAlias = await check({
    host: input.siteB.alias,
    path: input.siteB.pathname,
    port: input.siteB.port,
    releaseId: input.siteB.releaseId,
    status: 200,
  })
  if (!bAlias.body.includes(`https://${input.siteB.host}${input.siteB.pathname}`)) {
    throw new Error("E2E_ALIAS_CANONICAL_FAILED:site-b")
  }
  const bRedirect = await check({
    host: input.siteB.host,
    path: input.siteB.oldPathname,
    port: input.siteB.port,
    releaseId: input.siteB.releaseId,
    status: 301,
  })
  requireEqual(
    asText(bRedirect.headers.location),
    `https://${input.siteB.host}${input.siteB.pathname}`,
    "E2E_REDIRECT_TARGET",
  )
  if (
    !bRedirect.body.includes(`https://${input.siteB.host}${input.siteB.oldPathname}`) ||
    !/name="robots"[^>]*content="noindex,follow"|content="noindex,follow"[^>]*name="robots"/.test(
      bRedirect.body,
    ) ||
    bRedirect.body.includes("application/ld+json")
  ) {
    throw new Error("E2E_REDIRECT_SEO_FAILED:site-b")
  }
  const bSitemap = await check({
    host: input.siteB.host,
    path: "/sitemap.xml",
    port: input.siteB.port,
    releaseId: input.siteB.releaseId,
    status: 200,
  })
  assertSitemapScope(bSitemap.body, {
    forbidden: [
      `https://${input.siteB.host}${input.siteB.oldPathname}`,
      `https://${input.siteB.host}${input.siteB.gonePathname}`,
    ],
    forbiddenHosts: [input.siteA.host],
    required: [`https://${input.siteB.host}${input.siteB.pathname}`],
  })
  await check({
    host: input.siteB.host,
    path: "/missing",
    port: input.siteB.port,
    releaseId: input.siteB.releaseId,
    status: 404,
  })
  await check({
    host: input.siteB.host,
    path: input.siteB.gonePathname,
    port: input.siteB.port,
    releaseId: input.siteB.releaseId,
    status: 410,
  })

  const unknown = await check({
    host: "unpublished.example.test",
    path: input.siteA.pathname,
    port: input.siteA.port,
    status: 404,
  })
  if (unknown.body.includes(input.siteA.siteName) || unknown.body.includes(input.siteB.siteName)) {
    throw new Error("E2E_UNKNOWN_HOST_BRAND_LEAK")
  }
  return matrix
}

export const statePathOf = (evidenceDirectory) => join(evidenceDirectory, "e2e-state.json")

export const readE2eState = async () => {
  const evidenceDirectory =
    process.env.GEO_FOUNDRY_EVIDENCE_DIR ?? resolve(root, "temp/e2e")
  const path = process.env.GEO_FOUNDRY_E2E_STATE_FILE ?? statePathOf(resolve(evidenceDirectory))
  return JSON.parse(await readFile(path, "utf8"))
}

const evidencePathOf = (state, relativePath) => {
  const path = resolve(state.evidenceDirectory, relativePath)
  if (!path.startsWith(`${resolve(state.evidenceDirectory)}/`)) {
    throw new Error("E2E_EVIDENCE_PATH_FORBIDDEN")
  }
  return path
}

export const writeEvidence = async (state, relativePath, value) => {
  const path = evidencePathOf(state, relativePath)
  await mkdir(resolve(path, ".."), { recursive: true, mode: 0o700 })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}

export const writeTextEvidence = async (state, relativePath, value) => {
  const path = evidencePathOf(state, relativePath)
  await mkdir(resolve(path, ".."), { recursive: true, mode: 0o700 })
  await writeFile(path, value, { mode: 0o600 })
}

export const setupTwoSiteE2e = async (options = {}) => {
  if (process.env.GEO_FOUNDRY_E2E_ENABLED !== "true") {
    throw new Error("E2E_ENABLED_REQUIRED")
  }
  const evidenceDirectory = await evidenceDirectoryOf()
  const attemptDirectory = join(evidenceDirectory, `attempt-${randomUUID()}`)
  await mkdir(attemptDirectory, { recursive: true, mode: 0o700 })
  await Promise.all(
    ["axe", "har", "json-ld", "raw-http", "raw-ssr", "screenshots", "sitemaps"].map((directory) =>
      mkdir(join(attemptDirectory, directory), { recursive: true, mode: 0o700 }),
    ),
  )
  const accessKey = await secureFile("GEO_FOUNDRY_S3_ACCESS_KEY_FILE")
  const secretKey = await secureFile("GEO_FOUNDRY_S3_SECRET_KEY_FILE")
  const endpointHost = required("GEO_FOUNDRY_S3_ENDPOINT")
  if (endpointHost !== "127.0.0.1") {
    throw new Error("E2E_S3_LOOPBACK_REQUIRED")
  }
  const endpointPort = required("GEO_FOUNDRY_S3_PORT")
  const endpoint = `${process.env.GEO_FOUNDRY_S3_USE_SSL === "true" ? "https" : "http"}://${endpointHost}:${endpointPort}`
  const generatedRunId = `e2e-${randomUUID().replaceAll("-", "").slice(0, 20)}`
  const runId = options.runId ?? generatedRunId
  if (!/^[a-z0-9][a-z0-9-]{2,47}$/.test(runId)) {
    throw new Error("E2E_RUN_ID_INVALID")
  }
  const defaultKeyPrefix = `objects/e2e/${runId}`
  const faultKeyPrefix = `objects/todo39/${runId}`
  const keyPrefix = options.keyPrefix ?? defaultKeyPrefix
  if (keyPrefix !== defaultKeyPrefix && keyPrefix !== faultKeyPrefix) {
    throw new Error("E2E_KEY_PREFIX_FORBIDDEN")
  }
  const unlock = await acquireProjectLock(runId)
  const siteA = {
    alias: "www.site-a.test",
    category: "engineering",
    gonePathname: "/retired-site-a",
    host: "site-a.test",
    oldPathname: "/articles/site-a-release",
    pathname: "/articles/site-a-release-v2",
    siteId: "site-a-e2e",
    siteName: "Site A Engineering",
    tag: "release-engineering",
    title: "Site A Immutable Release Guide",
  }
  const siteB = {
    alias: "www.site-b.test",
    category: "operations",
    gonePathname: "/retired-site-b",
    host: "site-b.test",
    oldPathname: "/articles/site-b-previous",
    pathname: "/articles/site-b-operations",
    siteId: "site-b-e2e",
    siteName: "Site B Operations",
    tag: "release-operations",
    title: "Site B Operational Readiness Report",
  }
  const routingManifest = {
    hosts: [
      { canonical: true, host: siteA.host, siteId: siteA.siteId },
      { canonical: false, host: siteA.alias, siteId: siteA.siteId },
      { canonical: true, host: siteB.host, siteId: siteB.siteId },
      { canonical: false, host: siteB.alias, siteId: siteB.siteId },
    ],
    schemaVersion: 1,
  }
  const client = new S3Client({
    credentials: { accessKeyId: accessKey.value, secretAccessKey: secretKey.value },
    endpoint,
    forcePathStyle: true,
    region: "us-east-1",
  })
  const store = createS3ArtifactStore({ bucket, client, clientConfig: {}, keyPrefix })
  const routingStore = createS3RoutingStore({ bucket, client, clientConfig: {}, keyPrefix })
  let hostA
  let hostB
  try {
    const releaseA1 = `${runId}-a1`
    const releaseA2 = `${runId}-a2`
    const releaseA3 = `${runId}-a3`
    const releaseB1 = `${runId}-b1`
    const aV1 = await release({
      assessmentInputHash: "a".repeat(64),
      authorName: "Site A Editorial Team",
      body: "Site A v1 technical release body is fully server rendered.",
      category: siteA.category,
      contentId: 1001,
      editionId: 1001,
      gonePathname: siteA.gonePathname,
      modifiedAt: "2026-08-21T00:00:00.000Z",
      pathname: siteA.oldPathname,
      redirects: [],
      releaseId: releaseA1,
      routingManifest,
      siteDescription: "Site A technical release coverage.",
      siteId: siteA.siteId,
      siteName: siteA.siteName,
      canonicalDomain: siteA.host,
      store,
      summary: "A production Site A release article.",
      tag: siteA.tag,
      title: siteA.title,
      heading: "Release engineering controls",
    })
    void aV1
    const bV1 = await release({
      assessmentInputHash: "b".repeat(64),
      authorName: "Site B Editorial Team",
      body: "Site B operations body is fully server rendered and operationally distinct.",
      category: siteB.category,
      contentId: 2001,
      editionId: 2001,
      gonePathname: siteB.gonePathname,
      modifiedAt: "2026-08-21T00:00:00.000Z",
      pathname: siteB.pathname,
      redirects: [{ fromPathname: siteB.oldPathname, targetUrl: siteB.pathname }],
      releaseId: releaseB1,
      routingManifest,
      siteDescription: "Site B operational release coverage.",
      siteId: siteB.siteId,
      siteName: siteB.siteName,
      canonicalDomain: siteB.host,
      store,
      summary: "A production Site B operational report.",
      tag: siteB.tag,
      title: siteB.title,
      heading: "Operational readiness evidence",
    })
    await publishRouting({
      releases: [aV1.manifest, bV1.manifest],
      routingId: `${runId}-routing-v1`,
      routingManifest,
      routingStore,
      siteIds: [siteA.siteId, siteB.siteId],
      updatedAt: "2026-08-21T00:00:00.000Z",
    })

    hostA = await startHost({
      directory: attemptDirectory,
      name: "site-a",
      packageRoot: resolve(root, "examples/site-a-next"),
      environment: (port) => ({
        GEO_FOUNDRY_SITE_A_S3_ACCESS_KEY_FILE: accessKey.path,
        GEO_FOUNDRY_SITE_A_S3_BUCKET: bucket,
        GEO_FOUNDRY_SITE_A_S3_ENDPOINT: endpoint,
        GEO_FOUNDRY_SITE_A_S3_KEY_PREFIX: keyPrefix,
        GEO_FOUNDRY_SITE_A_S3_SECRET_KEY_FILE: secretKey.path,
        GEO_FOUNDRY_SITE_A_S3_TIMEOUT_MS: "3000",
        HOSTNAME: "127.0.0.1",
        NODE_ENV: "production",
        PATH: process.env.PATH ?? "",
        PORT: String(port),
      }),
    })
    hostB = await startHost({
      directory: attemptDirectory,
      name: "site-b",
      packageRoot: resolve(root, "examples/site-b-express"),
      environment: (port) => ({
        GEO_FOUNDRY_SITE_B_S3_ACCESS_KEY_FILE: accessKey.path,
        GEO_FOUNDRY_SITE_B_S3_BUCKET: bucket,
        GEO_FOUNDRY_SITE_B_S3_ENDPOINT: endpoint,
        GEO_FOUNDRY_SITE_B_S3_KEY_PREFIX: keyPrefix,
        GEO_FOUNDRY_SITE_B_S3_SECRET_KEY_FILE: secretKey.path,
        GEO_FOUNDRY_SITE_B_S3_TIMEOUT_MS: "3000",
        HOSTNAME: "127.0.0.1",
        NODE_ENV: "production",
        PATH: process.env.PATH ?? "",
        PORT: String(port),
      }),
    })

    const aV2 = await release({
      assessmentInputHash: "c".repeat(64),
      authorName: "Site A Editorial Team",
      body: "Site A v2 technical release body preserves the active URL before the approved rename.",
      category: siteA.category,
      contentId: 1001,
      editionId: 1001,
      gonePathname: siteA.gonePathname,
      modifiedAt: "2026-08-21T00:01:00.000Z",
      pathname: siteA.oldPathname,
      redirects: [],
      releaseId: releaseA2,
      routingManifest,
      siteDescription: "Site A technical release coverage.",
      siteId: siteA.siteId,
      siteName: siteA.siteName,
      canonicalDomain: siteA.host,
      store,
      summary: "A production Site A release article updated in place.",
      tag: siteA.tag,
      title: siteA.title,
      heading: "Release engineering controls",
    })
    await publishRouting({
      releases: [aV2.manifest, bV1.manifest],
      routingId: `${runId}-routing-v2`,
      routingManifest,
      routingStore,
      siteIds: [siteA.siteId, siteB.siteId],
      updatedAt: "2026-08-21T00:01:00.000Z",
    })
    const stable = await requestHost({
      host: siteA.host,
      path: siteA.oldPathname,
      port: hostA.port,
    })
    requireEqual(stable.status, 200, "E2E_STABLE_URL_STATUS")
    requireEqual(asText(stable.headers["x-geo-release-id"]), releaseA2, "E2E_STABLE_URL_RELEASE")

    const aV3 = await release({
      assessmentInputHash: "d".repeat(64),
      authorName: "Site A Editorial Team",
      body: "Site A renamed release body remains fully server rendered after the approved slug change.",
      category: siteA.category,
      contentId: 1001,
      editionId: 1001,
      gonePathname: siteA.gonePathname,
      modifiedAt: "2026-08-21T00:02:00.000Z",
      pathname: siteA.pathname,
      redirects: [{ fromPathname: siteA.oldPathname, targetUrl: siteA.pathname }],
      releaseId: releaseA3,
      routingManifest,
      siteDescription: "Site A technical release coverage.",
      siteId: siteA.siteId,
      siteName: siteA.siteName,
      canonicalDomain: siteA.host,
      store,
      summary: "A production Site A article after an approved slug rename.",
      tag: siteA.tag,
      title: siteA.title,
      heading: "Release engineering controls",
    })
    await publishRouting({
      releases: [aV3.manifest, bV1.manifest],
      routingId: `${runId}-routing-v3`,
      routingManifest,
      routingStore,
      siteIds: [siteA.siteId, siteB.siteId],
      updatedAt: "2026-08-21T00:02:00.000Z",
    })

    const state = {
      attemptDirectory,
      evidenceDirectory: attemptDirectory,
      keyPrefix,
      releases: { siteAStable: releaseA2, siteAFinal: releaseA3, siteB: releaseB1 },
      siteA: { ...siteA, port: hostA.port, releaseId: releaseA3 },
      siteB: { ...siteB, port: hostB.port, releaseId: releaseB1 },
      stablePath: { pathname: siteA.oldPathname, releaseId: releaseA2, status: stable.status },
    }
    const matrix = await rawMatrix(state)
    await writeEvidence(state, "raw-http/matrix.json", matrix)
    await writeEvidence(state, "raw-http/stable-path.json", state.stablePath)
    await writeEvidence(state, "evidence-index.json", {
      axe: "axe/",
      har: "har/",
      jsonLd: "json-ld/",
      playwright: {
        artifacts: "../playwright-artifacts/",
        htmlReport: "../playwright-report/index.html",
        jsonResults: "../playwright-results.json",
        junit: "../playwright.junit.xml",
      },
      rawHttpMatrix: "raw-http/matrix.json",
      rawSsr: "raw-ssr/",
      screenshots: "screenshots/",
      sitemaps: "sitemaps/",
      stablePath: "raw-http/stable-path.json",
      state: "../e2e-state.json",
    })
    await writeFile(statePathOf(evidenceDirectory), `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600,
    })
    return async () => {
      try {
        await stopHost(hostB)
        await stopHost(hostA)
        await deletePrefix(client, keyPrefix)
      } finally {
        client.destroy()
        await unlock()
      }
    }
  } catch (error) {
    try {
      await stopHost(hostB)
      await stopHost(hostA)
      await deletePrefix(client, keyPrefix).catch(() => undefined)
    } finally {
      client.destroy()
      await unlock()
    }
    throw error
  }
}

export const listEvidenceFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  return entries.map((entry) => entry.name).sort()
}

export const removeAttemptDirectory = async (directory) => {
  await rm(directory, { force: true, recursive: true })
}
