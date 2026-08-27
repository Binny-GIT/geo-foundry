import type { Payload } from "payload"

import { resolveSessionClaims } from "../access/session"

export class ArticleSourcesError extends Error {
  override readonly name = "ArticleSourcesError"

  constructor(readonly code: string) {
    super(code)
  }
}

const fail = (code: string): ArticleSourcesError => new ArticleSourcesError(code)

const numberOf = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null

const requireTenantUser = (user: unknown) => {
  const claims = resolveSessionClaims(user)
  if (claims === null || claims.kind !== "user" || claims.tenantId === null) {
    throw fail("ARTICLE_SOURCE_ACTOR_INVALID")
  }
  if (claims.role !== "editor" && claims.role !== "tenant-admin" && claims.role !== "super-admin") {
    throw fail("ARTICLE_SOURCE_EDITOR_REQUIRED")
  }
  return claims
}

const assertEditionTenant = async (payload: Payload, editionId: number, user: unknown): Promise<number> => {
  const claims = requireTenantUser(user)
  const edition = await payload.findByID({
    collection: "content-editions",
    id: editionId,
    depth: 0,
    draft: true,
    overrideAccess: true,
  })
  const tenantId = numberOf(edition.tenant)
  if (tenantId === null || (claims.role !== "super-admin" && String(tenantId) !== String(claims.tenantId))) {
    throw fail("ARTICLE_SOURCE_TENANT_MISMATCH")
  }
  return tenantId
}

export type AddArticleSourceInput = {
  readonly editionId: number
  readonly intakeItemId: number
  readonly note?: string
  readonly role: "primary" | "supporting"
  readonly user: unknown
}

export const addArticleSource = async (payload: Payload, input: AddArticleSourceInput): Promise<number> => {
  const tenant = await assertEditionTenant(payload, input.editionId, input.user)
  const intakeItem = await payload.findByID({
    collection: "intake-items",
    id: input.intakeItemId,
    depth: 0,
    overrideAccess: true,
  })
  if (String(intakeItem.tenant) !== String(tenant)) throw fail("ARTICLE_SOURCE_TENANT_MISMATCH")

  const duplicate = await payload.find({
    collection: "article-sources",
    where: {
      and: [
        { edition: { equals: input.editionId } },
        { intakeItem: { equals: input.intakeItemId } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  if (duplicate.docs.length > 0) throw fail("ARTICLE_SOURCE_DUPLICATE")

  const created = await payload.create({
    collection: "article-sources",
    data: {
      edition: input.editionId,
      intakeItem: input.intakeItemId,
      ...(input.note === undefined ? {} : { note: input.note }),
      role: input.role,
      tenant,
    },
    depth: 0,
    overrideAccess: true,
  })
  return created.id
}

export const removeArticleSource = async (
  payload: Payload,
  sourceId: number,
  user: unknown,
): Promise<void> => {
  const source = await payload.findByID({
    collection: "article-sources",
    id: sourceId,
    depth: 0,
    overrideAccess: true,
  })
  const editionId = numberOf(source.edition)
  if (editionId === null) throw fail("ARTICLE_SOURCE_INVALID")
  await assertEditionTenant(payload, editionId, user)
  await payload.delete({ collection: "article-sources", id: sourceId, overrideAccess: true })
}
