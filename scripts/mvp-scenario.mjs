import { createHash } from "node:crypto"
import { spawn } from "node:child_process"
import { createServer } from "node:net"
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const scenario = JSON.parse(
  await readFile(resolve(root, "tests/fixtures/mvp/scenario.json"), "utf8"),
)
const terminalStates = new Set(["succeeded", "failed", "cancelled"])

const fail = (code) => {
  throw new Error(code)
}

const secureFile = async (variable, code) => {
  const file = process.env[variable]
  if (file === undefined || file.trim().length === 0) fail(`${code}_REQUIRED`)
  const metadata = await stat(file)
  if ((metadata.mode & 0o077) !== 0 || metadata.uid !== process.getuid()) {
    fail(`${code}_INSECURE`)
  }
  return file
}

const securePassword = async () => {
  const file = await secureFile("GEO_FOUNDRY_MVP_TEST_PASSWORD_FILE", "MVP_SCENARIO_PASSWORD_FILE")
  const value = (await readFile(file, "utf8")).trim()
  if (value.length < 12) fail("MVP_SCENARIO_PASSWORD_FILE_INVALID")
  return value
}

const reservePort = async () =>
  new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      server.close((error) => {
        if (error !== undefined) return reject(error)
        if (typeof address !== "object" || address === null)
          return reject(new Error("MVP_PORT_INVALID"))
        resolvePort(address.port)
      })
    })
  })

const run = async (command, args, options = {}) => {
  const child = spawn(command, args, {
    cwd: root,
    env: options.env ?? process.env,
    stdio: "inherit",
  })
  const status = await new Promise((resolveStatus, reject) => {
    child.once("error", reject)
    child.once("exit", (code) => resolveStatus(code ?? 1))
  })
  if (status !== 0) fail(`MVP_COMMAND_FAILED:${command}`)
}

const start = async (name, command, args, environment, recordDirectory) => {
  const logFile = resolve(recordDirectory, `${name}.log`)
  const child = spawn(command, args, {
    cwd: root,
    detached: true,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  })
  const log = async (chunk) => appendFile(logFile, chunk)
  child.stdout.on("data", (chunk) => void log(chunk))
  child.stderr.on("data", (chunk) => void log(chunk))
  child.once(
    "error",
    (error) =>
      void log(`${JSON.stringify({ code: "MVP_CHILD_ERROR", name, message: error.message })}\n`),
  )
  return { child, name }
}

const stop = async ({ child }) => {
  if (child.exitCode !== null || child.pid === undefined) return
  try {
    process.kill(-child.pid, "SIGTERM")
  } catch {
    return
  }
  const exited = await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveExit) => setTimeout(resolveExit, 10_000)),
  ])
  if (exited === undefined && child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL")
    } catch {}
  }
}

const waitFor = async (url, expected = 200) => {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.status === expected) return
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250))
  }
  fail(`MVP_READINESS_TIMEOUT:${url}`)
}

const json = async (response, label) => {
  const text = await response.text()
  let body
  try {
    body = text.length === 0 ? {} : JSON.parse(text)
  } catch {
    fail(`MVP_RESPONSE_JSON_INVALID:${label}`)
  }
  if (!response.ok) {
    const code = typeof body?.error?.code === "string" ? body.error.code : `HTTP_${response.status}`
    fail(`MVP_HTTP_FAILED:${label}:${code}`)
  }
  return body
}

const login = async (cmsUrl, email, password) => {
  const response = await fetch(`${cmsUrl}/api/users/login`, {
    body: JSON.stringify({ email, password }),
    headers: { "content-type": "application/json" },
    method: "POST",
  })
  const body = await json(response, "login")
  if (typeof body.token !== "string" || body.token.length === 0) fail("MVP_LOGIN_TOKEN_MISSING")
  return body.token
}

