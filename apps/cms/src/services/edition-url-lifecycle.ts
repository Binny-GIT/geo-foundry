import type { Payload } from "payload"

import type { TransactionScope } from "../outbox/outbox"
import { slugify } from "./compile-snapshot-mappers"
import { activateUrlRecord, reserveUrlRecord } from "./url-registry"

type Row = Record<string, unknown>

const record = (value: unknown): Row =>
  typeof value === "object" && value !== null ? (value as Row) : {}

const idOf = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value
  if (typeof value === "object" && value !== null) return idOf(record(value)["id"])
  return null
}

const pathnameOf = (title: string, contentId: number): string => {
  const slug = slugify(title)
  return `/articles/${slug.length > 0 ? slug : `content-${contentId}`}`
}

/** Reserves one stable URL per content and site before the edition can be approved. */
export const reserveEditionUrl = async (
  payload: Payload,
  edition: unknown,
  scope?: TransactionScope,
): Promise<number> => {
  const row = record(edition)
  const contentId = idOf(row["content"])
  const siteId = idOf(row["site"])
  const tenantId = idOf(row["tenant"])
  if (contentId === null || siteId === null || tenantId === null) {
    throw new Error("EDITION_URL_IDENTITY_INVALID")
  }
  const existing = await payload.find({
    collection: "url-records",
    depth: 0,
    limit: 1,
    overrideAccess: true,
    ...(scope === undefined ? {} : { req: scope }),
    where: {
      and: [
        { content: { equals: contentId } },
        { site: { equals: siteId } },
        { state: { in: ["active", "reserved"] } },
      ],
    },
  })
  const current = existing.docs[0]
  if (current !== undefined) return current.id
  const site = await payload.findByID({
    collection: "sites",
    depth: 0,
    id: siteId,
    overrideAccess: true,
    ...(scope === undefined ? {} : { req: scope }),
  })
  const locale = typeof site.locale === "string" && site.locale.length > 0 ? site.locale : "en-US"
  const title = typeof row["title"] === "string" ? row["title"] : ""
  return reserveUrlRecord(
    payload,
    {
      contentId,
      locale,
      pathname: pathnameOf(title, contentId),
      siteId,
      tenantId,
    },
    scope,
  )
}

/** Activates the pre-reserved URL only after a verified publish receipt succeeds. */
export const activatePublishedEditionUrl = async (
  payload: Payload,
  editionId: number,
  siteId: number,
  scope?: TransactionScope,
): Promise<void> => {
  const edition = await payload.findByID({
    collection: "content-editions",
    depth: 0,
    id: editionId,
    overrideAccess: true,
    ...(scope === undefined ? {} : { req: scope }),
  })
  const contentId = idOf(edition.content)
  if (contentId === null) return
  const reserved = await payload.find({
    collection: "url-records",
    depth: 0,
    limit: 1,
    overrideAccess: true,
    ...(scope === undefined ? {} : { req: scope }),
    where: {
      and: [
        { content: { equals: contentId } },
        { site: { equals: siteId } },
        { state: { equals: "reserved" } },
      ],
    },
  })
  const url = reserved.docs[0]
  if (url === undefined) return
  const domain = await payload.find({
    collection: "domains",
    depth: 0,
    limit: 1,
    overrideAccess: true,
    ...(scope === undefined ? {} : { req: scope }),
    where: {
      and: [
        { site: { equals: siteId } },
        { role: { equals: "canonical" } },
        { status: { equals: "active" } },
      ],
    },
  })
  const hostname = typeof domain.docs[0]?.hostname === "string" ? domain.docs[0].hostname : ""
  if (hostname.length === 0) throw new Error("EDITION_URL_CANONICAL_DOMAIN_MISSING")
  await activateUrlRecord(payload, url.id, hostname, scope)
}
