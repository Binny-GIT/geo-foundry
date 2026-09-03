import type { Payload } from "payload"

import { resolveSessionClaims } from "../access/session"

export class EditionDuplicateError extends Error {
  override readonly name = "EditionDuplicateError"

  constructor(readonly code: string) {
    super(code)
  }
}

const fail = (code: string): EditionDuplicateError => new EditionDuplicateError(code)

const idOf = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value
  if (typeof value === "object" && value !== null)
    return idOf((value as Record<string, unknown>)["id"])
  return null
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const cloneBody = <T>(value: T): T => {
  if (Array.isArray(value)) return value.map(cloneBody) as T
  if (typeof value !== "object" || value === null) return value
  const row = value as Record<string, unknown>
  return Object.fromEntries(
    Object.entries(row)
      .filter(([key]) => key !== "id")
      .map(([key, child]) => [key, cloneBody(child)]),
  ) as T
}

/**
 * Copy an edition into a fresh draft (same content topic, same tenant/site
 * assignment) — the "复制为新草稿" operator action.
 */
export const duplicateEdition = async (
  payload: Payload,
  input: { readonly editionId: number; readonly user: unknown },
): Promise<{ readonly editionId: number }> => {
  const claims = resolveSessionClaims(input.user)
  if (
    claims === null ||
    claims.kind !== "user" ||
    (claims.role !== "editor" && claims.role !== "tenant-admin" && claims.role !== "super-admin")
  ) {
    throw fail("EDITION_DUPLICATE_FORBIDDEN")
  }

  const source = await payload
    .findByID({
      collection: "content-editions",
      depth: 0,
      draft: true,
      id: input.editionId,
      overrideAccess: true,
    })
    .catch(() => null)
  if (source === null) throw fail("EDITION_DUPLICATE_NOT_FOUND")

  const tenantId = idOf(source.tenant)
  if (tenantId === null) throw fail("EDITION_DUPLICATE_NOT_FOUND")
  if (claims.role !== "super-admin" && String(claims.tenantId) !== String(tenantId)) {
    throw fail("EDITION_DUPLICATE_TENANT_MISMATCH")
  }

  const created = await payload.create({
    collection: "content-editions",
    data: {
      angle: source.angle,
      body: cloneBody(source.body),
      ...(source.citations === undefined ? {} : { citations: clone(source.citations) }),
      content: source.content,
      creationOrigin: source.creationOrigin ?? "human",
      ...(source.entities === undefined ? {} : { entities: clone(source.entities) }),
      primaryTopic: source.primaryTopic,
      ...(source.secondaryTopics === undefined
        ? {}
        : { secondaryTopics: clone(source.secondaryTopics) }),
      site: source.site,
      summary: source.summary,
      tenant: tenantId,
      title: source.title,
    },
    depth: 0,
    draft: true,
    overrideAccess: true,
  })
  return { editionId: created.id }
}
