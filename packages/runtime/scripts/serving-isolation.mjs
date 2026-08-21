import { fork } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { request } from "node:http"
import { resolve } from "node:path"

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

const workspaceRoot = resolve(import.meta.dirname, "../../..")
const rustfsEnvironmentPath = resolve(workspaceRoot, ".test/rustfs-test.env")
const bucket = "geo-foundry"
const requestTimeoutMs = 8_000

const required = (environment, name) => {
  const value = environment[name]
  if (value === undefined || value.length === 0) {
    throw new Error(`SERVING_ISOLATION_ENV_REQUIRED:${name}`)
  }
  return value
}

const parseEnvironment = (contents) =>
  Object.fromEntries(
    contents
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]),
  )

const runIdOf = () => `serving-isolation-${Date.now().toString(36)}`

const requestOf = (input) => ({
  clock: { now: "2026-08-20T00:00:00Z" },
  compilerVersion: "1.0.0",
  editions: [
    {
      assessmentInputHash: "a".repeat(64),
      assessmentState: "passed",
      author: {
        id: "author-runtime",
        name: "Runtime Fixture",
        url: `https://${input.host}/authors/runtime`,
      },
      body: [{ blockType: "paragraph", text: `Serving isolation fixture ${input.siteId}.` }],
      categories: ["guides"],
      contentId: input.contentId,
      editionId: input.editionId,
      media: [],
      modifiedAt: "2026-08-20T00:00:00Z",
      publishedAt: "2026-08-20T00:00:00Z",
      siteId: input.siteId,
      status: "approved",
      summary: `Serving isolation summary ${input.siteId}.`,
      tags: ["runtime"],
      title: `Serving isolation ${input.siteId}`,
      urlPathname: input.articlePath,
      urlStatus: "active",
    },
  ],
  listings: {
    articles: { pathname: "/articles", pageSize: 10 },
    categories: [{ id: "cat-guides", pathname: "/guides", slug: "guides", title: "Guides" }],
    tags: [{ id: "tag-runtime", pathname: "/tags/runtime", slug: "runtime", title: "Runtime" }],
  },
  notFound: { pathname: "/not-found" },
  redirects: [{ fromPathname: input.redirectPath, targetUrl: input.articlePath }],
  site: {
    canonicalDomain: input.host,
    locale: "en-US",
    name: `Serving isolation ${input.siteId}`,
    organization: { name: `Serving isolation ${input.siteId}` },
    seoDefaults: { description: `Serving isolation ${input.siteId}.`, title: input.siteId },
    siteId: input.siteId,
    timezone: "UTC",
  },
})

const requestRuntime = async (input) =>
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
            path: input.path,
            status: response.statusCode ?? 0,
          }),
        )
      },
    )
    client.on("timeout", () => client.destroy(new Error("RUNTIME_HOST_TIMEOUT")))
    client.on("error", rejectRequest)
    client.end()
  })

const startHost = async (input) =>
  new Promise((resolveHost, rejectHost) => {
    const child = fork(resolve(import.meta.dirname, "../test/integration/runtime-host.mjs"), [], {
      env: {
        GEO_FOUNDRY_RUNTIME_DENY_RUSTFS: input.denyRustfs ? "true" : "false",
        GEO_FOUNDRY_RUNTIME_S3_ACCESS_KEY: input.environment.GEO_FOUNDRY_S3_ACCESS_KEY,
        GEO_FOUNDRY_RUNTIME_S3_BUCKET: bucket,
        GEO_FOUNDRY_RUNTIME_S3_ENDPOINT: `http://127.0.0.1:${input.environment.GEO_FOUNDRY_S3_PORT}`,
        GEO_FOUNDRY_RUNTIME_S3_KEY_PREFIX: input.keyPrefix,
        GEO_FOUNDRY_RUNTIME_S3_SECRET_KEY: input.environment.GEO_FOUNDRY_S3_SECRET_KEY,
        GEO_FOUNDRY_RUNTIME_S3_TIMEOUT_MS: "3000",
        PATH: process.env.PATH ?? "",
      },
      serialization: "advanced",
      silent: true,
    })
    const stdout = []
    const stderr = []
    let ready = false
    const timer = setTimeout(() => rejectHost(new Error("RUNTIME_HOST_READY_TIMEOUT")), requestTimeoutMs)
    child.stdout.on("data", (chunk) => stdout.push(chunk))
    child.stderr.on("data", (chunk) => stderr.push(chunk))
    child.on("error", rejectHost)
    child.on("exit", (code) => {
      if (!ready) {
        clearTimeout(timer)
        rejectHost(new Error(`RUNTIME_HOST_EXITED:${String(code)}`))
      }
    })
    child.on("message", (message) => {
      if (message?.kind === "ready") {
        ready = true
        clearTimeout(timer)
        resolveHost({ child, port: message.port, stderr, stdout })
      }
    })
  })

