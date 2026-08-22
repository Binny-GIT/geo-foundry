import { spawn } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { appendFile, chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3"
import { createClient } from "redis"

import { acquireProjectLock } from "../../scripts/shared-services/lock.mjs"
import { assertFaultRunId, secureFile, writeFaultEvidence } from "./support.mjs"

const root = resolve(import.meta.dirname, "../..")
const cmsRoot = join(root, "apps/cms")
const bucket = "geo-foundry"
const timeoutMs = 90_000
const pointerTimeoutMs = 30_000

const fail = (code) => {
  throw new Error(code)
}

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))

const reservePort = async () =>
  new Promise((resolvePort, rejectPort) => {
    const server = createServer()
    server.once("error", rejectPort)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      server.close((error) => {
        if (error !== undefined || typeof address !== "object" || address === null) {
          rejectPort(error ?? new Error("FAULT_CONTROL_PORT_RESERVATION_FAILED"))
          return
        }
        resolvePort(address.port)
      })
    })
  })

const waitFor = async (probe, code, waitTimeoutMs = timeoutMs) => {
  const deadline = Date.now() + waitTimeoutMs
  while (Date.now() < deadline) {
    try {
      if (await probe()) {
        return
      }
    } catch {}
    await delay(250)
  }
  fail(code)
}

const waitForHttp = async (url, code) =>
  waitFor(async () => (await fetch(url)).status === 200, code)

const appendLog = (path, value) => appendFile(path, value).catch(() => {})

const startChild = async (input) => {
  const path = join(input.directory, `${input.name}.log`)
  const child = spawn(input.command, input.argumentsList, {
    cwd: input.cwd,
    detached: true,
    env: input.environment,
    stdio: ["ignore", "pipe", "pipe"],
  })
  child.stdout.on("data", (chunk) => void appendLog(path, chunk))
  child.stderr.on("data", (chunk) => void appendLog(path, chunk))
  child.once(
    "error",
    (error) =>
      void appendLog(
        path,
        `${JSON.stringify({ code: "FAULT_CONTROL_CHILD_ERROR", name: input.name, message: error.message })}\n`,
      ),
  )
  return { child, name: input.name }
}

const stopChild = async (started, force = false) => {
  if (started === undefined || started.child.exitCode !== null || started.child.pid === undefined) {
    return
  }
  try {
    process.kill(-started.child.pid, force ? "SIGKILL" : "SIGTERM")
  } catch {
    return
  }
  await Promise.race([
    new Promise((resolveExit) => started.child.once("exit", resolveExit)),
    delay(10_000),
  ])
  if (started.child.exitCode === null) {
    try {
      process.kill(-started.child.pid, "SIGKILL")
    } catch {}
  }
}

const runCommand = async (input) => {
  const path = join(input.directory, `${input.name}.log`)
  const child = spawn(input.command, input.argumentsList, {
    cwd: input.cwd,
    env: input.environment,
    stdio: ["ignore", "pipe", "pipe"],
  })
  const output = []
  child.stdout.on("data", (chunk) => {
    output.push(chunk)
    void appendLog(path, chunk)
  })
  child.stderr.on("data", (chunk) => void appendLog(path, chunk))
  const status = await new Promise((resolveStatus, rejectStatus) => {
    child.once("error", rejectStatus)
    child.once("exit", (code) => resolveStatus(code ?? 1))
  })
  if (status !== 0) {
    fail(`FAULT_CONTROL_COMMAND_FAILED:${input.name}`)
  }
  return Buffer.concat(output).toString("utf8")
}

const writeEphemeralSecret = async (directory, name) => {
  const path = join(directory, name)
  await writeFile(path, randomBytes(32).toString("base64url"), { mode: 0o600 })
  await chmod(path, 0o600)
  return path
}

const json = async (response, label, expected = [200]) => {
  const text = await response.text()
  let body
  try {
    body = text.length === 0 ? {} : JSON.parse(text)
  } catch {
    fail(`FAULT_CONTROL_RESPONSE_JSON_INVALID:${label}`)
  }
  if (!expected.includes(response.status)) {
    const code = typeof body?.error?.code === "string" ? body.error.code : `HTTP_${response.status}`
    fail(`FAULT_CONTROL_HTTP_FAILED:${label}:${code}`)
  }
  return body
}

