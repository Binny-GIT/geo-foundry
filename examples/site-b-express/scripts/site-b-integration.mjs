import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { request } from "node:http"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { compileSite } from "@geo/compiler"
import {
  createS3ArtifactStore,
  createS3RoutingStore,
  planRelease,
  publishRelease,
  publishRoutingManifest,
} from "@geo/publisher"
import { verifyManifest } from "@geo/schema/release/v1"

import { acquireProjectLock } from "../../../scripts/shared-services/lock.mjs"

const packageRoot = resolve(import.meta.dirname, "..")
const workspaceRoot = resolve(packageRoot, "../..")
const rustfsEnvironmentPath = resolve(workspaceRoot, ".test/rustfs-test.env")
const bucket = "geo-foundry"
const requestTimeoutMs = 12_000

const required = (environment, name) => {
  const value = environment[name]
  if (value === undefined || value.length === 0)
    throw new Error(`SITE_B_INTEGRATION_ENV_REQUIRED:${name}`)
  return value
}

const parseEnvironment = (contents) =>
  Object.fromEntries(
    contents
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]),
  )

const runIdOf = () => `site-b-express-${Date.now().toString(36)}`
const physicalKey = (prefix, key) => `${prefix}/${key}`

const requestOf = (input) => ({
  clock: { now: "2026-08-20T00:00:00Z" },
  compilerVersion: "1.0.0",
  editions: [
    {
      assessmentInputHash: "b".repeat(64),
      assessmentState: "passed",
      author: {
        id: "author-site-b",
        name: "Site B Author",
        url: `https://${input.host}/authors/site-b`,
      },
      body: [
        { blockType: "paragraph", text: "Site B operations report body with release metrics." },
      ],
      categories: ["reports"],
      contentId: 3601,
      editionId: 3601,
      media: [],
      modifiedAt: "2026-08-20T00:00:00Z",
      publishedAt: "2026-08-20T00:00:00Z",
      siteId: input.siteId,
      status: "approved",
      summary: "Site B Express integration fixture.",
      tags: ["operations"],
      title: "Site B Operations Report",
      urlPathname: "/articles/site-b",
      urlStatus: "active",
    },
  ],
  gonePathnames: ["/retired"],
  listings: {
    articles: { pathname: "/articles", pageSize: 10 },
    categories: [{ id: "cat-reports", pathname: "/reports", slug: "reports", title: "Reports" }],
    tags: [
      {
        id: "tag-operations",
        pathname: "/tags/operations",
        slug: "operations",
        title: "Operations",
      },
    ],
  },
  notFound: { pathname: "/not-found" },
  redirects: [{ fromPathname: "/old-site-b", targetUrl: "/articles/site-b" }],
  site: {
    canonicalDomain: input.host,
    locale: "en-US",
    name: "Site B Operations",
    organization: { name: "Site B Operations" },
    seoDefaults: { description: "Site B operations and business coverage.", title: "Site B" },
    siteId: input.siteId,
    timezone: "UTC",
  },
})

const reservePort = async () =>
  new Promise((resolvePort, rejectPort) => {
    const server = createServer()
    server.once("error", rejectPort)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (typeof address !== "object" || address === null) {
        rejectPort(new Error("SITE_B_PORT_RESERVATION_FAILED"))
        return
      }
      server.close((error) => (error === undefined ? resolvePort(address.port) : rejectPort(error)))
    })
  })

const requestHost = (input) =>
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
            body: Buffer.concat(chunks),
            durationMs: Date.now() - startedAt,
            headers: response.headers,
            status: response.statusCode ?? 0,
          }),
        )
      },
    )
    client.on("timeout", () => client.destroy(new Error("SITE_B_REQUEST_TIMEOUT")))
    client.on("error", rejectRequest)
    client.end()
  })