const cms = async (cmsUrl, token, path, method = "GET", body) => {
  const response = await fetch(`${cmsUrl}/api${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    method,
  })
  return json(response, `${method}:${path}`)
}

const service = async (serviceUrl, operatorKey, path, method = "GET", body, idempotencyKey) => {
  const response = await fetch(`${serviceUrl}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      authorization: `Bearer ${operatorKey}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(idempotencyKey === undefined ? {} : { "idempotency-key": idempotencyKey }),
    },
    method,
  })
  return json(response, `${method}:${path}`)
}

const poll = async (serviceUrl, operatorKey, operationId) => {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const body = await service(serviceUrl, operatorKey, `/v1/operations/${operationId}`)
    const operation = body.operation
    if (terminalStates.has(operation.state)) return operation
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 300))
  }
  fail(`MVP_OPERATION_TIMEOUT:${operationId}`)
}

const assertSucceeded = (operation, step) => {
  if (operation.state !== "succeeded") {
    const code = typeof operation.error?.code === "string" ? operation.error.code : operation.state
    fail(`MVP_OPERATION_NOT_SUCCEEDED:${step}:${code}`)
  }
}

const assertPassed = (operation, step) => {
  assertSucceeded(operation, step)
  if (operation.result?.decision !== "passed") {
    fail(`MVP_QUALITY_NOT_PASSED:${step}`)
  }
}

const operation = async (input) => {
  const first = await service(
    input.serviceUrl,
    input.operatorKey,
    input.path,
    "POST",
    input.body,
    input.key,
  )
  const replay = await service(
    input.serviceUrl,
    input.operatorKey,
    input.path,
    "POST",
    input.body,
    input.key,
  )
  if (first.operation.operationId !== replay.operation.operationId)
    fail(`MVP_IDEMPOTENCY_REPLAY_MISMATCH:${input.step}`)
  const result = await poll(input.serviceUrl, input.operatorKey, first.operation.operationId)
  input.record.steps.push({
    idempotencyReplay: true,
    operationId: result.operationId,
    state: result.state,
    step: input.step,
  })
  await writeFile(
    resolve(input.record.directory, "timeline.json"),
    `${JSON.stringify(input.record.steps, null, 2)}\n`,
  )
  return result
}

const list = async (cmsUrl, token, collection) => {
  const body = await cms(cmsUrl, token, `/${collection}?limit=100&depth=0`)
  return body.docs
}

const runScenario = async (recordDirectory) => {
  if (!recordDirectory.startsWith("/")) fail("MVP_RECORD_DIRECTORY_ABSOLUTE_REQUIRED")
  if (recordDirectory === root || recordDirectory.startsWith(resolve(root, ".omo")))
    fail("MVP_RECORD_DIRECTORY_FORBIDDEN")
  await mkdir(recordDirectory, { recursive: true, mode: 0o700 })
  const password = await securePassword()
  await secureFile("GEO_FOUNDRY_REDIS_PASSWORD_FILE", "MVP_SCENARIO_REDIS_PASSWORD_FILE")
  for (const workspace of [
    "@geo/schema",
    "@geo/domain",
    "@geo/quality-rules",
    "@geo/compiler",
    "@geo/publisher",
    "@geo/content-client",
    "@geo/content-pipeline",
    "@geo/cms",
    "@geo/content-service",
    "@geo/worker",
  ]) {
    await run("pnpm", ["--filter", workspace, "build"])
  }

  const cmsPort = await reservePort()
  const servicePort = await reservePort()
  const cmsUrl = `http://127.0.0.1:${cmsPort}`
  const serviceUrl = `http://127.0.0.1:${servicePort}`
  const objectPrefix = `objects/mvp/${createHash("sha256")
    .update(recordDirectory)
    .digest("hex")
    .slice(0, 20)}`
  const baseEnvironment = { ...process.env, GEO_FOUNDRY_CMS_CONFIG_MODE: "integration-test" }
  const started = []
  const record = { directory: recordDirectory, steps: [] }
  try {
    started.push(
      await start(
        "cms",
        "pnpm",
        ["--filter", "@geo/cms", "start"],
        { ...baseEnvironment, HOSTNAME: "127.0.0.1", PORT: String(cmsPort) },
        recordDirectory,
      ),
    )
    await waitFor(`${cmsUrl}/api/readiness`)

    const tokens = {}
    for (const user of scenario.users.roles)
      tokens[user.key] = await login(cmsUrl, user.email, password)
    const sites = await list(cmsUrl, tokens.editor, "sites")
    const editions = await list(cmsUrl, tokens.editor, "content-editions")
    const urls = await list(cmsUrl, tokens.editor, "url-records")
    const siteByName = new Map(sites.map((site) => [site.name, site]))
    const editionByAngle = new Map(editions.map((edition) => [edition.angle, edition]))
    const siteA = siteByName.get(scenario.sites[0].name)
    const siteB = siteByName.get(scenario.sites[1].name)
    const editionA = editionByAngle.get(scenario.editions[0].angle)
    const editionB = editionByAngle.get(scenario.editions[1].angle)
    if ([siteA, siteB, editionA, editionB].some((value) => value === undefined))
      fail("MVP_SEED_LOOKUP_FAILED")
    const urlA = urls.find(
      (url) =>
        url.pathname === scenario.editions[0].pathname && String(url.site) === String(siteA.id),
    )
    if (urlA === undefined) fail("MVP_SEED_URL_LOOKUP_FAILED")

    const operatorKey = crypto.randomUUID()
    started.push(
      await start(
        "content-service",
        "pnpm",
        ["--filter", "@geo/content-service", "start"],
        {
          ...baseEnvironment,
          CMS_BASE_URL: cmsUrl,
          CONTENT_SERVICE_API_KEY: tokens.contentService,
          CONTENT_SERVICE_HOST: "127.0.0.1",
          CONTENT_SERVICE_OPERATOR_API_KEY: operatorKey,
          CONTENT_SERVICE_PORT: String(servicePort),
        },
        recordDirectory,
      ),
    )
    await waitFor(`${serviceUrl}/healthz`)
    started.push(
      await start(
        "worker",
        "pnpm",
        ["--filter", "@geo/worker", "start"],
        {
          ...baseEnvironment,
          CMS_BASE_URL: cmsUrl,
          CONTENT_SERVICE_API_KEY: tokens.contentService,
          GEO_FOUNDRY_S3_KEY_PREFIX: objectPrefix,
        },
        recordDirectory,
      ),
    )

    const transition = (token, editionId, target, extra = {}) =>
      cms(cmsUrl, token, `/editions/${editionId}/workflow-transitions`, "POST", {
        target,
        ...extra,
      })
    await transition(tokens.editor, editionA.id, "generating")
    await transition(tokens.editor, editionB.id, "generating")
    const generateBody = {
      contentId: editionA.content,
      brief: {
        intent: scenario.content.intent,
        sources: scenario.content.researchBundle,
        topic: scenario.content.topic,
      },
      targets: [
        {
          editionId: editionA.id,
          angle: scenario.editions[0].angle,
          siteStrategy: { name: siteA.name, locale: siteA.locale, tone: scenario.sites[0].tone },
        },
        {
          editionId: editionB.id,
          angle: scenario.editions[1].angle,
          siteStrategy: { name: siteB.name, locale: siteB.locale, tone: scenario.sites[1].tone },
        },
      ],
    }
    assertSucceeded(
      await operation({
        serviceUrl,
        operatorKey,
        path: "/v1/generate",
        body: generateBody,
        key: scenario.idempotencyKeys.generate,
        record,
        step: "generate",
      }),
      "generate",
    )
    const failedA = await operation({
      serviceUrl,
      operatorKey,
      path: "/v1/evaluate",
      body: { editionId: editionA.id, thresholds: scenario.quality.failingThresholds },
      key: scenario.idempotencyKeys.evaluateFailA,
      record,
      step: "evaluate-a-fail",
    })
    if (failedA.state !== "succeeded" || failedA.result?.decision === "passed")
      fail("MVP_EXPECTED_QUALITY_FAILURE")
    assertPassed(
      await operation({
        serviceUrl,
        operatorKey,
        path: "/v1/evaluate",
        body: { editionId: editionB.id, thresholds: scenario.quality.passingThresholds },
        key: scenario.idempotencyKeys.evaluateB,
        record,
        step: "evaluate-b-pass",
      }),
      "evaluate-b-pass",
    )
    await transition(tokens.editor, editionA.id, "review")
    await transition(tokens.reviewer, editionA.id, "draft", {
      reason: "quality evidence requires one revision",
    })
    await transition(tokens.editor, editionA.id, "generating")
    assertSucceeded(
      await operation({
        serviceUrl,
        operatorKey,
        path: "/v1/generate",
        body: { ...generateBody, targets: [generateBody.targets[0]] },
        key: scenario.idempotencyKeys.generateRevisionA,
        record,
        step: "revise-a-once",
      }),
      "revise-a-once",
    )
    assertPassed(
      await operation({
        serviceUrl,
        operatorKey,
        path: "/v1/evaluate",
        body: { editionId: editionA.id, thresholds: scenario.quality.passingThresholds },
        key: scenario.idempotencyKeys.evaluatePassA,
        record,
        step: "evaluate-a-pass",
      }),
      "evaluate-a-pass",
    )
    await transition(tokens.editor, editionA.id, "review")
    await transition(tokens.editor, editionB.id, "review")
    await transition(tokens.reviewer, editionA.id, "approved")
    await transition(tokens.reviewer, editionB.id, "approved")

    const publish = async (edition, key, step) => {
      const published = await operation({
        serviceUrl,
        operatorKey,
        path: "/v1/publish",
        body: { editionId: edition.id, reason: step },
        key,
        record,
        step,
      })
      assertSucceeded(published, step)
      const releaseId = published.result?.releaseId
      if (typeof releaseId !== "string") fail(`MVP_RELEASE_ID_MISSING:${step}`)
      await transition(tokens.publisher, edition.id, "compiled", { compiledReleaseId: releaseId })
      await transition(tokens.publisher, edition.id, "published", { reason: step })
      return releaseId
    }
    const releaseA1 = await publish(editionA, scenario.idempotencyKeys.publishV1A, "publish-a-v1")
    const releaseB1 = await publish(editionB, scenario.idempotencyKeys.publishV1B, "publish-b-v1")
    await cms(cmsUrl, tokens.editor, `/editions/${editionA.id}/draft-from-published`, "POST", {
      reason: "v2 URL update",
    })
    const rename = await cms(
      cmsUrl,
      tokens.editor,
      `/url-record-operations/${urlA.id}/rename`,
      "POST",
      {
        locale: "en-US",
        pathname: `${scenario.editions[0].pathname}-v2`,
      },
    )
    await transition(tokens.editor, editionA.id, "generating")
    assertSucceeded(
      await operation({
        serviceUrl,
        operatorKey,
        path: "/v1/generate",
        body: { ...generateBody, targets: [generateBody.targets[0]] },
        key: scenario.idempotencyKeys.generateV2A,
        record,
        step: "generate-a-v2",
      }),
      "generate-a-v2",
    )
    assertPassed(
      await operation({
        serviceUrl,
        operatorKey,
        path: "/v1/evaluate",
        body: { editionId: editionA.id, thresholds: scenario.quality.passingThresholds },
        key: scenario.idempotencyKeys.evaluateV2A,
        record,
        step: "evaluate-a-v2",
      }),
      "evaluate-a-v2",
    )
    await transition(tokens.editor, editionA.id, "review")
    await transition(tokens.reviewer, editionA.id, "approved")
    const releaseA2 = await publish(editionA, scenario.idempotencyKeys.publishV2A, "publish-a-v2")
    const releases = await list(cmsUrl, tokens.publisher, "releases")
    const from = releases.find((release) => release.releaseId === releaseA2)
    const target = releases.find((release) => release.releaseId === releaseA1)
    if (from === undefined || target === undefined) fail("MVP_ROLLBACK_RELEASE_LOOKUP_FAILED")
    const intent = await cms(cmsUrl, tokens.publisher, "/rollback-operations/intents", "POST", {
      siteId: siteA.id,
      expectedCurrentReleaseId: from.releaseId,
      expectedCurrentManifestSha256: from.manifestSha256,
      targetReleaseId: target.releaseId,
      expectedManifestSha256: target.manifestSha256,
      reason: "verify deterministic rollback",
    })
    assertSucceeded(
      await operation({
        serviceUrl,
        operatorKey,
        path: "/v1/rollback",
        body: {
          siteId: intent.runtimeSiteId,
          rollbackIntentId: intent.intentId,
          expectedCurrentReleaseId: from.releaseId,
          expectedCurrentManifestSha256: from.manifestSha256,
          targetReleaseId: target.releaseId,
          expectedManifestSha256: target.manifestSha256,
          reason: "verify deterministic rollback",
        },
        key: scenario.idempotencyKeys.rollbackA,
        record,
        step: "rollback-a",
      }),
      "rollback-a",
    )
    record.steps.push({
      releaseA1,
      releaseA2,
      releaseB1,
      rename,
      step: "assertions",
      status: "passed",
    })
    await writeFile(
      resolve(recordDirectory, "timeline.json"),
      `${JSON.stringify(record.steps, null, 2)}\n`,
    )
  } finally {
    await Promise.all([...started].reverse().map(stop))
    password.fill?.("\0")
  }
}

const [command, ...argumentsList] = process.argv.slice(2)
if (command === "seed") {
  await securePassword()
  await run("pnpm", ["mvp:seed"])
} else if (command === "run") {
  const recordIndex = argumentsList.indexOf("--record")
  const recordDirectory = recordIndex === -1 ? undefined : argumentsList[recordIndex + 1]
  if (typeof recordDirectory !== "string" || recordDirectory.length === 0)
    fail("MVP_RECORD_DIRECTORY_REQUIRED")
  await runScenario(resolve(recordDirectory))
} else {
  fail("MVP_SCENARIO_COMMAND_INVALID")
}
