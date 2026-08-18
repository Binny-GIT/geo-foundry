import { InvalidIdentifierError } from "./errors.js"
import { err, ok, type DomainResult } from "./result.js"

const identifierBrand: unique symbol = Symbol("geo.identifier")

export const IDENTIFIER_KIND = {
  ASSESSMENT: "AssessmentId",
  CONTENT: "ContentId",
  DOMAIN: "DomainId",
  EDITION: "EditionId",
  OPERATION: "OperationId",
  RELEASE: "ReleaseId",
  SITE: "SiteId",
  TENANT: "TenantId",
  URL: "UrlId",
  USER: "UserId",
} as const

type IdentifierKind = (typeof IDENTIFIER_KIND)[keyof typeof IDENTIFIER_KIND]
type Identifier<K extends IdentifierKind> = Readonly<{
  readonly value: string
  readonly [identifierBrand]: K
}>

export type AssessmentId = Identifier<"AssessmentId">
export type ContentId = Identifier<"ContentId">
export type DomainId = Identifier<"DomainId">
export type EditionId = Identifier<"EditionId">
export type OperationId = Identifier<"OperationId">
export type ReleaseId = Identifier<"ReleaseId">
export type SiteId = Identifier<"SiteId">
export type TenantId = Identifier<"TenantId">
export type UrlId = Identifier<"UrlId">
export type UserId = Identifier<"UserId">

function parseIdentifier<K extends IdentifierKind>(
  received: unknown,
  kind: K,
): DomainResult<Identifier<K>, InvalidIdentifierError> {
  if (
    typeof received !== "string" ||
    received.length === 0 ||
    received.length > 128 ||
    received.trim() !== received
  ) {
    return err(new InvalidIdentifierError(kind, received))
  }
  return ok(Object.freeze({ [identifierBrand]: kind, value: received }))
}

export function parseAssessmentId(value: unknown): DomainResult<AssessmentId> {
  return parseIdentifier(value, IDENTIFIER_KIND.ASSESSMENT)
}

export function parseContentId(value: unknown): DomainResult<ContentId> {
  return parseIdentifier(value, IDENTIFIER_KIND.CONTENT)
}

export function parseDomainId(value: unknown): DomainResult<DomainId> {
  return parseIdentifier(value, IDENTIFIER_KIND.DOMAIN)
}

export function parseEditionId(value: unknown): DomainResult<EditionId> {
  return parseIdentifier(value, IDENTIFIER_KIND.EDITION)
}

export function parseOperationId(value: unknown): DomainResult<OperationId> {
  return parseIdentifier(value, IDENTIFIER_KIND.OPERATION)
}

export function parseReleaseId(value: unknown): DomainResult<ReleaseId> {
  return parseIdentifier(value, IDENTIFIER_KIND.RELEASE)
}

export function parseSiteId(value: unknown): DomainResult<SiteId> {
  return parseIdentifier(value, IDENTIFIER_KIND.SITE)
}

export function parseTenantId(value: unknown): DomainResult<TenantId> {
  return parseIdentifier(value, IDENTIFIER_KIND.TENANT)
}

export function parseUrlId(value: unknown): DomainResult<UrlId> {
  return parseIdentifier(value, IDENTIFIER_KIND.URL)
}

export function parseUserId(value: unknown): DomainResult<UserId> {
  return parseIdentifier(value, IDENTIFIER_KIND.USER)
}