const startHost = async (input) => {
  const port = await reservePort()
  const child = spawn(process.execPath, ["server/server.mjs"], {
    cwd: packageRoot,
    env: {
      GEO_FOUNDRY_SITE_B_S3_ACCESS_KEY_FILE: input.accessKeyPath,
      GEO_FOUNDRY_SITE_B_S3_BUCKET: bucket,
      GEO_FOUNDRY_SITE_B_S3_ENDPOINT: input.endpoint,
      GEO_FOUNDRY_SITE_B_S3_KEY_PREFIX: input.keyPrefix,
      GEO_FOUNDRY_SITE_B_S3_SECRET_KEY_FILE: input.secretKeyPath,
      GEO_FOUNDRY_SITE_B_S3_TIMEOUT_MS: input.timeoutMs,
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      PATH: process.env.PATH ?? "",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const stdout = []
  const stderr = []
  child.stdout.on("data", (chunk) => stdout.push(chunk))
  child.stderr.on("data", (chunk) => stderr.push(chunk))
  await new Promise((resolveReady, rejectReady) => {
    const timer = setTimeout(
      () => rejectReady(new Error("SITE_B_HOST_READY_TIMEOUT")),
      requestTimeoutMs,
    )
    child.once("error", rejectReady)
    child.once("exit", (code) => {
      clearTimeout(timer)
      rejectReady(new Error(`SITE_B_HOST_EXITED:${String(code)}`))
    })
    const probe = async () => {
      try {
        await requestHost({ host: "unknown.test", path: "/", port })
        clearTimeout(timer)
        resolveReady()
      } catch {
        setTimeout(probe, 100)
      }
    }
    void probe()
  })
  return { child, port, stderr, stdout }
}

const stopHost = async (host) => {
  host.child.kill("SIGTERM")
  await new Promise((resolveStop) => host.child.once("exit", resolveStop))
}

const cleanup = async (client, keyPrefix, logicalKeys) => {
  const deleted = []
  for (const key of logicalKeys) {
    const keyToDelete = physicalKey(keyPrefix, key)
    if (!keyToDelete.startsWith(`${keyPrefix}/`)) throw new Error("SITE_B_FOREIGN_CLEANUP_KEY")
    const output = await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: keyToDelete }))
    deleted.push({ key, status: output.$metadata.httpStatusCode ?? null })
  }
  return deleted
}

const responseText = (response) => response.body.toString("utf8")