const cmsRequest = async (cmsUrl, token, path, method = "GET", body, requestId) =>
  json(
    await fetch(`${cmsUrl}/api${path}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(requestId === undefined ? {} : { "x-request-id": requestId }),
      },
      method,
    }),
    `cms:${method}:${path}`,
  )

const cmsRawRequest = (cmsUrl, token, path, requestId) =>
  fetch(`${cmsUrl}/api${path}`, {
    headers: { authorization: `Bearer ${token}`, "x-request-id": requestId },
  })

const login = async (cmsUrl, email, password) => {
  const body = await json(
    await fetch(`${cmsUrl}/api/users/login`, {
      body: JSON.stringify({ email, password }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
    "cms-login",
  )
  if (typeof body.token !== "string" || body.token.length === 0) {
    fail("FAULT_CONTROL_LOGIN_TOKEN_MISSING")
  }
  return body.token
}

const serviceRequest = async (serviceUrl, operatorKey, path, body, idempotencyKey) =>
  json(
    await fetch(`${serviceUrl}${path}`, {
      body: JSON.stringify(body),
      headers: {
        authorization: `Bearer ${operatorKey}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      method: "POST",
    }),
    `content-service:${path}`,
    [200, 202],
  )

const deleteOwnedRedisKeys = async (input) => {
  const client = createClient({
    database: Number(input.environment.GEO_FOUNDRY_REDIS_DATABASE ?? "0"),
    password: input.password,
    socket: {
      host: input.environment.GEO_FOUNDRY_REDIS_HOST ?? "127.0.0.1",
      port: Number(input.environment.GEO_FOUNDRY_REDIS_PORT ?? "6379"),
    },
  })
  await client.connect()
  try {
    const keys = []
    for await (const batch of client.scanIterator({
      MATCH: `${input.queuePrefix}:*`,
      COUNT: 100,
    })) {
      keys.push(...batch)
    }
    if (keys.some((key) => !key.startsWith(`${input.queuePrefix}:`))) {
      fail("FAULT_CONTROL_REDIS_FOREIGN_KEY")
    }
    if (keys.length > 0) {
      await client.del(keys)
    }
    const remaining = []
    for await (const batch of client.scanIterator({
      MATCH: `${input.queuePrefix}:*`,
      COUNT: 100,
    })) {
      remaining.push(...batch)
    }
    if (remaining.length !== 0) {
      fail("FAULT_CONTROL_REDIS_CLEANUP_INCOMPLETE")
    }
    return { ownedKeyCount: keys.length, remainingKeyCount: remaining.length }
  } finally {
    await client.quit()
  }
}

const listOwnedS3Keys = async (client, keyPrefix) => {
  const prefix = `${keyPrefix}/`
  const keys = []
  let token
  do {
    const listed = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token, Prefix: prefix }),
    )
    for (const object of listed.Contents ?? []) {
      if (object.Key === undefined || !object.Key.startsWith(prefix)) {
        fail("FAULT_CONTROL_S3_FOREIGN_KEY")
      }
      keys.push(object.Key)
    }
    token = listed.IsTruncated ? listed.NextContinuationToken : undefined
  } while (token !== undefined)
  return keys
}

const deleteOwnedS3Objects = async (client, keyPrefix) => {
  const keys = await listOwnedS3Keys(client, keyPrefix)
  for (const key of keys) {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
  }
  const remaining = await listOwnedS3Keys(client, keyPrefix)
  if (remaining.length !== 0) {
    fail("FAULT_CONTROL_S3_CLEANUP_INCOMPLETE")
  }
  return { ownedObjectCount: keys.length, remainingObjectCount: remaining.length }
}

