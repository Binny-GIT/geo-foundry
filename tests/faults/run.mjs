import { spawn } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { join, resolve } from "node:path"

import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { compileSite } from "@geo/compiler"
import {
  createS3ArtifactStore,
  planRelease,
  publishRelease,
  StalePointerEtagError,
} from "@geo/publisher"
import { verifyManifest } from "@geo/schema/release/v1"
import { acquireProjectLock } from "../../scripts/shared-services/lock.mjs"
import { requestHost, setupTwoSiteE2e } from "../e2e/support.mjs"
import { runControlPlaneFaultRecovery } from "./control-plane-supervisor.mjs"
import {
  assertFaultRunId,
  assertLoopbackEndpoint,
  assertLoopbackRedisEndpoint,
  createFaultRunId,
  faultCase,
  faultEvidenceDirectoryOf,
  ownedPhysicalKey,
  secureFile,
  writeFaultEvidence,
} from "./support.mjs"

const root = resolve(import.meta.dirname, "../..")
const bucket = "geo-foundry"
const timeoutMs = 15_000

const reservePort = async () =>
  new Promise((resolvePort, rejectPort) => {
    const server = createServer()
    server.once("error", rejectPort)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      server.close((error) => {
        if (error !== undefined || typeof address !== "object" || address === null) {
          rejectPort(error ?? new Error("FAULT_HOST_PORT_RESERVATION_FAILED"))
          return
        }
        resolvePort(address.port)
      })
    })
  })

const waitForHost = async (port) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await requestHost({ host: "unknown.test", path: "/", port })
      return
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 125))
    }
  }
  throw new Error("FAULT_HOST_READY_TIMEOUT")
}

const stopHost = async (child) => {
  if (child.exitCode !== null || child.pid === undefined) {
    return
  }
  try {
    process.kill(-child.pid, "SIGTERM")
  } catch {
    return
  }
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 10_000)),
  ])
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL")
    } catch {}
  }
}

const startHost = async (input) => {
  const port = await reservePort()
  const environmentPrefix = input.site === "a" ? "GEO_FOUNDRY_SITE_A" : "GEO_FOUNDRY_SITE_B"
  const packageRoot = resolve(
    root,
    input.site === "a" ? "examples/site-a-next" : "examples/site-b-express",
  )
  const endpoint = `http://${input.endpointHost}:${input.endpointPort}`
  const child = spawn(process.execPath, ["server/server.mjs"], {
    cwd: packageRoot,
    detached: true,
    env: {
      [`${environmentPrefix}_S3_ACCESS_KEY_FILE`]: input.accessKeyPath,
      [`${environmentPrefix}_S3_BUCKET`]: bucket,
      [`${environmentPrefix}_S3_ENDPOINT`]: endpoint,
      [`${environmentPrefix}_S3_KEY_PREFIX`]: input.keyPrefix,
      [`${environmentPrefix}_S3_SECRET_KEY_FILE`]: input.secretKeyPath,
      [`${environmentPrefix}_S3_TIMEOUT_MS`]: "3000",
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      PATH: process.env.PATH ?? "",
      PORT: String(port),
    },
    stdio: ["ignore", "ignore", "ignore"],
  })
  try {
    await waitForHost(port)
    return { child, port }
  } catch (error) {
    await stopHost(child)
    throw error
  }
}

const responseStatus = async (input) => {
  const response = await requestHost({ host: input.host, path: input.path, port: input.port })
  if (response.status !== input.status) {
    throw new Error(`FAULT_HTTP_STATUS:${String(response.status)}:${String(input.status)}`)
  }
  if (input.releaseId !== undefined && response.headers["x-geo-release-id"] !== input.releaseId) {
    throw new Error("FAULT_RELEASE_HEADER_MISMATCH")
  }
  return response
}