export const runSiteBIntegration = async () => {
  const environment = parseEnvironment(await readFile(rustfsEnvironmentPath, "utf8"))
  const accessKey = required(environment, "GEO_FOUNDRY_S3_ACCESS_KEY")
  const secretKey = required(environment, "GEO_FOUNDRY_S3_SECRET_KEY")
  const endpoint = `http://127.0.0.1:${required(environment, "GEO_FOUNDRY_S3_PORT")}`
  const runId = runIdOf()
  const keyPrefix = `objects/site-b-express/${runId}`
  const siteId = `site-b-${runId}`
  const releaseId = `release-b-${runId}`
  const host = `${siteId}.test`
  const alias = `www.${host}`
  const foreignHost = `foreign-${runId}.test`
  const routingId = `routing-${runId}`
  const client = new S3Client({
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    endpoint,
    forcePathStyle: true,
    region: "rustfs",
  })
  const logicalKeys = new Set()
  const temporaryRoot = join(tmpdir(), runId)
  await mkdir(temporaryRoot, { recursive: true })
  const accessKeyPath = join(temporaryRoot, "access-key")
  const secretKeyPath = join(temporaryRoot, "secret-key")
  await writeFile(accessKeyPath, accessKey, { encoding: "utf8", mode: 0o600 })
  await writeFile(secretKeyPath, secretKey, { encoding: "utf8", mode: 0o600 })
  const unlock = await acquireProjectLock(runId)
  let normalHost
  let deniedHost
  let cleaned = false
  try {
    const store = createS3ArtifactStore({ bucket, client, clientConfig: {}, keyPrefix })
    const routingStore = createS3RoutingStore({ bucket, client, clientConfig: {}, keyPrefix })
    const routingManifest = {
      hosts: [
        { canonical: true, host, siteId },
        { canonical: false, host: alias, siteId },
      ],
      schemaVersion: 1,
    }
    const compileOutput = await compileSite(requestOf({ host, siteId }))
    const plan = planRelease({
      compileOutput,
      createdAt: "2026-08-20T00:00:00.000Z",
      releaseId,
      routingManifest,
      siteId,
      sourceVersionIds: [`source-${siteId}`],
    })
    for (const object of plan.objects)
      logicalKeys.add(`sites/${siteId}/releases/${releaseId}/${object.path}`)
    logicalKeys.add(`sites/${siteId}/releases/${releaseId}/manifest.json`)
    logicalKeys.add(`sites/${siteId}/channels/current.json`)
    await publishRelease({
      actor: { actorId: "site-b-integration", kind: "service" },
      planned: plan,
      store,
      verifiedManifest: await verifyManifest(plan.manifest),
    })
    logicalKeys.add(`routing/releases/${routingId}/domains.json`)
    logicalKeys.add("routing/channels/current.json")
    await publishRoutingManifest({
      manifest: routingManifest,
      routingId,
      routingStore,
      sitePointerObjectKeys: [`sites/${siteId}/channels/current.json`],
      siteReleaseObjectKeys: [`sites/${siteId}/releases/${releaseId}/manifest.json`],
      updatedAt: "2026-08-20T00:00:00.000Z",
    })

    normalHost = await startHost({
      accessKeyPath,
      endpoint,
      keyPrefix,
      secretKeyPath,
      timeoutMs: "3000",
    })
    const checked = []
    for (const item of [
      { host, path: "/articles/site-b", status: 200 },
      { host, path: "/articles", status: 200 },
      { host, path: "/reports", status: 200 },
      { host, path: "/tags/operations", status: 200 },
      { host: alias, path: "/articles/site-b", status: 200 },
      { host, path: "/missing", status: 404 },
      { host, path: "/old-site-b", status: 301 },
      { host, path: "/retired", status: 410 },
      { host: foreignHost, path: "/articles/site-b", status: 404 },
    ]) {
      const response = await requestHost({ ...item, port: normalHost.port })
      assert.equal(response.status, item.status)
      if (item.host === host || item.host === alias) {
        assert.equal(response.headers["x-geo-release-id"], releaseId)
        assert.equal(
          response.headers["cache-control"],
          item.path === "/retired" ? "no-store" : "public, max-age=0, must-revalidate",
        )
      } else {
        assert.equal(response.headers["cache-control"], "no-store")
        assert.equal("x-geo-release-id" in response.headers, false)
      }
      checked.push({ host: item.host, path: item.path, status: response.status })
      if (item.path === "/articles/site-b" && item.host === host) {
        const html = responseText(response)
        assert.match(html, /Site B Operations Report/)
        assert.match(html, /Site B operations report body with release metrics\./)
        assert.match(html, /Site B Operations Desk/)
        assert.match(html, new RegExp(`https://${host}/articles/site-b`))
        assert.match(html, /application\/ld\+json/)
      }
      if (item.host === alias && item.path === "/articles/site-b") {
        assert.match(responseText(response), new RegExp(`https://${host}/articles/site-b`))
      }
      if (item.path === "/old-site-b") {
        assert.equal(response.headers.location, `https://${host}/articles/site-b`)
        const html = responseText(response)
        assert.match(html, new RegExp(`https://${host}/old-site-b`))
        assert.match(
          html,
          /name="robots"[^>]*content="noindex,follow"|content="noindex,follow"[^>]*name="robots"/,
        )
        assert.equal(html.includes("application/ld+json"), false)
      }
      if (item.host === foreignHost) {
        const html = responseText(response)
        assert.equal(html.includes("Site B Operations"), false)
        assert.equal(html.includes(releaseId), false)
      }
    }
    const sitemap = await requestHost({ host, path: "/sitemap.xml", port: normalHost.port })
    assert.equal(sitemap.status, 200)
    assert.equal(sitemap.headers["content-type"], "application/xml")
    assert.equal(sitemap.headers["x-geo-release-id"], releaseId)
    assert.match(sitemap.body.toString("utf8"), /<urlset/)
    await stopHost(normalHost)
    normalHost = undefined

    deniedHost = await startHost({
      accessKeyPath,
      endpoint: "http://127.0.0.1:1",
      keyPrefix,
      secretKeyPath,
      timeoutMs: "300",
    })
    const denied = await requestHost({ host, path: "/articles/site-b", port: deniedHost.port })
    assert.equal(denied.status, 503)
    assert.equal(denied.headers["cache-control"], "no-store")
    assert.ok(denied.durationMs <= requestTimeoutMs)
    await stopHost(deniedHost)
    deniedHost = undefined

    const recoveryHost = await startHost({
      accessKeyPath,
      endpoint,
      keyPrefix,
      secretKeyPath,
      timeoutMs: "3000",
    })
    const recovery = await requestHost({ host, path: "/articles/site-b", port: recoveryHost.port })
    assert.equal(recovery.status, 200)
    assert.equal(recovery.headers["x-geo-release-id"], releaseId)
    await stopHost(recoveryHost)

    const deleted = await cleanup(client, keyPrefix, [...logicalKeys])
    cleaned = true
    const evidence = {
      cleanup: { deleted, exactInventory: true },
      checked,
      denied: { durationMs: denied.durationMs, status: denied.status },
      releaseId,
      runId,
      sitemap: { contentType: sitemap.headers["content-type"], status: sitemap.status },
      sharedInfrastructure:
        "PostgreSQL, Redis, RustFS, and mk-dev containers were not stopped or reconfigured.",
    }
    const evidenceDirectory = resolve(
      workspaceRoot,
      ".omo/evidence/task-36-geo-foundry-development-plan",
    )
    await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 })
    await writeFile(
      join(evidenceDirectory, `${runId}.json`),
      `${JSON.stringify(evidence, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    )
    process.stdout.write(`${JSON.stringify(evidence)}\n`)
    return evidence
  } finally {
    if (normalHost !== undefined) normalHost.child.kill("SIGKILL")
    if (deniedHost !== undefined) deniedHost.child.kill("SIGKILL")
    try {
      if (!cleaned) await cleanup(client, keyPrefix, [...logicalKeys])
    } finally {
      client.destroy()
      await rm(temporaryRoot, { force: true, recursive: true })
      await unlock()
    }
  }
}
