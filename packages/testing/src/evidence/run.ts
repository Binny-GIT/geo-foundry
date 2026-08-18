import { mkdir, rm, writeFile } from "node:fs/promises"
import { basename, resolve } from "node:path"

import {
  DEFAULT_TEST_SEED,
  TEST_CLOCK_INSTANT,
  TEST_LOCALE,
  TEST_TIMEZONE,
} from "../determinism.js"
import { captureProvenance } from "./capture.js"
import { createReportRecord, writeJson } from "./files.js"
import {
  type CommandRecord,
  type EvidenceManifest,
  REQUIRED_ARTIFACT_PATHS,
  REQUIRED_REPORT_PATHS,
} from "./model.js"
import { resolveEvidenceDirectory } from "./path.js"
import { EvidenceProcessError, runProcess } from "./process.js"
import { writeEvidenceReceipt } from "./receipt.js"
import { annotateTestReports } from "./test-reports.js"
import { verifyEvidence } from "./verify.js"

export type HarnessRunOptions = {
  readonly evidenceDirectory: string
  readonly fresh: boolean
  readonly seed?: number
  readonly workspaceRoot: string
}

type TestRunOptions = {
  readonly arguments: readonly string[]
  readonly evidenceDirectory: string
  readonly kind: CommandRecord["kind"]
  readonly attempt: string
  readonly seed: number
  readonly workspaceRoot: string
}

const expectedExitCode = (kind: CommandRecord["kind"], exitCode: number): boolean => {
  switch (kind) {
    case "integration":
    case "unit":
      return exitCode === 0
    case "intentional-failure":
      return exitCode > 0
  }
}

const runTestCommand = async (options: TestRunOptions): Promise<CommandRecord> => {
  const startedAt = new Date().toISOString()
  const result = runProcess({
    arguments: options.arguments,
    command: "pnpm",
    environment: {
      ...process.env,
      GEO_FOUNDRY_EVIDENCE_DIR: options.evidenceDirectory,
      GEO_FOUNDRY_EXPECTED_TEST_SEED: String(options.seed),
      GEO_FOUNDRY_REPORT_KIND: options.kind,
      GEO_FOUNDRY_TEST_CLOCK_INSTANT: TEST_CLOCK_INSTANT,
      GEO_FOUNDRY_TEST_LOCALE: TEST_LOCALE,
      GEO_FOUNDRY_TEST_SEED: String(options.seed),
      GEO_FOUNDRY_VITEST_CACHE_DIR: resolve(options.evidenceDirectory, ".vitest-cache"),
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      TZ: TEST_TIMEZONE,
    },
    workspaceRoot: options.workspaceRoot,
  })
  const stdoutPath = `logs/${options.kind}.stdout.log`
  const stderrPath = `logs/${options.kind}.stderr.log`
  await Promise.all([
    writeFile(resolve(options.evidenceDirectory, stdoutPath), result.stdout, "utf8"),
    writeFile(resolve(options.evidenceDirectory, stderrPath), result.stderr, "utf8"),
    annotateTestReports({
      attempt: options.attempt,
      evidenceDirectory: options.evidenceDirectory,
      kind: options.kind,
      seed: options.seed,
    }),
  ])
  const record = Object.freeze({
    arguments: [...options.arguments],
    command: "pnpm",
    completedAt: new Date().toISOString(),
    exitCode: result.exitCode,
    kind: options.kind,
    seed: options.seed,
    startedAt,
    stderrPath,
    stdoutPath,
  })
  if (!expectedExitCode(options.kind, result.exitCode)) {
    throw new EvidenceProcessError(`EVIDENCE_${options.kind.toUpperCase()}_FAILED`)
  }
  return record
}

