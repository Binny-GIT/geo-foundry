import type { Payload } from "payload"

import { resolveSessionClaims } from "../access/session"

export class SiteVariantError extends Error {
  override readonly name = "SiteVariantError"

  constructor(readonly code: string) {
    super(code)
  }
}

const fail = (code: string): SiteVariantError => new SiteVariantError(code)
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

/** Creates an independent draft edition for another Site while preserving source provenance. */
export const createSiteVariant = async (
  payload: Payload,
  input: { readonly editionId: number; readonly siteId: number; readonly user: unknown },
): Promise<{ readonly editionId: number }> => {
  const claims = resolveSessionClaims(input.user)
  if (
    claims === null ||
    claims.kind !== "user" ||
    (claims.role !== "editor" && claims.role !== "tenant-admin" && claims.role !== "super-admin")
  ) {
    throw fail("SITE_VARIANT_EDITOR_REQUIRED")
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
  const site = await payload
    .findByID({ collection: "sites", depth: 0, id: input.siteId, overrideAccess: true })
    .catch(() => null)
  if (source === null || site === null) throw fail("SITE_VARIANT_NOT_FOUND")
  const tenantId = idOf(source.tenant)
  if (
    tenantId === null ||
    idOf(site.tenant) !== tenantId ||
    (claims.role !== "super-admin" && String(claims.tenantId) !== String(tenantId))
  ) {
    throw fail("SITE_VARIANT_TENANT_MISMATCH")
  }
  if (idOf(source.site) === input.siteId) throw fail("SITE_VARIANT_TARGET_SAME_SITE")

  const existing = await payload.find({
    collection: "content-editions",
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { and: [{ content: { equals: source.content } }, { site: { equals: input.siteId } }] },
  })
  if (existing.docs.length > 0) throw fail("SITE_VARIANT_ALREADY_EXISTS")

  const variant = await payload.create({
    collection: "content-editions",
    data: {
      angle: source.angle,
      body: cloneBody(source.body),
      ...(source.citations === undefined ? {} : { citations: clone(source.citations) }),
      content: source.content,
      creationOrigin: "human",
      ...(source.entities === undefined ? {} : { entities: clone(source.entities) }),
      primaryTopic: source.primaryTopic,
      ...(source.secondaryTopics === undefined
        ? {}
        : { secondaryTopics: clone(source.secondaryTopics) }),
      site: input.siteId,
      summary: source.summary,
      tenant: tenantId,
      title: source.title,
    },
    depth: 0,
    draft: true,
    overrideAccess: true,
  })
  const sources = await payload.find({
    collection: "article-sources",
    depth: 0,
    limit: 100,
    overrideAccess: true,
    where: { edition: { equals: input.editionId } },
  })
  for (const sourceLink of sources.docs) {
    await payload.create({
      collection: "article-sources",
      data: {
        edition: variant.id,
        intakeItem: sourceLink.intakeItem,
        ...(sourceLink.note === undefined ? {} : { note: sourceLink.note }),
        role: sourceLink.role,
        tenant: tenantId,
      },
      depth: 0,
      overrideAccess: true,
    })
  }
  return { editionId: variant.id }
}