const objectBytes = async (client, key) => {
  const output = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  if (output.Body === undefined) {
    throw new Error("FAULT_OBJECT_BODY_MISSING")
  }
  return new Uint8Array(await output.Body.transformToByteArray())
}

const restoreObject = async (client, key, body, contentType) => {
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Body: body, ContentType: contentType, Key: key }),
  )
}

const ownedObjectCount = async (client, keyPrefix) => {
  const listed = await client.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: `${keyPrefix}/` }),
  )
  for (const object of listed.Contents ?? []) {
    if (object.Key === undefined || !object.Key.startsWith(`${keyPrefix}/`)) {
      throw new Error("FAULT_FOREIGN_CLEANUP_KEY")
    }
  }
  return listed.KeyCount ?? 0
}

const routeObjectKey = async (client, state, site) => {
  const routesKey = ownedPhysicalKey(
    state.keyPrefix,
    `sites/${site.siteId}/releases/${site.releaseId}/routes.json`,
  )
  const routes = JSON.parse(new TextDecoder().decode(await objectBytes(client, routesKey)))
  const route = routes.routes.find((candidate) => candidate.pathname === site.pathname)
  if (route === undefined || typeof route.objectKey !== "string") {
    throw new Error("FAULT_ARTICLE_ROUTE_MISSING")
  }
  return ownedPhysicalKey(
    state.keyPrefix,
    `sites/${site.siteId}/releases/${site.releaseId}/${route.objectKey}`,
  )
}

const runArtifactRecovery = async (input) => {
  const key = await routeObjectKey(input.client, input.state, input.site)
  const original = await objectBytes(input.client, key)
  let host
  try {
    await input.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    host = await startHost({ ...input.hostConfig, site: input.hostConfig.site })
    const unavailable = await responseStatus({
      host: input.site.host,
      path: input.site.pathname,
      port: host.port,
      status: 503,
    })
    await stopHost(host.child)
    host = undefined
    await restoreObject(input.client, key, original, "application/json")
    host = await startHost({ ...input.hostConfig, site: input.hostConfig.site })
    const recovered = await responseStatus({
      host: input.site.host,
      path: input.site.pathname,
      port: host.port,
      releaseId: input.site.releaseId,
      status: 200,
    })
    return faultCase({
      assertions: [
        `missing owned artifact returned ${unavailable.status}`,
        `restored exact artifact returned ${recovered.status}`,
      ],
      fault: "artifact-missing",
      id: `serving-${input.hostConfig.site}-artifact-missing`,
      recovery: "restored the original bytes to the same attempt-owned object key",
      status: "recovered",
    })
  } finally {
    if (host !== undefined) {
      await stopHost(host.child)
    }
    await restoreObject(input.client, key, original, "application/json").catch(() => undefined)
  }
}

const runArtifactTamperRecovery = async (input) => {
  const key = await routeObjectKey(input.client, input.state, input.site)
  const original = await objectBytes(input.client, key)
  let host
  try {
    await restoreObject(
      input.client,
      key,
      new TextEncoder().encode('{"fault":"tampered"}'),
      "application/json",
    )
    host = await startHost(input.hostConfig)
    const unavailable = await responseStatus({
      host: input.site.host,
      path: input.site.pathname,
      port: host.port,
      status: 503,
    })
    await stopHost(host.child)
    host = undefined
    await restoreObject(input.client, key, original, "application/json")
    host = await startHost(input.hostConfig)
    const recovered = await responseStatus({
      host: input.site.host,
      path: input.site.pathname,
      port: host.port,
      releaseId: input.site.releaseId,
      status: 200,
    })
    return faultCase({
      assertions: [
        `tampered owned artifact returned ${unavailable.status}`,
        `restored exact artifact returned ${recovered.status}`,
      ],
      fault: "artifact-tamper",
      id: `serving-${input.hostConfig.site}-artifact-tamper`,
      recovery: "restored the original hash-verified bytes to the same attempt-owned object key",
      status: "recovered",
    })
  } finally {
    if (host !== undefined) {
      await stopHost(host.child)
    }
    await restoreObject(input.client, key, original, "application/json").catch(() => undefined)
  }
}