const stopHost = async (host) =>
  new Promise((resolveStop, rejectStop) => {
    const timer = setTimeout(() => {
      host.child.kill("SIGKILL")
      rejectStop(new Error("RUNTIME_HOST_STOP_TIMEOUT"))
    }, requestTimeoutMs)
    host.child.on("message", (message) => {
      if (message?.kind === "report") {
        clearTimeout(timer)
        resolveStop({
          report: message.report,
          stderr: Buffer.concat(host.stderr).toString("utf8"),
          stdout: Buffer.concat(host.stdout).toString("utf8"),
        })
      }
    })
    host.child.send("shutdown")
  })

const assertRequest = (response, status, releaseId) => {
  if (response.status !== status || response.headers["x-geo-release-id"] !== releaseId) {
    throw new Error(`SERVING_ISOLATION_RESPONSE_MISMATCH:${String(response.status)}:${String(status)}`)
  }
}

const controlPlaneEnvironmentNames = [
  "GEO_FOUNDRY_CMS_SECRET_FILE",
  "GEO_FOUNDRY_PG_DATABASE",
  "GEO_FOUNDRY_PG_HOST",
  "GEO_FOUNDRY_PG_PASSWORD_FILE",
  "GEO_FOUNDRY_REDIS_HOST",
  "GEO_FOUNDRY_REDIS_PASSWORD_FILE",
  "GEO_FOUNDRY_REDIS_USERNAME_FILE",
  "OPENAI_API_KEY",
]

const assertNoForbiddenAttempts = (report) => {
  if (report.egress.forbiddenAttempts !== 0 || !report.egress.onlyApprovedDestinations) {
    throw new Error("SERVING_ISOLATION_EGRESS_FORBIDDEN")
  }
  if (controlPlaneEnvironmentNames.some((name) => report.environmentNames.includes(name))) {
    throw new Error("SERVING_ISOLATION_CONTROL_PLANE_ENV_PRESENT")
  }
}

const physical = (prefix, key) => `${prefix}/${key}`

const cleanup = async (client, keyPrefix, logicalKeys) => {
  const deleted = []
  for (const key of logicalKeys) {
    const physicalKey = physical(keyPrefix, key)
    if (!physicalKey.startsWith(`${keyPrefix}/`)) {
      throw new Error("SERVING_ISOLATION_FOREIGN_CLEANUP_KEY")
    }
    const output = await client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: physicalKey }),
      { abortSignal: AbortSignal.timeout(requestTimeoutMs) },
    )
    deleted.push({ key, status: output.$metadata.httpStatusCode ?? null })
  }
  return deleted
}

