export const DOMAIN_ERROR_CODE = {
  CONTENT_EDITION_PUBLISHER_REQUIRED: "CONTENT_EDITION_PUBLISHER_REQUIRED",
  CONTENT_EDITION_QUALITY_NOT_PASSED: "CONTENT_EDITION_QUALITY_NOT_PASSED",
  CONTENT_EDITION_REVIEWER_REQUIRED: "CONTENT_EDITION_REVIEWER_REQUIRED",
  CONTENT_EDITION_EDITOR_REQUIRED: "CONTENT_EDITION_EDITOR_REQUIRED",
  CONTENT_EDITION_SOURCE_NOT_PUBLISHED: "CONTENT_EDITION_SOURCE_NOT_PUBLISHED",
  CONTENT_EDITION_TRANSITION_NOT_ALLOWED: "CONTENT_EDITION_TRANSITION_NOT_ALLOWED",
  INVALID_HASH: "INVALID_HASH",
  INVALID_IDENTIFIER: "INVALID_IDENTIFIER",
  INVALID_INSTANT: "INVALID_INSTANT",
  OPERATION_TRANSITION_NOT_ALLOWED: "OPERATION_TRANSITION_NOT_ALLOWED",
  OPERATION_RETRY_SOURCE_NOT_FAILED: "OPERATION_RETRY_SOURCE_NOT_FAILED",
  QUALITY_ASSESSMENT_TRANSITION_NOT_ALLOWED: "QUALITY_ASSESSMENT_TRANSITION_NOT_ALLOWED",
  RELEASE_MANIFEST_NOT_VERIFIED: "RELEASE_MANIFEST_NOT_VERIFIED",
  RELEASE_POINTER_CAS_CONFLICT: "RELEASE_POINTER_CAS_CONFLICT",
  RELEASE_PUBLISHER_REQUIRED: "RELEASE_PUBLISHER_REQUIRED",
  RELEASE_TRANSITION_NOT_ALLOWED: "RELEASE_TRANSITION_NOT_ALLOWED",
  SITE_CANONICAL_MISSING: "SITE_CANONICAL_MISSING",
  SITE_DISABLED: "SITE_DISABLED",
  SITE_HOST_CONFLICT: "SITE_HOST_CONFLICT",
  SITE_INVALID_TIMEZONE: "SITE_INVALID_TIMEZONE",
  SITE_UNKNOWN_HOST: "SITE_UNKNOWN_HOST",
  STALE_AGGREGATE_STATE: "STALE_AGGREGATE_STATE",
  UNREACHABLE_STATE: "UNREACHABLE_STATE",
  URL_ID_COLLISION: "URL_ID_COLLISION",
  URL_INVALID_HOSTNAME: "URL_INVALID_HOSTNAME",
  URL_INVALID_LOCALE: "URL_INVALID_LOCALE",
  URL_INVALID_PATHNAME: "URL_INVALID_PATHNAME",
  URL_PATH_ENCODED_SEPARATOR_AMBIGUOUS: "URL_PATH_ENCODED_SEPARATOR_AMBIGUOUS",
  URL_PATH_QUERY_OR_FRAGMENT: "URL_PATH_QUERY_OR_FRAGMENT",
  URL_REDIRECT_CROSS_SITE: "URL_REDIRECT_CROSS_SITE",
  URL_REDIRECT_CROSS_TENANT: "URL_REDIRECT_CROSS_TENANT",
  URL_REDIRECT_CHAIN: "URL_REDIRECT_CHAIN",
  URL_REDIRECT_LOOP: "URL_REDIRECT_LOOP",
  URL_REDIRECT_TARGET_NOT_ACTIVE: "URL_REDIRECT_TARGET_NOT_ACTIVE",
  URL_RECORD_TRANSITION_NOT_ALLOWED: "URL_RECORD_TRANSITION_NOT_ALLOWED",
  URL_RECORD_NOT_ACTIVE: "URL_RECORD_NOT_ACTIVE",
  URL_RECORD_NOT_FOUND: "URL_RECORD_NOT_FOUND",
  URL_RECORD_NOT_RESERVED: "URL_RECORD_NOT_RESERVED",
  URL_REGISTRY_REVISION_CONFLICT: "URL_REGISTRY_REVISION_CONFLICT",
  URL_RESERVED_ROUTE_COLLISION: "URL_RESERVED_ROUTE_COLLISION",
  URL_SITEMAP_DRAFT_INELIGIBLE: "URL_SITEMAP_DRAFT_INELIGIBLE",
  URL_SITEMAP_GONE_INELIGIBLE: "URL_SITEMAP_GONE_INELIGIBLE",
  URL_SITEMAP_REDIRECT_INELIGIBLE: "URL_SITEMAP_REDIRECT_INELIGIBLE",
  URL_UNIQUE_KEY_COLLISION: "URL_UNIQUE_KEY_COLLISION",
} as const

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODE)[keyof typeof DOMAIN_ERROR_CODE]

export class DomainError extends Error {
  override readonly name: string = "DomainError"

  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export class InvalidIdentifierError extends DomainError {
  override readonly name: string = "InvalidIdentifierError"

  constructor(
    readonly identifierType: string,
    readonly received: unknown,
  ) {
    super(DOMAIN_ERROR_CODE.INVALID_IDENTIFIER, `Invalid ${identifierType}`)
  }
}

export class InvalidInstantError extends DomainError {
  override readonly name: string = "InvalidInstantError"

  constructor(readonly received: string) {
    super(DOMAIN_ERROR_CODE.INVALID_INSTANT, "Instant must be canonical ISO-8601 UTC")
  }
}

export class InvalidHashError extends DomainError {
  override readonly name: string = "InvalidHashError"

  constructor(readonly received: string) {
    super(DOMAIN_ERROR_CODE.INVALID_HASH, "Hash must be a lowercase SHA-256 digest")
  }
}

export class InvalidTransitionError<S extends string> extends DomainError {
  override readonly name: string = "InvalidTransitionError"

  constructor(
    code: DomainErrorCode,
    readonly from: S,
    readonly to: S,
  ) {
    super(code, `Transition from ${from} to ${to} is not allowed`)
  }
}

export class StaleAggregateStateError extends DomainError {
  override readonly name: string = "StaleAggregateStateError"

  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(DOMAIN_ERROR_CODE.STALE_AGGREGATE_STATE, "Aggregate revision is stale")
  }
}

export class TransitionGuardError extends DomainError {
  override readonly name: string = "TransitionGuardError"
}

export class UnreachableStateError extends DomainError {
  override readonly name: string = "UnreachableStateError"

  constructor() {
    super(DOMAIN_ERROR_CODE.UNREACHABLE_STATE, "Unreachable domain state")
  }
}