const runManifestRecovery = async (input) => {
  const key = ownedPhysicalKey(
    input.state.keyPrefix,
    `sites/${input.site.siteId}/releases/${input.site.releaseId}/manifest.json`,
  )
  const original = await objectBytes(input.client, key)
  let host
  try {
    await input.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    host = await startHost(input.hostConfig)
    const unavailable = await responseStatus({
      host: input.site.host,
      path: input.site.pathname,
      port: host.port,
      status: 503,
    })
    await stopHost(host.child)
    host = undefined
    await restoreObject(input.client, key, original, "application/json")
    host = await startHost(input.hostConfig)
    const recovered = await responseStatus({
      host: input.site.host,
      path: input.site.pathname,
      port: host.port,
      releaseId: input.site.releaseId,
      status: 200,
    })
    return faultCase({
      assertions: [
        `missing owned manifest returned ${unavailable.status}`,
        `restored exact manifest returned ${recovered.status}`,
      ],
      fault: "manifest-missing",
      id: `serving-${input.hostConfig.site}-manifest-missing`,
      recovery: "restored the original bytes to the same attempt-owned manifest key",
      status: "recovered",
    })
  } finally {
    if (host !== undefined) {
      await stopHost(host.child)
    }
    await restoreObject(input.client, key, original, "application/json").catch(() => undefined)
  }
}

const runWorkerRedisRecovery = async (input) => {
  const child = spawn(
    "pnpm",
    [
      "--filter",
      "@geo/worker",
      "exec",
      "vitest",
      "run",
      "--configLoader",
      "runner",
      "test/integration/worker-flows.test.ts",
      "--no-file-parallelism",
    ],
    {
      cwd: root,
      env: {
        GEO_FOUNDRY_FAULT_REDIS_PREFIX: `geo-foundry:${input.runId}`,
        GEO_FOUNDRY_REDIS_DATABASE: process.env.GEO_FOUNDRY_REDIS_DATABASE ?? "0",
        GEO_FOUNDRY_REDIS_HOST: input.redis.host,
        GEO_FOUNDRY_REDIS_PASSWORD_FILE: input.passwordFile,
        GEO_FOUNDRY_REDIS_PORT: String(input.redis.port),
        NODE_ENV: "test",
        PATH: process.env.PATH ?? "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  const output = []
  child.stdout.on("data", (chunk) => output.push(chunk))
  child.stderr.on("data", (chunk) => output.push(chunk))
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit)
    child.once("exit", (code) => resolveExit(code ?? 1))
  })
  const log = Buffer.concat(output).toString("utf8")
  await writeFile(join(input.directory, "worker-redis-recovery.log"), log, { mode: 0o600 })
  if (exitCode !== 0) {
    throw new Error("FAULT_WORKER_REDIS_RECOVERY_FAILED")
  }
  return faultCase({
    assertions: [
      "simulated ECONNREFUSED retained a recoverable operation",
      "two reconciler calls produced one deterministic worker side effect",
      "a force-closed test worker released its locked job to one recovery worker",
      "the owned Redis prefix was empty after teardown",
    ],
    fault: "redis-enqueue-outage-and-concurrent-reconciliation",
    id: "worker-redis-recovery",
    recovery: "restored the test queue adapter and re-enqueued its stable operation job ID",
    status: "recovered",
  })
}

