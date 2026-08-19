export const PROVIDER_ERROR_CODE = {
  AUTH_FAILED: "PROVIDER_AUTH_FAILED",
  BAD_REQUEST: "PROVIDER_BAD_REQUEST",
  CONNECTION_DROPPED: "PROVIDER_CONNECTION_DROPPED",
  DIMENSION_MISMATCH: "PROVIDER_DIMENSION_MISMATCH",
  FAKE_FIXTURE_MISSING: "FAKE_FIXTURE_MISSING",
  MALFORMED_RESPONSE: "PROVIDER_MALFORMED_RESPONSE",
  OVERSIZED_RESPONSE: "PROVIDER_OVERSIZED_RESPONSE",
  RATE_LIMITED: "PROVIDER_RATE_LIMITED",
  SERVER_ERROR: "PROVIDER_SERVER_ERROR",
  TIMEOUT: "PROVIDER_TIMEOUT",
  UNEXPECTED_STATUS: "PROVIDER_UNEXPECTED_STATUS",
} as const

export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODE)[keyof typeof PROVIDER_ERROR_CODE]

export type ProviderRetryability = "retryable" | "terminal"

export class ProviderError extends Error {
  override readonly name = "ProviderError"

  constructor(
    readonly code: ProviderErrorCode,
    readonly retryability: ProviderRetryability,
    message: string,
    readonly status: number | null = null,
    readonly retryAfterMs: number | undefined = undefined,
    readonly requestId: string | null = null,
  ) {
    super(message)
  }
}

export class ProviderConfigurationError extends Error {
  override readonly name = "ProviderConfigurationError"

  constructor(readonly variables: readonly string[]) {
    super(`AI_PROVIDER_ENV_INVALID: ${variables.join(", ")}`)
  }
}
