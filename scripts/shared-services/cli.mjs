import { assertRunId, SharedServicesError } from "./resources.mjs"

const defaultRunId = "task-2-manual"

export const parseRunId = (argumentsList) => {
  if (argumentsList.length === 0) {
    return defaultRunId
  }

  const [flag, runId, ...remaining] = argumentsList
  if (flag !== "--run-id" || runId === undefined || remaining.length > 0) {
    throw new SharedServicesError(
      "SHARED_SERVICE_ARGUMENT_INVALID",
      "Use --run-id <lowercase-hyphenated-id> or omit it for the deterministic manual run ID.",
    )
  }

  return assertRunId(runId)
}

export const writeSafeFailure = (error) => {
  const diagnostic =
    error instanceof SharedServicesError
      ? { code: error.code, remediation: error.remediation }
      : {
          code: "SHARED_SERVICE_OPERATION_FAILED",
          remediation:
            "Confirm shared-service reachability and the injected service account privileges.",
        }
  process.stderr.write(`${JSON.stringify(diagnostic)}\n`)
}
