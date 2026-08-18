import { z } from "zod"

import { DEFAULT_TEST_SEED } from "../determinism.js"
import { EvidenceVerificationError } from "./errors.js"
import { EvidenceProcessError } from "./process.js"
import { runHarness } from "./run.js"
import { verifyEvidence } from "./verify.js"

const readEnvironment = (name: string): string | undefined => process.env[name]

type ParsedArguments = {
  readonly evidenceDirectory: string
  readonly fresh: boolean
  readonly seed: number
}

const parseArguments = (argumentsList: readonly string[]): ParsedArguments => {
  let evidenceDirectory = readEnvironment("GEO_FOUNDRY_EVIDENCE_DIR") ?? ".omo/evidence/task-7"
  let fresh = false
  let seed = DEFAULT_TEST_SEED
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index]
    if (argument === "--") {
      continue
    }
    if (argument === "--fresh") {
      fresh = true
      continue
    }
    const value = argumentsList[index + 1]
    if (argument === "--output-dir" && value !== undefined) {
      evidenceDirectory = value
      index += 1
      continue
    }
    if (argument === "--seed" && value !== undefined) {
      seed = z.coerce.number().int().parse(value)
      index += 1
      continue
    }
    throw new EvidenceProcessError("EVIDENCE_ARGUMENT_INVALID")
  }
  return Object.freeze({ evidenceDirectory, fresh, seed })
}

const writeFailure = (error: EvidenceProcessError | EvidenceVerificationError): void => {
  process.stderr.write(
    `${JSON.stringify({
      code: error.code,
      paths: error instanceof EvidenceVerificationError ? error.paths : [],
    })}\n`,
  )
}

export const runHarnessCli = async (
  argumentsList: readonly string[],
  workspaceRoot: string,
): Promise<number> => {
  try {
    const parsed = parseArguments(argumentsList)
    const manifest = await runHarness({
      evidenceDirectory: parsed.evidenceDirectory,
      fresh: parsed.fresh,
      seed: parsed.seed,
      workspaceRoot,
    })
    process.stdout.write(`${JSON.stringify(manifest)}\n`)
    return 0
  } catch (error) {
    if (error instanceof EvidenceProcessError || error instanceof EvidenceVerificationError) {
      writeFailure(error)
      return 1
    }
    throw error
  }
}

export const verifyEvidenceCli = async (
  argumentsList: readonly string[],
  workspaceRoot: string,
): Promise<number> => {
  try {
    const parsed = parseArguments(argumentsList)
    await verifyEvidence({
      evidenceDirectory: parsed.evidenceDirectory,
      workspaceRoot,
    })
    process.stdout.write(`${JSON.stringify({ status: "verified" })}\n`)
    return 0
  } catch (error) {
    if (error instanceof EvidenceProcessError || error instanceof EvidenceVerificationError) {
      writeFailure(error)
      return 1
    }
    throw error
  }
}
