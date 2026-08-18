import { spawnSync } from "node:child_process"

export type ProcessRequest = {
  readonly arguments: readonly string[]
  readonly command: string
  readonly environment?: NodeJS.ProcessEnv
  readonly workspaceRoot: string
}

export type ProcessResult = {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

export class EvidenceProcessError extends Error {
  override readonly name = "EvidenceProcessError"

  constructor(readonly code: string) {
    super(code)
  }
}

export const runProcess = (request: ProcessRequest): ProcessResult => {
  const result = spawnSync(request.command, request.arguments, {
    cwd: request.workspaceRoot,
    encoding: "utf8",
    env: request.environment,
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.error !== undefined) {
    throw new EvidenceProcessError("EVIDENCE_PROCESS_START_FAILED")
  }
  return Object.freeze({
    exitCode: result.status ?? 1,
    stderr: result.stderr,
    stdout: result.stdout,
  })
}