const cleanEvidenceDirectory = async (evidenceDirectory: string): Promise<void> => {
  await Promise.all([
    ...REQUIRED_REPORT_PATHS.map((path) => rm(resolve(evidenceDirectory, path), { force: true })),
    rm(resolve(evidenceDirectory, "coverage"), { force: true, recursive: true }),
    rm(resolve(evidenceDirectory, "logs"), { force: true, recursive: true }),
    rm(resolve(evidenceDirectory, ".vitest-cache"), { force: true, recursive: true }),
  ])
  await mkdir(resolve(evidenceDirectory, "logs"), { recursive: true })
}

export const runHarness = async (options: HarnessRunOptions): Promise<EvidenceManifest> => {
  if (!options.fresh) {
    throw new EvidenceProcessError("EVIDENCE_FRESH_EXECUTION_REQUIRED")
  }
  const evidenceDirectory = await resolveEvidenceDirectory({
    requestedDirectory: options.evidenceDirectory,
    workspaceRoot: options.workspaceRoot,
  })
  const seed = options.seed ?? DEFAULT_TEST_SEED
  const attempt = basename(evidenceDirectory)
  const startedAt = new Date().toISOString()
  await cleanEvidenceDirectory(evidenceDirectory)
  await resolveEvidenceDirectory({
    requestedDirectory: evidenceDirectory,
    workspaceRoot: options.workspaceRoot,
  })
  const sharedArguments = [
    "--dir",
    "packages/testing",
    "exec",
    "vitest",
    "run",
    "--configLoader",
    "runner",
    `--sequence.seed=${seed}`,
  ] as const
  const commands = await Promise.all([
    runTestCommand({
      attempt,
      arguments: [
        ...sharedArguments,
        "test/determinism.test.ts",
        "test/evidence.test.ts",
        "test/evidence-hardening.test.ts",
        "--coverage",
        "--no-file-parallelism",
      ],
      evidenceDirectory,
      kind: "unit",
      seed,
      workspaceRoot: options.workspaceRoot,
    }),
    runTestCommand({
      attempt,
      arguments: [
        ...sharedArguments,
        "test/integration/shared-service-lock.test.ts",
        "--no-file-parallelism",
      ],
      evidenceDirectory,
      kind: "integration",
      seed,
      workspaceRoot: options.workspaceRoot,
    }),
    runTestCommand({
      attempt,
      arguments: [
        ...sharedArguments,
        "--config",
        "vitest.failure.config.ts",
        "--no-file-parallelism",
      ],
      evidenceDirectory,
      kind: "intentional-failure",
      seed,
      workspaceRoot: options.workspaceRoot,
    }),
  ])
  await writeJson(resolve(evidenceDirectory, "commands.json"), commands)
  const provenance = await captureProvenance({
    fresh: true,
    recordedAt: new Date().toISOString(),
    seed,
    workspaceRoot: options.workspaceRoot,
  })
  await writeJson(resolve(evidenceDirectory, "provenance.json"), provenance)
  await writeJson(resolve(evidenceDirectory, "task-7-geo-foundry-development-plan.json"), {
    fresh: true,
    integrationReport: "integration-results.json",
    intentionalFailureReport: "intentional-failure.json",
    provenance: "provenance.json",
    status: "passed",
    task: 7,
    unitReport: "test-results.json",
  })
  const reports = await Promise.all(
    REQUIRED_ARTIFACT_PATHS.map((path) => createReportRecord(evidenceDirectory, path)),
  )
  const manifest = Object.freeze({
    attempt,
    completedAt: new Date().toISOString(),
    execution: Object.freeze({
      fresh: true,
      runner: "direct-vitest",
      turboCache: "bypassed",
      vitestCache: "attempt-local",
    }),
    reports: Object.freeze(reports),
    seed,
    startedAt,
    version: 1,
  } satisfies EvidenceManifest)
  await writeJson(resolve(evidenceDirectory, "evidence-manifest.json"), manifest)
  await writeEvidenceReceipt({ evidenceDirectory, manifest, workspaceRoot: options.workspaceRoot })
  await verifyEvidence({ evidenceDirectory, workspaceRoot: options.workspaceRoot })
  return manifest
}