const runStorageDenialRecovery = async (input) => {
  let denied
  let recovered
  try {
    denied = await startHost({ ...input.hostConfig, endpointPort: 1 })
    const unavailable = await responseStatus({
      host: input.site.host,
      path: input.site.pathname,
      port: denied.port,
      status: 503,
    })
    if (input.hostConfig.site === "b" && unavailable.headers["cache-control"] !== "no-store") {
      throw new Error("FAULT_SITE_B_UNAVAILABLE_CACHE_POLICY")
    }
    await stopHost(denied.child)
    denied = undefined
    recovered = await startHost(input.hostConfig)
    const response = await responseStatus({
      host: input.site.host,
      path: input.site.pathname,
      port: recovered.port,
      releaseId: input.site.releaseId,
      status: 200,
    })
    return faultCase({
      assertions: [
        `denied RustFS endpoint returned ${unavailable.status}`,
        `recovery returned ${response.status}`,
      ],
      fault: "rustfs-access-denied",
      id: `serving-${input.hostConfig.site}-rustfs-denial`,
      recovery: "restarted only the test host with its permitted loopback RustFS endpoint",
      status: "recovered",
    })
  } finally {
    if (denied !== undefined) {
      await stopHost(denied.child)
    }
    if (recovered !== undefined) {
      await stopHost(recovered.child)
    }
  }
}

const concurrentPlanOf = async (input) => {
  const compileOutput = await compileSite({
    clock: { now: "2026-08-21T00:03:00.000Z" },
    compilerVersion: "1.0.0",
    editions: [
      {
        assessmentInputHash: "f".repeat(64),
        assessmentState: "passed",
        author: {
          id: "author-site-a-e2e",
          name: "Site A Editorial Team",
          url: "https://site-a.test/authors/editorial-team",
        },
        body: [{ blockType: "paragraph", text: input.body }],
        categories: ["engineering"],
        contentId: input.contentId,
        editionId: input.contentId,
        media: [],
        modifiedAt: "2026-08-21T00:03:00.000Z",
        publishedAt: "2026-08-21T00:00:00Z",
        siteId: "site-a-e2e",
        status: "approved",
        summary: input.summary,
        tags: ["release-engineering"],
        title: input.title,
        urlPathname: "/articles/site-a-release-v2",
        urlStatus: "active",
      },
    ],
    gonePathnames: ["/retired-site-a"],
    listings: {
      articles: { pathname: "/articles", pageSize: 10 },
      categories: [
        {
          id: "cat-engineering",
          pathname: "/engineering",
          slug: "engineering",
          title: "Engineering",
        },
      ],
      tags: [
        {
          id: "tag-release-engineering",
          pathname: "/tags/release-engineering",
          slug: "release-engineering",
          title: "release-engineering",
        },
      ],
    },
    notFound: { pathname: "/not-found" },
    redirects: [
      { fromPathname: "/articles/site-a-release", targetUrl: "/articles/site-a-release-v2" },
    ],
    site: {
      canonicalDomain: "site-a.test",
      locale: "en-US",
      name: "Site A Engineering",
      organization: { name: "Site A Engineering" },
      seoDefaults: {
        description: "Site A technical release coverage.",
        title: "Site A Engineering",
      },
      siteId: "site-a-e2e",
      timezone: "UTC",
    },
  })
  const routingManifest = {
    hosts: [
      { canonical: true, host: "site-a.test", siteId: "site-a-e2e" },
      { canonical: false, host: "www.site-a.test", siteId: "site-a-e2e" },
      { canonical: true, host: "site-b.test", siteId: "site-b-e2e" },
      { canonical: false, host: "www.site-b.test", siteId: "site-b-e2e" },
    ],
    schemaVersion: 1,
  }
  const plan = planRelease({
    compileOutput,
    createdAt: "2026-08-21T00:03:00.000Z",
    releaseId: input.releaseId,
    routingManifest,
    siteId: "site-a-e2e",
    sourceVersionIds: [`fault-${input.releaseId}`],
  })
  return { plan, verifiedManifest: await verifyManifest(plan.manifest) }
}

