import { readFile, stat } from "node:fs/promises"
import { basename, resolve } from "node:path"
import { z } from "zod"

import { EvidenceVerificationError } from "./errors.js"
import { readJson, sha256 } from "./files.js"
import {
  commandRecordSchema,
  evidenceManifestSchema,
  provenanceSchema,
  REQUIRED_ARTIFACT_PATHS,
  REQUIRED_REPORT_PATHS,
} from "./model.js"
import { resolveEvidenceArtifactPath, resolveEvidenceDirectory } from "./path.js"
import { verifyEvidenceReceipt } from "./receipt.js"
import { assertTestReportExecution } from "./test-reports.js"

export type EvidenceVerificationOptions = {
  readonly evidenceDirectory: string
  readonly workspaceRoot: string
}

const reportExists = async (path: string): Promise<boolean> => {
  try {
    const metadata = await stat(path)
    return metadata.isFile() && metadata.size > 0
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false
    }
    throw error
  }
}

const assertFreshManifest = (manifest: z.output<typeof evidenceManifestSchema>): void => {
  if (
    !manifest.execution.fresh ||
    manifest.execution.turboCache !== "bypassed" ||
    manifest.execution.vitestCache !== "attempt-local"
  ) {
    throw new EvidenceVerificationError("EVIDENCE_CACHE_ONLY", ["evidence-manifest.json"])
  }
  const manifestPaths = manifest.reports.map(({ path }) => path).sort()
  const requiredPaths = [...REQUIRED_ARTIFACT_PATHS].sort()
  if (JSON.stringify(manifestPaths) !== JSON.stringify(requiredPaths)) {
    throw new EvidenceVerificationError("EVIDENCE_MANIFEST_INCOMPLETE", ["evidence-manifest.json"])
  }
}

const assertReportRecords = async (
  evidenceDirectory: string,
  manifest: z.output<typeof evidenceManifestSchema>,
): Promise<void> => {
  const startedAt = Date.parse(manifest.startedAt)
  for (const report of manifest.reports) {
    const absolutePath = await resolveEvidenceArtifactPath(evidenceDirectory, report.path)
    const [contents, metadata] = await Promise.all([readFile(absolutePath), stat(absolutePath)])
    if (metadata.mtimeMs < startedAt) {
      throw new EvidenceVerificationError("EVIDENCE_REPORT_STALE", [report.path])
    }
    if (sha256(contents) !== report.sha256) {
      throw new EvidenceVerificationError("EVIDENCE_REPORT_HASH_MISMATCH", [report.path])
    }
  }
}

const testResultsSchema = z
  .object({
    numFailedTests: z.number().int().nonnegative(),
    numTotalTests: z.number().int().positive(),
    success: z.boolean(),
  })
  .loose()
const coverageSummarySchema = z
  .object({
    total: z.object({ lines: z.object({ total: z.number().int().positive() }).loose() }).loose(),
  })
  .loose()
const taskSummarySchema = z
  .object({
    fresh: z.literal(true),
    integrationReport: z.literal("integration-results.json"),
    intentionalFailureReport: z.literal("intentional-failure.json"),
    provenance: z.literal("provenance.json"),
    status: z.literal("passed"),
    task: z.literal(7),
    unitReport: z.literal("test-results.json"),
  })
  .strict()