const createRelay = async (input) => {
  const blocked = new Set()
  const events = []
  const targetPattern = /^\/api\/internal\/sites\/([1-9][0-9]*)\/releases\/published$/
  const server = createServer((request, response) => {
    const chunks = []
    request.on("data", (chunk) => chunks.push(chunk))
    request.on("end", () => {
      void (async () => {
        const pathname = new URL(request.url ?? "/", "http://relay.local").pathname
        const match = targetPattern.exec(pathname)
        const body = Buffer.concat(chunks)
        if ((request.method ?? "GET").toUpperCase() === "POST" && match !== null) {
          let parsed
          try {
            parsed = JSON.parse(body.toString("utf8"))
          } catch {
            response.destroy()
            return
          }
          if (typeof parsed?.operationId !== "string" || typeof parsed?.receipt !== "object") {
            response.destroy()
            return
          }
          events.push({
            bodyBytes: body.byteLength,
            bodySha256: createHash("sha256").update(body).digest("hex"),
            operationId: parsed.operationId,
            path: pathname,
            siteId: Number(match[1]),
          })
          blocked.add(response)
          response.once("close", () => blocked.delete(response))
          return
        }
        const upstream = await fetch(`${input.cmsUrl}${request.url ?? "/"}`, {
          body: body.byteLength === 0 ? undefined : body,
          headers: request.headers,
          method: request.method,
        })
        response.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()))
        response.end(Buffer.from(await upstream.arrayBuffer()))
      })().catch(() => response.destroy())
    })
  })
  const port = await reservePort()
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen)
    server.listen(port, "127.0.0.1", resolveListen)
  })
  return {
    close: async () => {
      for (const response of blocked) {
        response.destroy()
      }
      await new Promise((resolveClose, rejectClose) =>
        server.close((error) => (error === undefined ? resolveClose() : rejectClose(error))),
      )
    },
    events,
    url: `http://127.0.0.1:${port}`,
  }
}

const parseSeed = (output) => {
  const line = output
    .trim()
    .split("\n")
    .findLast((candidate) => candidate.startsWith("{"))
  if (line === undefined) {
    fail("FAULT_CONTROL_SEED_OUTPUT_MISSING")
  }
  const parsed = JSON.parse(line)
  if (
    !Number.isInteger(parsed.editionId) ||
    !Number.isInteger(parsed.siteId) ||
    typeof parsed.emails?.editor !== "string" ||
    typeof parsed.emails?.publisher !== "string" ||
    typeof parsed.emails?.reviewer !== "string" ||
    typeof parsed.emails?.service !== "string" ||
    typeof parsed.emails?.foreignService !== "string"
  ) {
    fail("FAULT_CONTROL_SEED_OUTPUT_INVALID")
  }
  return parsed
}

const transition = async (cmsUrl, token, editionId, target) =>
  cmsRequest(cmsUrl, token, `/editions/${editionId}/workflow-transitions`, "POST", { target })