const runConcurrentPublishCas = async (input) => {
  const store = createS3ArtifactStore({
    bucket,
    client: input.client,
    clientConfig: {},
    keyPrefix: input.state.keyPrefix,
  })
  const alpha = await concurrentPlanOf({
    body: "Concurrent release alpha is fully server rendered.",
    contentId: 3101,
    releaseId: `${input.runId}-publish-alpha`,
    summary: "A concurrent Site A release alpha.",
    title: "Site A Concurrent Release Alpha",
  })
  const beta = await concurrentPlanOf({
    body: "Concurrent release beta is fully server rendered.",
    contentId: 3102,
    releaseId: `${input.runId}-publish-beta`,
    summary: "A concurrent Site A release beta.",
    title: "Site A Concurrent Release Beta",
  })
  const actor = { actorId: "geo-foundry-fault", kind: "service" }
  const results = await Promise.allSettled([
    publishRelease({ actor, planned: alpha.plan, store, verifiedManifest: alpha.verifiedManifest }),
    publishRelease({ actor, planned: beta.plan, store, verifiedManifest: beta.verifiedManifest }),
  ])
  const fulfilled = results.filter((result) => result.status === "fulfilled")
  const rejected = results.filter((result) => result.status === "rejected")
  if (
    fulfilled.length !== 1 ||
    rejected.length !== 1 ||
    !(rejected[0]?.reason instanceof StalePointerEtagError)
  ) {
    throw new Error("FAULT_PUBLISH_CAS_OUTCOME_INVALID")
  }
  const winner = fulfilled[0]
  if (winner === undefined || winner.status !== "fulfilled") {
    throw new Error("FAULT_PUBLISH_CAS_WINNER_MISSING")
  }
  let host
  try {
    host = await startHost(input.hostConfig)
    await responseStatus({
      host: input.state.siteA.host,
      path: input.state.siteA.pathname,
      port: host.port,
      releaseId: winner.value.receipt.releaseId,
      status: 200,
    })
  } finally {
    if (host !== undefined) {
      await stopHost(host.child)
    }
  }
  return faultCase({
    assertions: [
      "two concurrent publishes produced one compare-and-swap winner",
      "the loser raised ARTIFACT_STORE_POINTER_ETAG_STALE",
      "the formal Site A host served only the winner release ID",
    ],
    fault: "concurrent-publish-cas",
    id: "publisher-concurrent-cas",
    recovery:
      "kept the CAS winner pointer and deferred all immutable object cleanup to the attempt teardown",
    status: "recovered",
  })
}