const assertSemanticReports = async (evidenceDirectory: string, seed: number): Promise<void> => {
  const provenance = provenanceSchema.safeParse(
    await readJson(resolve(evidenceDirectory, "provenance.json")),
  )
  if (!provenance.success || !provenance.data.fresh || provenance.data.seed !== seed) {
    throw new EvidenceVerificationError("EVIDENCE_PROVENANCE_INVALID", ["provenance.json"])
  }
  for (const path of ["test-results.json", "integration-results.json"] as const) {
    const results = testResultsSchema.safeParse(await readJson(resolve(evidenceDirectory, path)))
    if (!results.success || results.data.numFailedTests !== 0 || !results.data.success) {
      throw new EvidenceVerificationError("EVIDENCE_TEST_RESULT_INVALID", [path])
    }
  }
  const failure = testResultsSchema.safeParse(
    await readJson(resolve(evidenceDirectory, "intentional-failure.json")),
  )
  if (!failure.success || failure.data.numFailedTests < 1 || failure.data.success) {
    throw new EvidenceVerificationError("EVIDENCE_FAILURE_FIXTURE_NOT_REPORTED", [
      "intentional-failure.json",
    ])
  }
  const coverage = coverageSummarySchema.safeParse(
    await readJson(resolve(evidenceDirectory, "coverage/coverage-summary.json")),
  )
  if (!coverage.success) {
    throw new EvidenceVerificationError("EVIDENCE_COVERAGE_INVALID", [
      "coverage/coverage-summary.json",
    ])
  }
  const commands = z
    .array(commandRecordSchema)
    .length(3)
    .safeParse(await readJson(resolve(evidenceDirectory, "commands.json")))
  if (!commands.success) {
    throw new EvidenceVerificationError("EVIDENCE_COMMANDS_INVALID", ["commands.json"])
  }
  const taskSummary = taskSummarySchema.safeParse(
    await readJson(resolve(evidenceDirectory, "task-7-geo-foundry-development-plan.json")),
  )
  if (!taskSummary.success) {
    throw new EvidenceVerificationError("EVIDENCE_TASK_SUMMARY_INVALID", [
      "task-7-geo-foundry-development-plan.json",
    ])
  }
  const unit = commands.data.find(({ kind }) => kind === "unit")
  const integration = commands.data.find(({ kind }) => kind === "integration")
  const intentionalFailure = commands.data.find(({ kind }) => kind === "intentional-failure")
  if (
    unit?.exitCode !== 0 ||
    unit.seed !== seed ||
    integration?.exitCode !== 0 ||
    integration.seed !== seed ||
    intentionalFailure === undefined ||
    intentionalFailure.exitCode < 1 ||
    intentionalFailure.seed !== seed ||
    commands.data.some((command) => !command.arguments.includes(`--sequence.seed=${seed}`))
  ) {
    throw new EvidenceVerificationError("EVIDENCE_COMMANDS_INVALID", ["commands.json"])
  }
}

export const verifyEvidence = async (options: EvidenceVerificationOptions): Promise<void> => {
  const evidenceDirectory = await resolveEvidenceDirectory({
    requestedDirectory: options.evidenceDirectory,
    workspaceRoot: options.workspaceRoot,
  })
  const existence = await Promise.all(
    REQUIRED_REPORT_PATHS.map(async (path) => ({
      exists: await reportExists(await resolveEvidenceArtifactPath(evidenceDirectory, path)),
      path,
    })),
  )
  const missingPaths = existence
    .filter(({ exists }) => !exists)
    .map(({ path }) => path)
    .sort()
  if (missingPaths.length > 0) {
    throw new EvidenceVerificationError("EVIDENCE_REPORT_MISSING", missingPaths)
  }
  const manifest = evidenceManifestSchema.safeParse(
    await readJson(resolve(evidenceDirectory, "evidence-manifest.json")),
  )
  if (!manifest.success) {
    throw new EvidenceVerificationError("EVIDENCE_MANIFEST_INVALID", ["evidence-manifest.json"])
  }
  if (manifest.data.attempt !== basename(evidenceDirectory)) {
    throw new EvidenceVerificationError("EVIDENCE_MANIFEST_RUN_ID_MISMATCH", [
      "evidence-manifest.json",
    ])
  }
  assertFreshManifest(manifest.data)
  await verifyEvidenceReceipt({
    evidenceDirectory,
    manifest: manifest.data,
    workspaceRoot: options.workspaceRoot,
  })
  await assertReportRecords(evidenceDirectory, manifest.data)
  await assertSemanticReports(evidenceDirectory, manifest.data.seed)
  await Promise.all(
    (["integration", "intentional-failure", "unit"] as const).map((kind) =>
      assertTestReportExecution({
        attempt: manifest.data.attempt,
        evidenceDirectory,
        kind,
        seed: manifest.data.seed,
      }),
    ),
  )
}

export { EvidenceVerificationError } from "./errors.js"
export { REQUIRED_REPORT_PATHS }
