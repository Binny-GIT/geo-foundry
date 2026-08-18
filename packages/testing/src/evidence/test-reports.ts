import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { z } from "zod"

import { TEST_CLOCK_INSTANT, TEST_LOCALE, TEST_TIMEZONE } from "../determinism.js"
import { EvidenceVerificationError } from "./errors.js"
import { readJson, writeJson } from "./files.js"
import {
  type CommandRecord,
  type TestExecutionMetadata,
  testExecutionMetadataSchema,
} from "./model.js"

export type TestReportOptions = {
  readonly attempt: string
  readonly evidenceDirectory: string
  readonly kind: CommandRecord["kind"]
  readonly seed: number
}

const reportPaths = (
  kind: CommandRecord["kind"],
): {
  readonly json: string
  readonly junit: string
} => {
  switch (kind) {
    case "integration":
      return Object.freeze({ json: "integration-results.json", junit: "integration.junit.xml" })
    case "intentional-failure":
      return Object.freeze({
        json: "intentional-failure.json",
        junit: "intentional-failure.junit.xml",
      })
    case "unit":
      return Object.freeze({ json: "test-results.json", junit: "junit.xml" })
  }
}

const executionMetadata = (options: TestReportOptions): TestExecutionMetadata =>
  Object.freeze({
    attempt: options.attempt,
    clockInstant: TEST_CLOCK_INSTANT,
    fastCheckSeed: options.seed,
    locale: TEST_LOCALE,
    reportKind: options.kind,
    seed: options.seed,
    timezone: TEST_TIMEZONE,
    vitestSeed: options.seed,
  })

const xmlEscape = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")

const junitProperties = (metadata: TestExecutionMetadata): string => {
  const properties = [
    ["attempt", metadata.attempt],
    ["clockInstant", metadata.clockInstant],
    ["fastCheckSeed", String(metadata.fastCheckSeed)],
    ["locale", metadata.locale],
    ["reportKind", metadata.reportKind],
    ["seed", String(metadata.seed)],
    ["timezone", metadata.timezone],
    ["vitestSeed", String(metadata.vitestSeed)],
  ] as const
  return `<properties>${properties
    .map(([name, value]) => `<property name="geoFoundry.${name}" value="${xmlEscape(value)}"/>`)
    .join("")}</properties>`
}

export const annotateTestReports = async (options: TestReportOptions): Promise<void> => {
  const paths = reportPaths(options.kind)
  const metadata = executionMetadata(options)
  const jsonPath = resolve(options.evidenceDirectory, paths.json)
  const report = z.record(z.string(), z.unknown()).parse(await readJson(jsonPath))
  await writeJson(jsonPath, { ...report, geoFoundryExecution: metadata })
  const junitPath = resolve(options.evidenceDirectory, paths.junit)
  const junit = await readFile(junitPath, "utf8")
  const rootStart = junit.indexOf("<testsuites")
  const rootEnd = rootStart < 0 ? -1 : junit.indexOf(">", rootStart)
  if (rootEnd < 0) {
    throw new EvidenceVerificationError("EVIDENCE_JUNIT_INVALID", [paths.junit])
  }
  await writeFile(
    junitPath,
    `${junit.slice(0, rootEnd + 1)}${junitProperties(metadata)}${junit.slice(rootEnd + 1)}`,
    "utf8",
  )
}

export const assertTestReportExecution = async (options: TestReportOptions): Promise<void> => {
  const paths = reportPaths(options.kind)
  const expected = executionMetadata(options)
  const report = z
    .object({ geoFoundryExecution: testExecutionMetadataSchema })
    .loose()
    .safeParse(await readJson(resolve(options.evidenceDirectory, paths.json)))
  if (
    !report.success ||
    JSON.stringify(report.data.geoFoundryExecution) !== JSON.stringify(expected)
  ) {
    throw new EvidenceVerificationError("EVIDENCE_TEST_SEED_MISMATCH", [paths.json])
  }
  const junit = await readFile(resolve(options.evidenceDirectory, paths.junit), "utf8")
  if (!junit.includes(junitProperties(expected))) {
    throw new EvidenceVerificationError("EVIDENCE_JUNIT_METADATA_MISMATCH", [paths.junit])
  }
  const stdoutPath = resolve(options.evidenceDirectory, "logs", `${options.kind}.stdout.log`)
  const stdout = await readFile(stdoutPath, "utf8")
  const seedMatch = stdout.match(/Running tests with seed "(-?\d+)"/)
  if (seedMatch?.[1] !== String(options.seed)) {
    throw new EvidenceVerificationError("EVIDENCE_VITEST_SEED_MISMATCH", [
      `logs/${options.kind}.stdout.log`,
    ])
  }
  const fastCheckMatches = [...stdout.matchAll(/GEO_FOUNDRY_FAST_CHECK_SEED=(-?\d+)/g)]
  if (
    fastCheckMatches.length === 0 ||
    fastCheckMatches.some((match) => match[1] !== String(options.seed))
  ) {
    throw new EvidenceVerificationError("EVIDENCE_FAST_CHECK_SEED_MISMATCH", [
      `logs/${options.kind}.stdout.log`,
    ])
  }
}