const run = async () => {
  if (process.env.GEO_FOUNDRY_FAULTS_ENABLED !== "true") {
    throw new Error("FAULTS_OPT_IN_REQUIRED")
  }
  const runId = assertFaultRunId(createFaultRunId())
  const evidenceRoot = await faultEvidenceDirectoryOf(root)
  const attemptDirectory = join(evidenceRoot, `attempt-${runId}`)
  await mkdir(attemptDirectory, { mode: 0o700, recursive: true })
  const accessKey = await secureFile("GEO_FOUNDRY_S3_ACCESS_KEY_FILE")
  const secretKey = await secureFile("GEO_FOUNDRY_S3_SECRET_KEY_FILE")
  const redisPassword = await secureFile("GEO_FOUNDRY_REDIS_PASSWORD_FILE")
  const endpointPort = assertLoopbackEndpoint()
  const redis = assertLoopbackRedisEndpoint()
  const keyPrefix = `objects/todo39/${runId}`
  const stateDirectory = join(attemptDirectory, "serving")
  const priorE2eEnabled = process.env.GEO_FOUNDRY_E2E_ENABLED
  const priorEvidenceDirectory = process.env.GEO_FOUNDRY_EVIDENCE_DIR
  let teardown
  const client = new S3Client({
    credentials: { accessKeyId: accessKey.value, secretAccessKey: secretKey.value },
    endpoint: `http://127.0.0.1:${endpointPort}`,
    forcePathStyle: true,
    region: "us-east-1",
  })
  try {
    process.env.GEO_FOUNDRY_E2E_ENABLED = "true"
    process.env.GEO_FOUNDRY_EVIDENCE_DIR = stateDirectory
    teardown = await setupTwoSiteE2e({ keyPrefix, runId })
    const state = JSON.parse(await readFile(join(stateDirectory, "e2e-state.json"), "utf8"))
    if (state.keyPrefix !== keyPrefix) {
      throw new Error("FAULT_FOREIGN_E2E_PREFIX")
    }
    const siteAConfig = {
      accessKeyPath: accessKey.path,
      endpointHost: "127.0.0.1",
      endpointPort,
      keyPrefix,
      secretKeyPath: secretKey.path,
      site: "a",
    }
    const siteBConfig = { ...siteAConfig, site: "b" }
    const cases = [
      await runArtifactRecovery({ client, hostConfig: siteAConfig, site: state.siteA, state }),
      await runArtifactTamperRecovery({
        client,
        hostConfig: siteAConfig,
        site: state.siteA,
        state,
      }),
      await runManifestRecovery({ client, hostConfig: siteBConfig, site: state.siteB, state }),
      await runStorageDenialRecovery({ hostConfig: siteAConfig, site: state.siteA }),
      await runStorageDenialRecovery({ hostConfig: siteBConfig, site: state.siteB }),
      await runConcurrentPublishCas({
        client,
        hostConfig: siteAConfig,
        runId,
        state,
      }),
    ]
    await teardown()
    teardown = undefined
    const cleanup = { ownedObjectCount: await ownedObjectCount(client, keyPrefix) }
    if (cleanup.ownedObjectCount !== 0) {
      throw new Error("FAULT_S3_CLEANUP_INCOMPLETE")
    }
    const unlockWorker = await acquireProjectLock(runId)
    try {
      cases.push(
        await runWorkerRedisRecovery({
          directory: attemptDirectory,
          passwordFile: redisPassword.path,
          redis,
          runId,
        }),
      )
    } finally {
      await unlockWorker()
    }
    cases.push(
      await runControlPlaneFaultRecovery({
        directory: attemptDirectory,
        runId,
        s3Port: endpointPort,
      }),
    )
    const matrix = {
      cases,
      cleanup,
      namespaces: {
        redisPrefix: `geo-foundry:${runId}:`,
        s3Prefix: keyPrefix,
      },
      runId,
      servingControlPlane: {
        cms: "not-started",
        postgres: "not-connected-by-serving-hosts",
        redis: "not-connected-by-serving-hosts",
        worker: "not-started",
      },
      sharedInfrastructure:
        "PostgreSQL, Redis, RustFS, and mk-dev containers were not stopped or reconfigured.",
    }
    await writeFaultEvidence(attemptDirectory, "matrix.json", matrix)
    await writeFaultEvidence(attemptDirectory, "evidence-index.json", {
      matrix: "matrix.json",
      serving: "serving/",
      workerRedisRecovery: "worker-redis-recovery.log",
    })
    return matrix
  } finally {
    try {
      if (teardown !== undefined) {
        await teardown()
      }
    } finally {
      client.destroy()
      if (priorE2eEnabled === undefined) {
        delete process.env.GEO_FOUNDRY_E2E_ENABLED
      } else {
        process.env.GEO_FOUNDRY_E2E_ENABLED = priorE2eEnabled
      }
      if (priorEvidenceDirectory === undefined) {
        delete process.env.GEO_FOUNDRY_EVIDENCE_DIR
      } else {
        process.env.GEO_FOUNDRY_EVIDENCE_DIR = priorEvidenceDirectory
      }
    }
  }
}

const result = await run()
console.log(
  JSON.stringify({
    cleanup: result.cleanup,
    faultCases: result.cases.length,
    runId: result.runId,
    status: "FAULT_MATRIX_COMPLETED",
  }),
)
