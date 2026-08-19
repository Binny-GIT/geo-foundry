import { CompilerError, COMPILER_ERROR } from "./errors.js"

const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/

/**
 * Compiler inputs are UTC instants only: anything carrying a timezone offset
 * would make output depend on ambient locale settings, so it is rejected.
 */
export const requireUtcInstant = (value: string, field: string): string => {
  if (typeof value !== "string" || !UTC_INSTANT.test(value)) {
    throw new CompilerError(
      COMPILER_ERROR.INSTANT_NOT_UTC,
      `${field} must be a UTC instant ending in Z, received ${String(value)}`,
    )
  }
  return value
}

export type CompileSite = {
  readonly canonicalDomain: string
  readonly locale: string
  readonly name: string
  readonly seoDefaults: { readonly description: string; readonly title: string }
  readonly siteId: string
  readonly timezone: string
}

export type CompileMedia = {
  readonly alt?: string
  readonly height?: number
  readonly id: string
  readonly path: string
  readonly width?: number
}

export type CompileEdition = {
  readonly assessmentInputHash: string
  readonly assessmentState: "error" | "failed" | "passed"
  readonly author?: {
    readonly id: string
    readonly name: string
    readonly url: string
  }
  readonly body: readonly unknown[]
  readonly categories: readonly string[]
  readonly citations?: readonly {
    id: string
    title: string
    url: string
  }[]
  readonly contentId: number
  readonly editionId: number
  readonly entities?: readonly unknown[]
  readonly media: readonly CompileMedia[]
  readonly modifiedAt: string
  readonly publishedAt: string
  readonly secondaryTopics?: readonly string[]
  readonly siteId: string
  readonly status:
    | "approved"
    | "archived"
    | "compiled"
    | "draft"
    | "generating"
    | "published"
    | "review"
  readonly summary: string
  readonly tags: readonly string[]
  readonly title: string
  readonly urlPathname: string
  readonly urlStatus: "active" | "gone" | "redirected" | "reserved"
}

/** Gate preconditions shared by every content page compiler. */
export const assertEditionCompilable = (edition: CompileEdition): void => {
  if (
    edition.status !== "approved" &&
    edition.status !== "compiled" &&
    edition.status !== "published"
  ) {
    throw new CompilerError(
      COMPILER_ERROR.EDITION_NOT_APPROVED,
      `edition ${edition.editionId} is ${edition.status}, only approved/compiled/published editions compile`,
    )
  }
  if (edition.assessmentState !== "passed") {
    throw new CompilerError(
      COMPILER_ERROR.ASSESSMENT_NOT_PASSED,
      `edition ${edition.editionId} assessment is ${edition.assessmentState}`,
    )
  }
  if (edition.urlStatus !== "active") {
    throw new CompilerError(
      COMPILER_ERROR.URL_NOT_ACTIVE,
      `edition ${edition.editionId} URL is ${edition.urlStatus}`,
    )
  }
  requireUtcInstant(edition.publishedAt, `edition ${edition.editionId} publishedAt`)
  requireUtcInstant(edition.modifiedAt, `edition ${edition.editionId} modifiedAt`)
}