export const runServingIsolation = async () => {
  if (process.env.GEO_FOUNDRY_SERVING_ISOLATION !== "true") {
    throw new Error("SERVING_ISOLATION_OPT_IN_REQUIRED")
  }
  const environment = parseEnvironment(await readFile(rustfsEnvironmentPath, "utf8"))
  required(environment, "GEO_FOUNDRY_S3_ACCESS_KEY")
  required(environment, "GEO_FOUNDRY_S3_PORT")
  required(environment, "GEO_FOUNDRY_S3_SECRET_KEY")
  const runId = runIdOf()
  const releasePrefix = `objects/serving-isolation/${runId}`
  const keyPrefix = releasePrefix
  const releaseA = `release-a-${runId}`
  const releaseB = `release-b-${runId}`
  const siteA = `site-a-${runId}`
  const siteB = `site-b-${runId}`
  const hostA = `${siteA}.test`
  const hostB = `${siteB}.test`
  const routingId = `routing-${runId}`
  const routingManifest = {
    hosts: [
      { canonical: true, host: hostA, siteId: siteA },
      { canonical: true, host: hostB, siteId: siteB },
    ],
    schemaVersion: 1,
  }
  const client = new S3Client({
    credentials: {
      accessKeyId: environment.GEO_FOUNDRY_S3_ACCESS_KEY,
      secretAccessKey: environment.GEO_FOUNDRY_S3_SECRET_KEY,
    },
    endpoint: `http://127.0.0.1:${environment.GEO_FOUNDRY_S3_PORT}`,
    forcePathStyle: true,
    region: "rustfs",
  })
  const store = createS3ArtifactStore({ bucket, client, clientConfig: {}, keyPrefix })
  const routingStore = createS3RoutingStore({ bucket, client, clientConfig: {}, keyPrefix })
  const logicalKeys = new Set()
  const releaseFor = async (input) => {
    const compileOutput = await compileSite(requestOf(input))
    const plan = planRelease({
      compileOutput,
      createdAt: "2026-08-20T00:00:00.000Z",
      releaseId: input.releaseId,
      routingManifest,
      siteId: input.siteId,
      sourceVersionIds: [`source-${input.siteId}`],
    })
    for (const object of plan.objects) {
      logicalKeys.add(`sites/${input.siteId}/releases/${input.releaseId}/${object.path}`)
    }
    logicalKeys.add(`sites/${input.siteId}/releases/${input.releaseId}/manifest.json`)
    logicalKeys.add(`sites/${input.siteId}/channels/current.json`)
    const verified = await verifyManifest(plan.manifest)
    await publishRelease({
      actor: { actorId: "serving-isolation", kind: "service" },
      planned: plan,
      store,
      verifiedManifest: verified,
    })
    return { articlePath: input.articlePath, releaseId: input.releaseId, siteId: input.siteId }
  }

  const releaseInputs = [
    {
      articlePath: "/articles/a",
      contentId: 1001,
      editionId: 1001,
      host: hostA,
      redirectPath: "/old-a",
      releaseId: releaseA,
      siteId: siteA,
    },
    {
      articlePath: "/articles/b",
      contentId: 1002,
      editionId: 1002,
      host: hostB,
      redirectPath: "/old-b",
      releaseId: releaseB,
      siteId: siteB,
    },
  ]

  const unlock = await acquireProjectLock(runId)
  let cleanupRecords = []
  let resourcesReleased = false
  let normalHost
  let deniedHost
  try {
    const [publishedA, publishedB] = await Promise.all(releaseInputs.map(releaseFor))
    logicalKeys.add(`routing/releases/${routingId}/domains.json`)
    logicalKeys.add("routing/channels/current.json")
    await publishRoutingManifest({
      manifest: routingManifest,
      routingId,
      routingStore,
      sitePointerObjectKeys: [
        `sites/${siteA}/channels/current.json`,
        `sites/${siteB}/channels/current.json`,
      ],
      siteReleaseObjectKeys: [
        `sites/${siteA}/releases/${releaseA}/manifest.json`,
        `sites/${siteB}/releases/${releaseB}/manifest.json`,
      ],
      updatedAt: "2026-08-20T00:00:00.000Z",
    })

    normalHost = await startHost({ denyRustfs: false, environment, keyPrefix })
    const coldRequests = []
    for (const item of [
      { host: hostA, path: publishedA.articlePath, releaseId: publishedA.releaseId, status: 200 },
      { host: hostA, path: "/articles", releaseId: publishedA.releaseId, status: 200 },
      { host: hostA, path: "/sitemap.xml", releaseId: publishedA.releaseId, status: 200 },
      { host: hostB, path: publishedB.articlePath, releaseId: publishedB.releaseId, status: 200 },
      { host: hostB, path: "/articles", releaseId: publishedB.releaseId, status: 200 },
      { host: hostB, path: "/sitemap.xml", releaseId: publishedB.releaseId, status: 200 },
      { host: hostA, path: "/old-a", releaseId: publishedA.releaseId, status: 301 },
      { host: hostB, path: "/missing", releaseId: publishedB.releaseId, status: 404 },
    ]) {
      const response = await requestRuntime({ host: item.host, path: item.path, port: normalHost.port })
      assertRequest(response, item.status, item.releaseId)
      coldRequests.push({
        durationMs: response.durationMs,
        host: item.host,
        path: item.path,
        releaseId: item.releaseId,
        status: response.status,
      })
    }
    const normalReport = await stopHost(normalHost)
    normalHost = undefined
    assertNoForbiddenAttempts(normalReport.report)
    if (
      normalReport.report.access.length === 0 ||
      !normalReport.report.access.some((entry) => entry.key.startsWith(`sites/${siteA}/`)) ||
      !normalReport.report.access.some((entry) => entry.key.startsWith(`sites/${siteB}/`)) ||
      !normalReport.report.access.some((entry) => entry.key.endsWith("sitemap.xml"))
    ) {
      throw new Error("SERVING_ISOLATION_COLD_RUSTFS_READ_MISSING")
    }

    deniedHost = await startHost({ denyRustfs: true, environment, keyPrefix })
    const deniedResponse = await requestRuntime({ host: hostA, path: publishedA.articlePath, port: deniedHost.port })
    if (deniedResponse.status !== 503 || deniedResponse.durationMs > requestTimeoutMs) {
      throw new Error("SERVING_ISOLATION_RUSTFS_DENIAL_UNBOUNDED")
    }
    const deniedReport = await stopHost(deniedHost)
    deniedHost = undefined
    if (deniedReport.report.egress.forbiddenAttempts === 0) {
      throw new Error("SERVING_ISOLATION_RUSTFS_DENIAL_NOT_OBSERVED")
    }

    const recoveryHost = await startHost({ denyRustfs: false, environment, keyPrefix })
    const recovered = await requestRuntime({ host: hostA, path: publishedA.articlePath, port: recoveryHost.port })
    assertRequest(recovered, 200, publishedA.releaseId)
    const recoveryReport = await stopHost(recoveryHost)
    assertNoForbiddenAttempts(recoveryReport.report)

    cleanupRecords = await cleanup(client, keyPrefix, [...logicalKeys])
    resourcesReleased = true
    const evidence = {
      cleanup: { deleted: cleanupRecords, exactInventory: true },
      controlPlane: {
        cms: "not-started",
        fakeLlm: "not-started-in-process-worker-provider",
        postgres: "shared-service-not-stopped-and-denied-to-runtime",
        redis: "shared-service-not-stopped-and-denied-to-runtime",
        worker: "not-started",
      },
      coldRequests,
      cleanupScope: { keyPrefix, logicalKeyCount: logicalKeys.size },
      denied: { durationMs: deniedResponse.durationMs, status: deniedResponse.status },
      normalAccess: normalReport.report.access,
      normalEgress: normalReport.report.egress,
      recovery: { releaseId: publishedA.releaseId, status: recovered.status },
      recoveryEgress: recoveryReport.report.egress,
      runId,
      sharedInfrastructure: "PostgreSQL, Redis, RustFS, and mk-dev containers were not stopped or reconfigured.",
    }
    const evidenceDirectory = resolve(workspaceRoot, ".omo/evidence/task-32-geo-foundry-development-plan")
    await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 })
    const evidencePath = resolve(evidenceDirectory, `${runId}.json`)
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
    return evidence
  } finally {
    if (normalHost !== undefined) {
      normalHost.child.kill("SIGKILL")
    }
    if (deniedHost !== undefined) {
      deniedHost.child.kill("SIGKILL")
    }
    try {
      if (!resourcesReleased) {
        await cleanup(client, keyPrefix, [...logicalKeys])
      }
    } finally {
      client.destroy()
      await unlock()
    }
  }
}
