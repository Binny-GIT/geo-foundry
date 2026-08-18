import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import {
  DEFAULT_TEST_SEED,
  TEST_CLOCK_INSTANT,
  TEST_LOCALE,
  TEST_TIMEZONE,
} from "../determinism.js"
import { sha256 } from "./files.js"
import { EvidenceProcessError, runProcess } from "./process.js"
import { buildProvenance, type GitHead, type Provenance } from "./provenance.js"

export type CaptureProvenanceOptions = {
  readonly fresh: boolean
  readonly recordedAt: string
  readonly seed?: number
  readonly workspaceRoot: string
}

const captureGitHead = (workspaceRoot: string): GitHead => {
  const result = runProcess({
    arguments: ["rev-parse", "--verify", "HEAD"],
    command: "git",
    workspaceRoot,
  })
  if (result.exitCode !== 0) {
    return Object.freeze({ kind: "unborn" })
  }
  return Object.freeze({ kind: "commit", sha: result.stdout.trim() })
}

const captureGitStatus = (workspaceRoot: string): readonly string[] => {
  const result = runProcess({
    arguments: ["status", "--porcelain=v1", "--untracked-files=all"],
    command: "git",
    workspaceRoot,
  })
  if (result.exitCode !== 0) {
    throw new EvidenceProcessError("GIT_STATUS_CAPTURE_FAILED")
  }
  return Object.freeze(result.stdout.split("\n").filter((line) => line.length > 0))
}

export const captureProvenance = async (options: CaptureProvenanceOptions): Promise<Provenance> => {
  const pnpm = runProcess({
    arguments: ["--version"],
    command: "pnpm",
    workspaceRoot: options.workspaceRoot,
  })
  if (pnpm.exitCode !== 0) {
    throw new EvidenceProcessError("PNPM_VERSION_CAPTURE_FAILED")
  }
  const lockfile = await readFile(resolve(options.workspaceRoot, "pnpm-lock.yaml"))
  return buildProvenance({
    clockInstant: TEST_CLOCK_INSTANT,
    fresh: options.fresh,
    gitHead: captureGitHead(options.workspaceRoot),
    gitStatus: captureGitStatus(options.workspaceRoot),
    locale: TEST_LOCALE,
    lockfileSha256: sha256(lockfile),
    nodeVersion: process.versions.node,
    pnpmVersion: pnpm.stdout.trim(),
    recordedAt: options.recordedAt,
    seed: options.seed ?? DEFAULT_TEST_SEED,
    timezone: TEST_TIMEZONE,
    vitestCacheDirectory: ".vitest-cache",
  })
}
