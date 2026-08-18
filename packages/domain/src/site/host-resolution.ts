import { DOMAIN_ERROR_CODE, DomainError, type DomainErrorCode } from "../errors.js"
import { err, ok, type DomainResult } from "../result.js"
import type { SiteId, TenantId } from "../ids.js"
import { normalizeHostname, type NormalizedHostname } from "../url/normalization.js"

export class SiteHostConflictError extends DomainError {
  override readonly name = "SiteHostConflictError"

  constructor(readonly hostname: string) {
    super(DOMAIN_ERROR_CODE.SITE_HOST_CONFLICT, `Host is already registered: ${hostname}`)
  }
}

export class UnknownSiteHostError extends DomainError {
  override readonly name = "UnknownSiteHostError"

  constructor(readonly hostname: string) {
    super(DOMAIN_ERROR_CODE.SITE_UNKNOWN_HOST, `Host does not resolve to any site: ${hostname}`)
  }
}

export class SiteDisabledError extends DomainError {
  override readonly name = "SiteDisabledError"

  constructor(readonly siteId: SiteId) {
    super(DOMAIN_ERROR_CODE.SITE_DISABLED, `Site is disabled: ${siteId.value}`)
  }
}

export class CanonicalHostMissingError extends DomainError {
  override readonly name = "CanonicalHostMissingError"

  constructor(readonly siteId: SiteId) {
    super(DOMAIN_ERROR_CODE.SITE_CANONICAL_MISSING, `Site has no canonical host: ${siteId.value}`)
  }
}

export const SITE_HOST_ROLE = {
  ALIAS: "alias",
  CANONICAL: "canonical",
} as const

export type SiteHostRole = (typeof SITE_HOST_ROLE)[keyof typeof SITE_HOST_ROLE]

export type SiteHostRegistration = Readonly<{
  readonly siteId: SiteId
  readonly tenantId: TenantId
  readonly hostname: NormalizedHostname
  readonly role: SiteHostRole
}>

export type ResolvedSiteHost = Readonly<{
  readonly siteId: SiteId
  readonly tenantId: TenantId
  readonly canonical: NormalizedHostname
  readonly matched: NormalizedHostname
}>

export function normalizeSiteHost(received: unknown): DomainResult<NormalizedHostname> {
  const hostname = normalizeHostname(received)
  if (!hostname.ok) {
    return err(hostname.error)
  }
  return ok(hostname.value)
}

/**
 * Deterministic host index: one normalized hostname maps to exactly one site.
 * Registration order never matters; duplicates across sites or tenants are
 * rejected with SITE_HOST_CONFLICT before any lookup can happen.
 */
export function buildSiteHostIndex(
  registrations: readonly SiteHostRegistration[],
): DomainResult<ReadonlyMap<string, SiteHostRegistration>> {
  const index = new Map<string, SiteHostRegistration>()
  for (const registration of registrations) {
    const key = registration.hostname.value
    if (index.has(key)) {
      return err(new SiteHostConflictError(key))
    }
    index.set(key, registration)
  }
  return ok(index)
}

/**
 * Fail-closed host resolution: unknown hosts, disabled sites (including
 * sites without a status entry), and sites lacking a canonical host never
 * resolve to a site.
 */
export function resolveSiteHost(
  index: ReadonlyMap<string, SiteHostRegistration>,
  enabledBySite: ReadonlyMap<string, boolean>,
  receivedHost: unknown,
): DomainResult<ResolvedSiteHost> {
  const hostname = normalizeHostname(receivedHost)
  if (!hostname.ok) {
    return err(hostname.error)
  }
  const registration = index.get(hostname.value.value)
  if (registration === undefined) {
    return err(new UnknownSiteHostError(hostname.value.value))
  }
  const enabled = enabledBySite.get(registration.siteId.value) ?? false
  if (!enabled) {
    return err(new SiteDisabledError(registration.siteId))
  }
  const canonical = findCanonicalRegistration(index, registration.siteId)
  if (canonical === undefined) {
    return err(new CanonicalHostMissingError(registration.siteId))
  }
  return ok(
    Object.freeze({
      siteId: registration.siteId,
      tenantId: registration.tenantId,
      canonical: canonical.hostname,
      matched: hostname.value,
    }),
  )
}

function findCanonicalRegistration(
  index: ReadonlyMap<string, SiteHostRegistration>,
  siteId: SiteId,
): SiteHostRegistration | undefined {
  for (const registration of index.values()) {
    if (
      registration.siteId.value === siteId.value &&
      registration.role === SITE_HOST_ROLE.CANONICAL
    ) {
      return registration
    }
  }
  return undefined
}

export type SiteResolutionFailureKind = "disabled" | "invalid-host" | "unknown-host"

const FAILURE_KIND: Readonly<Partial<Record<DomainErrorCode, SiteResolutionFailureKind>>> = {
  [DOMAIN_ERROR_CODE.SITE_CANONICAL_MISSING]: "unknown-host",
  [DOMAIN_ERROR_CODE.SITE_DISABLED]: "disabled",
  [DOMAIN_ERROR_CODE.SITE_UNKNOWN_HOST]: "unknown-host",
  [DOMAIN_ERROR_CODE.URL_INVALID_HOSTNAME]: "invalid-host",
}

export function classifySiteHostFailure(error: DomainError): SiteResolutionFailureKind | undefined {
  return FAILURE_KIND[error.code]
}