export const runControlPlaneFaultRecovery = async (input) => {
  const runId = assertFaultRunId(input.runId)
  const queuePrefix = `geo-foundry:${runId}`
  const keyPrefix = `objects/todo39/${runId}`
  const directory = join(input.directory, "control-plane")
  await mkdir(directory, { mode: 0o700, recursive: true })

  const [accessKey, secretKey, redisPassword, pgUser, pgPassword, cmsSecret] = await Promise.all([
    secureFile("GEO_FOUNDRY_S3_ACCESS_KEY_FILE"),
    secureFile("GEO_FOUNDRY_S3_SECRET_KEY_FILE"),
    secureFile("GEO_FOUNDRY_REDIS_PASSWORD_FILE"),
    secureFile("GEO_FOUNDRY_PG_USER_FILE"),
    secureFile("GEO_FOUNDRY_PG_PASSWORD_FILE"),
    secureFile("GEO_FOUNDRY_CMS_SECRET_FILE"),
  ])
  const temporaryDirectory = await mkdtemp(join(tmpdir(), `geo-foundry-fault-${runId}-`))
  await chmod(temporaryDirectory, 0o700)
  const passwordPath = await writeEphemeralSecret(temporaryDirectory, "cms-password")
  const operatorKeyPath = await writeEphemeralSecret(temporaryDirectory, "operator-key")
  const cmsServiceTokenPath = join(temporaryDirectory, "cms-service-token")
  const operatorKey = (await readFile(operatorKeyPath, "utf8")).trim()
  const endpoint = `http://127.0.0.1:${input.s3Port}`
  const environment = {
    ...process.env,
    CMS_INTERNAL_MAX_BODY_BYTES: "1048576",
    GEO_FOUNDRY_CMS_CONFIG_MODE: "fault-test",
    GEO_FOUNDRY_CMS_SECRET_FILE: cmsSecret.path,
    GEO_FOUNDRY_FAULT_PASSWORD_FILE: passwordPath,
    GEO_FOUNDRY_FAULT_RUN_ID: runId,
    GEO_FOUNDRY_PG_BOOTSTRAP_DATABASE: process.env.GEO_FOUNDRY_PG_BOOTSTRAP_DATABASE ?? "postgres",
    GEO_FOUNDRY_PG_DATABASE: "geo_foundry",
    GEO_FOUNDRY_PG_HOST: process.env.GEO_FOUNDRY_PG_HOST ?? "127.0.0.1",
    GEO_FOUNDRY_PG_PASSWORD_FILE: pgPassword.path,
    GEO_FOUNDRY_PG_PORT: process.env.GEO_FOUNDRY_PG_PORT ?? "5432",
    GEO_FOUNDRY_PG_SCHEMA: "geo_foundry",
    GEO_FOUNDRY_PG_USER_FILE: pgUser.path,
    GEO_FOUNDRY_REDIS_DATABASE: process.env.GEO_FOUNDRY_REDIS_DATABASE ?? "0",
    GEO_FOUNDRY_REDIS_HOST: process.env.GEO_FOUNDRY_REDIS_HOST ?? "127.0.0.1",
    GEO_FOUNDRY_REDIS_PASSWORD_FILE: redisPassword.path,
    GEO_FOUNDRY_REDIS_PORT: process.env.GEO_FOUNDRY_REDIS_PORT ?? "6379",
    GEO_FOUNDRY_S3_ACCESS_KEY_FILE: accessKey.path,
    GEO_FOUNDRY_S3_BUCKET: bucket,
    GEO_FOUNDRY_S3_ENDPOINT: "127.0.0.1",
    GEO_FOUNDRY_S3_FORCE_PATH_STYLE: "true",
    GEO_FOUNDRY_S3_KEY_PREFIX: keyPrefix,
    GEO_FOUNDRY_S3_PORT: String(input.s3Port),
    GEO_FOUNDRY_S3_SECRET_KEY_FILE: secretKey.path,
    GEO_FOUNDRY_S3_USE_SSL: "false",
    GEO_FOUNDRY_WORKER_QUEUE_PREFIX: queuePrefix,
  }
  const client = new S3Client({
    credentials: { accessKeyId: accessKey.value, secretAccessKey: secretKey.value },
    endpoint,
    forcePathStyle: true,
    region: "us-east-1",
  })
  const unlock = await acquireProjectLock(runId)
  let cms
  let contentService
  let worker
  let relay
  let blockedEvent
  let databaseCreated = false
  const cleanup = { redis: null, s3: null }
  try {
    await runCommand({
      argumentsList: ["scripts/secure-run.mjs", "node", "scripts/fault-database.mjs", "create"],
      command: process.execPath,
      cwd: cmsRoot,
      directory,
      environment,
      name: "database-create",
    })
    databaseCreated = true
    await runCommand({
      argumentsList: ["--filter", "@geo/cms", "db:migrate"],
      command: "pnpm",
      cwd: root,
      directory,
      environment,
      name: "database-migrate",
    })
    const seed = parseSeed(
      await runCommand({
        argumentsList: [
          "scripts/secure-run.mjs",
          "node",
          "--import",
          "tsx",
          "scripts/fault-seed.mjs",
        ],
        command: process.execPath,
        cwd: cmsRoot,
        directory,
        environment,
        name: "database-seed",
      }),
    )
    const cmsPort = await reservePort()
    const cmsUrl = `http://127.0.0.1:${cmsPort}`
    cms = await startChild({
      argumentsList: [
        "--filter",
        "@geo/cms",
        "exec",
        "node",
        "scripts/secure-run.mjs",
        "next",
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(cmsPort),
      ],
      command: "pnpm",
      cwd: root,
      directory,
      environment: { ...environment, HOSTNAME: "127.0.0.1", PORT: String(cmsPort) },
      name: "cms",
    })
    await waitForHttp(`${cmsUrl}/api/readiness`, "FAULT_CONTROL_CMS_READY_TIMEOUT")

    const password = (await readFile(passwordPath, "utf8")).trim()
    const [editorToken, publisherToken, reviewerToken, serviceToken, foreignServiceToken] =
      await Promise.all([
        login(cmsUrl, seed.emails.editor, password),
        login(cmsUrl, seed.emails.publisher, password),
        login(cmsUrl, seed.emails.reviewer, password),
        login(cmsUrl, seed.emails.service, password),
        login(cmsUrl, seed.emails.foreignService, password),
      ])
    await writeFile(cmsServiceTokenPath, serviceToken, { mode: 0o600 })
    await chmod(cmsServiceTokenPath, 0o600)

    const noLeakRequestId = "fault-no-leak-0001"
    const foreignEdition = await cmsRawRequest(
      cmsUrl,
      foreignServiceToken,
      `/internal/editions/${seed.editionId}/input`,
      noLeakRequestId,
    )
    const unknownEdition = await cmsRawRequest(
      cmsUrl,
      serviceToken,
      "/internal/editions/999999/input",
      noLeakRequestId,
    )
    if (
      foreignEdition.status !== 404 ||
      (await foreignEdition.text()) !== (await unknownEdition.text())
    ) {
      fail("FAULT_CONTROL_NO_EXISTENCE_LEAK")
    }

    await transition(cmsUrl, editorToken, seed.editionId, "generating")
    await transition(cmsUrl, editorToken, seed.editionId, "review")
    const editionInput = await cmsRequest(
      cmsUrl,
      serviceToken,
      `/internal/editions/${seed.editionId}/input`,
      "GET",
      undefined,
      "fault-edition-input-0001",
    )
    await cmsRequest(
      cmsUrl,
      serviceToken,
      `/internal/editions/${seed.editionId}/assessments`,
      "POST",
      {
        inputHash: editionInput.inputHash,
        issues: [],
        modelId: "fault-supervisor",
        promptVersion: "fault-v1",
        provider: "fault-supervisor",
        state: "passed",
        thresholdsHash: "f".repeat(64),
      },
      "fault-assessment-0001",
    )
    await transition(cmsUrl, reviewerToken, seed.editionId, "approved")

    const contentServicePort = await reservePort()
    const serviceUrl = `http://127.0.0.1:${contentServicePort}`
    contentService = await startChild({
      argumentsList: ["--filter", "@geo/content-service", "start"],
      command: "pnpm",
      cwd: root,
      directory,
      environment: {
        ...environment,
        CMS_BASE_URL: cmsUrl,
        CONTENT_SERVICE_API_KEY_FILE: cmsServiceTokenPath,
        CONTENT_SERVICE_HOST: "127.0.0.1",
        CONTENT_SERVICE_OPERATOR_API_KEY_FILE: operatorKeyPath,
        CONTENT_SERVICE_PORT: String(contentServicePort),
      },
      name: "content-service",
    })
    await waitForHttp(`${serviceUrl}/healthz`, "FAULT_CONTROL_CONTENT_SERVICE_READY_TIMEOUT")
    const idempotencyKey = `fault-publish-${runId.slice("todo39-".length)}`
    const firstSubmit = await serviceRequest(
      serviceUrl,
      operatorKey,
      "/v1/publish",
      { editionId: seed.editionId, reason: "post-CAS registry crash recovery" },
      idempotencyKey,
    )
    const replaySubmit = await serviceRequest(
      serviceUrl,
      operatorKey,
      "/v1/publish",
      { editionId: seed.editionId, reason: "post-CAS registry crash recovery" },
      idempotencyKey,
    )
    const operationId = firstSubmit.operation?.operationId
    if (typeof operationId !== "string" || replaySubmit.operation?.operationId !== operationId) {
      fail("FAULT_CONTROL_IDEMPOTENCY_REPLAY_INVALID")
    }

    relay = await createRelay({ cmsUrl })
    worker = await startChild({
      argumentsList: ["--filter", "@geo/worker", "start"],
      command: "pnpm",
      cwd: root,
      directory,
      environment: {
        ...environment,
        CMS_BASE_URL: relay.url,
        CONTENT_SERVICE_API_KEY_FILE: cmsServiceTokenPath,
      },
      name: "worker-crash",
    })
    await waitFor(
      async () => relay.events.length === 1,
      "FAULT_CONTROL_REGISTRY_BLOCK_NOT_OBSERVED",
      pointerTimeoutMs,
    )
    blockedEvent = relay.events[0]
    if (blockedEvent?.operationId !== operationId) {
      fail("FAULT_CONTROL_REGISTRY_BLOCK_OPERATION_INVALID")
    }
    const pointerKey = `${keyPrefix}/sites/site-${seed.siteId}/channels/current.json`
    let pointerEtag
    await waitFor(
      async () => {
        try {
          const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: pointerKey }))
          pointerEtag = head.ETag ?? null
          return pointerEtag !== null
        } catch {
          return false
        }
      },
      "FAULT_CONTROL_POINTER_CAS_NOT_OBSERVED",
      pointerTimeoutMs,
    )
    await stopChild(worker, true)
    worker = undefined
    await relay.close()
    relay = undefined

    worker = await startChild({
      argumentsList: ["--filter", "@geo/worker", "start"],
      command: "pnpm",
      cwd: root,
      directory,
      environment: {
        ...environment,
        CMS_BASE_URL: cmsUrl,
        CONTENT_SERVICE_API_KEY_FILE: cmsServiceTokenPath,
      },
      name: "worker-recovery",
    })
    let completedOperation
    await waitFor(async () => {
      const response = await fetch(`${serviceUrl}/v1/operations/${operationId}`, {
        headers: { authorization: `Bearer ${operatorKey}` },
      })
      const body = await json(response, "content-service-operation")
      completedOperation = body.operation
      return completedOperation?.state === "succeeded"
    }, "FAULT_CONTROL_OPERATION_RECOVERY_TIMEOUT")
    const recoveredHead = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: pointerKey }),
    )
    if (recoveredHead.ETag !== pointerEtag) {
      fail("FAULT_CONTROL_POINTER_ETAG_CHURN")
    }
    const releases = await cmsRequest(
      cmsUrl,
      publisherToken,
      `/releases?where[operationId][equals]=${encodeURIComponent(operationId)}&depth=0&limit=10`,
    )
    if (!Array.isArray(releases.docs) || releases.docs.length !== 1) {
      fail("FAULT_CONTROL_RELEASE_REGISTRY_RECONCILIATION_INVALID")
    }
    if (blockedEvent === undefined) {
      fail("FAULT_CONTROL_RELAY_STATE_INVALID")
    }

    return {
      assertions: [
        "foreign and unknown editions returned identical opaque responses",
        "the release pointer was present before the worker process group was terminated",
        "the restarted worker reconciled one persisted publish operation",
        "the recovered pointer ETag matched the post-CAS ETag",
        "the CMS release registry contained exactly one run-owned operation record",
      ],
      cleanup,
      namespace: {
        database: `geo_foundry_fault_${runId.slice("todo39-".length)}`,
        keyPrefix,
        queuePrefix,
      },
      operationId,
      status: "recovered",
    }
  } finally {
    try {
      await stopChild(worker)
      await stopChild(contentService)
      await stopChild(cms)
      if (relay !== undefined) {
        await relay.close()
      }
      cleanup.redis = await deleteOwnedRedisKeys({
        environment,
        password: redisPassword.value,
        queuePrefix,
      })
      cleanup.s3 = await deleteOwnedS3Objects(client, keyPrefix)
    } finally {
      try {
        if (databaseCreated) {
          await runCommand({
            argumentsList: [
              "scripts/secure-run.mjs",
              "node",
              "scripts/fault-database.mjs",
              "cleanup",
            ],
            command: process.execPath,
            cwd: cmsRoot,
            directory,
            environment,
            name: "database-cleanup",
          })
        }
      } finally {
        await writeFaultEvidence(directory, "control-plane-summary.json", { cleanup, runId })
        client.destroy()
        await unlock()
        await rm(temporaryDirectory, { force: true, recursive: true })
      }
    }
  }
}
