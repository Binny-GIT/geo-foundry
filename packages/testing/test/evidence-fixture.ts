import { createHash } from "node:crypto"
import { mkdir, utimes, writeFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"

export const evidenceStartedAt = "2026-08-18T00:00:00.000Z"

export type EvidenceFixtureOptions = {
  readonly evidenceDirectory: string
  readonly fresh: boolean
  readonly reportSeed?: number
  readonly seed?: number
  readonly stalePath?: string
}

export const sha256Text = (contents: string): string =>
  createHash("sha256").update(contents, "utf8").digest("hex")

const executionMetadata = (attempt: string, reportKind: string, seed: number) => ({
  attempt,
  clockInstant: "2026-08-18T00:00:00.000Z",
  fastCheckSeed: seed,
  locale: "en-US",
  reportKind,
  seed,
  timezone: "UTC",
  vitestSeed: seed,
})

const testResult = (attempt: string, failed: number, reportKind: string, seed: number): string =>
  `${JSON.stringify({
    geoFoundryExecution: executionMetadata(attempt, reportKind, seed),
    numFailedTests: failed,
    numPassedTests: failed === 0 ? 1 : 0,
    numTotalTests: 1,
    success: failed === 0,
  })}\n`

const junitResult = (attempt: string, failures: number, reportKind: string, seed: number): string =>
  `<testsuites failures="${failures}" tests="1"><properties><property name="geoFoundry.attempt" value="${attempt}"/><property name="geoFoundry.clockInstant" value="2026-08-18T00:00:00.000Z"/><property name="geoFoundry.fastCheckSeed" value="${seed}"/><property name="geoFoundry.locale" value="en-US"/><property name="geoFoundry.reportKind" value="${reportKind}"/><property name="geoFoundry.seed" value="${seed}"/><property name="geoFoundry.timezone" value="UTC"/><property name="geoFoundry.vitestSeed" value="${seed}"/></properties></testsuites>\n`

export const receiptPathFor = (evidenceDirectory: string): string =>
  resolve(evidenceDirectory, "..", ".receipts", `${basename(evidenceDirectory)}.json`)

export const writeEvidenceFixture = async (options: EvidenceFixtureOptions): Promise<void> => {
  const attempt = basename(options.evidenceDirectory)
  const seed = options.seed ?? 260_817
  const reportSeed = options.reportSeed ?? seed
  const command = (kind: "integration" | "intentional-failure" | "unit", exitCode: number) => ({
    arguments: ["exec", "vitest", "run", `--sequence.seed=${seed}`],
    command: "pnpm",
    completedAt: "2026-08-18T00:00:20.000Z",
    exitCode,
    kind,
    seed,
    startedAt: "2026-08-18T00:00:10.000Z",
    stderrPath: `logs/${kind}.stderr.log`,
    stdoutPath: `logs/${kind}.stdout.log`,
  })
  const provenanceContents = `${JSON.stringify({
    cacheSource: "none",
    clockInstant: "2026-08-18T00:00:00.000Z",
    fresh: options.fresh,
    gitDirty: true,
    gitHead: { kind: "unborn" },
    gitSha: null,
    gitStatus: ["?? package.json"],
    locale: "en-US",
    lockfileSha256: "a".repeat(64),
    nodeVersion: "24.18.0",
    pnpmVersion: "11.22.0",
    recordedAt: "2026-08-18T00:00:30.000Z",
    seed,
    timezone: "UTC",
    vitestCacheDirectory: ".vitest-cache",
  })}\n`
  const reports = new Map([
    [
      "commands.json",
      `${JSON.stringify([command("unit", 0), command("integration", 0), command("intentional-failure", 1)])}\n`,
    ],
    ["coverage/coverage-summary.json", '{"total":{"lines":{"covered":1,"pct":100,"total":1}}}\n'],
    ["integration-results.json", testResult(attempt, 0, "integration", reportSeed)],
    ["integration.junit.xml", junitResult(attempt, 0, "integration", reportSeed)],
    ["intentional-failure.json", testResult(attempt, 1, "intentional-failure", reportSeed)],
    ["intentional-failure.junit.xml", junitResult(attempt, 1, "intentional-failure", reportSeed)],
    ["junit.xml", junitResult(attempt, 0, "unit", reportSeed)],
    [
      "logs/integration.stdout.log",
      `Running tests with seed "${reportSeed}"\nGEO_FOUNDRY_FAST_CHECK_SEED=${reportSeed}\n`,
    ],
    [
      "logs/intentional-failure.stdout.log",
      `Running tests with seed "${reportSeed}"\nGEO_FOUNDRY_FAST_CHECK_SEED=${reportSeed}\n`,
    ],
    [
      "logs/unit.stdout.log",
      `Running tests with seed "${reportSeed}"\nGEO_FOUNDRY_FAST_CHECK_SEED=${reportSeed}\n`,
    ],
    ["provenance.json", provenanceContents],
    [
      "task-7-geo-foundry-development-plan.json",
      `${JSON.stringify({
        fresh: true,
        integrationReport: "integration-results.json",
        intentionalFailureReport: "intentional-failure.json",
        provenance: "provenance.json",
        status: "passed",
        task: 7,
        unitReport: "test-results.json",
      })}\n`,
    ],
    ["test-results.json", testResult(attempt, 0, "unit", reportSeed)],
  ])
  await Promise.all(
    [...reports].map(async ([path, contents]) => {
      const absolutePath = join(options.evidenceDirectory, path)
      await mkdir(dirname(absolutePath), { recursive: true })
      await writeFile(absolutePath, contents, "utf8")
    }),
  )
  if (options.stalePath !== undefined) {
    const staleDate = new Date("2026-08-17T00:00:00.000Z")
    await utimes(join(options.evidenceDirectory, options.stalePath), staleDate, staleDate)
  }
  const manifest = {
    attempt,
    completedAt: "2026-08-18T00:01:00.000Z",
    execution: {
      fresh: options.fresh,
      runner: "direct-vitest",
      turboCache: options.fresh ? "bypassed" : "read",
      vitestCache: "attempt-local",
    },
    reports: [...reports].map(([path, contents]) => ({
      generatedAt: "2026-08-18T00:00:30.000Z",
      path,
      sha256: sha256Text(contents),
    })),
    seed,
    startedAt: evidenceStartedAt,
    version: 1,
  }
  const manifestContents = `${JSON.stringify(manifest, null, 2)}\n`
  await writeFile(
    join(options.evidenceDirectory, "evidence-manifest.json"),
    manifestContents,
    "utf8",
  )
  const receiptPath = receiptPathFor(options.evidenceDirectory)
  await mkdir(dirname(receiptPath), { recursive: true })
  await writeFile(
    receiptPath,
    `${JSON.stringify({
      canonicalManifestSha256: sha256Text(manifestContents),
      createdAt: "2026-08-18T00:01:01.000Z",
      provenanceSha256: sha256Text(provenanceContents),
      runIdentity: {
        attempt,
        seed,
        startedAt: evidenceStartedAt,
      },
      version: 1,
    })}\n`,
    "utf8",
  )
}
