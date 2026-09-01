import {
  type ActiveUrlRoute,
  markUrlGone,
  parseContentId,
  parseSiteId,
  parseTenantId,
  parseUrlId,
  publishUrl,
  renameUrl,
  reserveUrl,
  retainActiveUrlForContentUpdate,
  type UrlRegistry,
} from "@geo/domain"
import {
  commitTransaction,
  createLocalReq,
  initTransaction,
  killTransaction,
  type Payload,
  type PayloadRequest,
} from "payload"

import type { TransactionScope } from "../outbox/outbox"
import { UrlRegistryError } from "./url-registry-errors"
import { buildSiteRegistry, toUrlRecordRow, type UrlRecordRow } from "./url-registry-snapshot"

const fail = (code: string, detail: string): UrlRegistryError => new UrlRegistryError(code, detail)

const txOf = (req: PayloadRequest): TransactionScope => {
  const transactionID = req.transactionID
  return transactionID === undefined ? {} : { transactionID }
}

const rowsOfSite = async (
  payload: Payload,
  siteId: number,
  req: TransactionScope,
): Promise<readonly UrlRecordRow[]> => {
  const found = await payload.find({
    collection: "url-records",
    where: { site: { equals: siteId } },
    limit: 1000,
    depth: 0,
    overrideAccess: true,
    req,
  })
  return found.docs.map((doc) =>
    toUrlRecordRow({
      canonicalUrl: doc.canonicalUrl,
      content: doc.content,
      id: doc.id,
      locale: doc.locale,
      pathname: doc.pathname,
      revision: doc.revision,
      site: doc.site,
      state: doc.state,
      statusCode: doc.statusCode,
      targetUrl: doc.targetUrl,
      tenant: doc.tenant,
    }),
  )
}

/**
 * Transaction-bound URL Registry service.
 *
 * Every lifecycle operation rebuilds the domain registry from persisted rows
 * inside one transaction, validates through the @geo/domain pure functions,
 * and persists the resulting rows atomically. Concurrent reservations are
 * arbitrated by the transaction plus the unique `uniqueKey` index: exactly
 * one winner commits.
 */
export const runUrlRegistryOperation = async <T>(
  payload: Payload,
  siteId: number,
  operation: (registry: UrlRegistry, req: TransactionScope) => Promise<T>,
  scope?: TransactionScope,
): Promise<T> => {
  if (scope !== undefined) {
    const rows = await rowsOfSite(payload, siteId, scope)
    return operation(buildSiteRegistry(rows), scope)
  }
  const req = await createLocalReq({}, payload)
  const ownsTransaction = await initTransaction(req)
  try {
    const transactionScope = txOf(req)
    const rows = await rowsOfSite(payload, siteId, transactionScope)
    const result = await operation(buildSiteRegistry(rows), transactionScope)
    if (ownsTransaction) {
      await commitTransaction(req)
    }
    return result
  } catch (error) {
    if (ownsTransaction) {
      await killTransaction(req)
    }
    throw error
  }
}

export type ReserveInput = {
  readonly siteId: number
  readonly tenantId: number
  readonly contentId: number
  readonly locale: string
  readonly pathname: string
}

export const reserveUrlRecord = async (
  payload: Payload,
  input: ReserveInput,
  scope?: TransactionScope,
): Promise<number> =>
  runUrlRegistryOperation(
    payload,
    input.siteId,
    async (registry, req) => {
      const parsedUrlId = parseUrlId(crypto.randomUUID())
      const siteId = parseSiteId(String(input.siteId))
      const tenantId = parseTenantId(String(input.tenantId))
      const contentId = parseContentId(String(input.contentId))
      if (!parsedUrlId.ok || !siteId.ok || !tenantId.ok || !contentId.ok) {
        throw fail("URL_REGISTRY_INPUT_INVALID", "site/tenant/content identity")
      }
      const result = reserveUrl(registry, {
        contentId: contentId.value,
        expectedRevision: registry.revision,
        locale: input.locale,
        ownership: { scope: "site", siteId: siteId.value, tenantId: tenantId.value },
        pathname: input.pathname,
        urlId: parsedUrlId.value,
      })
      if (!result.ok) {
        throw new UrlRegistryError(result.error.code, result.error.message)
      }
      const created = await payload.create({
        collection: "url-records",
        data: {
          site: input.siteId,
          tenant: input.tenantId,
          content: input.contentId,
          locale: result.value.reserved.locale.value,
          pathname: result.value.reserved.pathname.value,
          uniqueKey: result.value.reserved.key.value,
          state: "reserved",
          revision: 0,
        },
        depth: 0,
        overrideAccess: true,
        req,
      })
      return created.id
    },
    scope,
  )

const rowOfRecord = async (
  payload: Payload,
  recordId: number,
  scope: TransactionScope = {},
): Promise<UrlRecordRow> => {
  const doc = await payload.findByID({
    collection: "url-records",
    id: recordId,
    depth: 0,
    overrideAccess: true,
    req: scope,
  })
  return toUrlRecordRow({
    canonicalUrl: doc.canonicalUrl,
    content: doc.content,
    id: doc.id,
    locale: doc.locale,
    pathname: doc.pathname,
    revision: doc.revision,
    site: doc.site,
    state: doc.state,
    statusCode: doc.statusCode,
    targetUrl: doc.targetUrl,
    tenant: doc.tenant,
  })
}

export const activateUrlRecord = async (
  payload: Payload,
  recordId: number,
  hostname: string,
  scope?: TransactionScope,
): Promise<void> => {
  const row = await rowOfRecord(payload, recordId, scope)
  await runUrlRegistryOperation(
    payload,
    row.site,
    async (registry, req) => {
      const urlId = parseUrlId(String(recordId))
      if (!urlId.ok) {
        throw fail("URL_REGISTRY_INPUT_INVALID", "url identity")
      }
      const result = publishUrl(registry, {
        expectedRevision: registry.revision,
        hostname,
        urlId: urlId.value,
      })
      if (!result.ok) {
        throw new UrlRegistryError(result.error.code, result.error.message)
      }
      await payload.update({
        collection: "url-records",
        id: recordId,
        data: {
          canonicalUrl: result.value.active.canonicalUrl.value,
          state: "active",
          revision: row.revision + 1,
        },
        depth: 0,
        overrideAccess: true,
        req,
      })
    },
    scope,
  )
}

export const retainActiveUrl = async (
  payload: Payload,
  recordId: number,
): Promise<ActiveUrlRoute> => {
  const row = await rowOfRecord(payload, recordId)
  return runUrlRegistryOperation(payload, row.site, async (registry) => {
    const urlId = parseUrlId(String(recordId))
    if (!urlId.ok) {
      throw fail("URL_REGISTRY_INPUT_INVALID", "url identity")
    }
    const result = retainActiveUrlForContentUpdate(registry, { urlId: urlId.value })
    if (!result.ok) {
      throw new UrlRegistryError(result.error.code, result.error.message)
    }
    return result.value
  })
}

export type RenameInput = {
  readonly recordId: number
  readonly locale: string
  readonly pathname: string
}

export const renameUrlRecord = async (
  payload: Payload,
  input: RenameInput,
): Promise<{ readonly redirectId: number; readonly activeId: number }> => {
  const row = await rowOfRecord(payload, input.recordId)
  return runUrlRegistryOperation(payload, row.site, async (registry, req) => {
    const sourceUrlId = parseUrlId(String(input.recordId))
    const targetUrlId = parseUrlId(crypto.randomUUID())
    const siteId = parseSiteId(String(row.site))
    const tenantId = parseTenantId(String(row.tenant))
    if (!sourceUrlId.ok || !targetUrlId.ok || !siteId.ok || !tenantId.ok) {
      throw fail("URL_REGISTRY_INPUT_INVALID", "rename identity")
    }
    const hostnameOfRow = (() => {
      const canonicalUrl = row.canonicalUrl
      if (canonicalUrl === null || !URL.canParse(canonicalUrl)) {
        return null
      }
      return new URL(canonicalUrl).hostname
    })()
    if (hostnameOfRow === null) {
      throw fail("URL_RECORD_ROW_INVALID", `record ${input.recordId} canonical url`)
    }
    const result = renameUrl(registry, {
      expectedRevision: registry.revision,
      hostname: hostnameOfRow,
      locale: input.locale,
      pathname: input.pathname,
      sourceUrlId: sourceUrlId.value,
      targetOwnership: {
        scope: "site",
        siteId: siteId.value,
        tenantId: tenantId.value,
      },
      targetUrlId: targetUrlId.value,
    })
    if (!result.ok) {
      throw new UrlRegistryError(result.error.code, result.error.message)
    }
    const active = await payload.create({
      collection: "url-records",
      data: {
        site: row.site,
        tenant: row.tenant,
        content: row.content,
        locale: result.value.active.locale.value,
        pathname: result.value.active.pathname.value,
        uniqueKey: result.value.active.key.value,
        state: "active",
        canonicalUrl: result.value.active.canonicalUrl.value,
        revision: 0,
      },
      depth: 0,
      overrideAccess: true,
      req,
    })
    await payload.update({
      collection: "url-records",
      id: input.recordId,
      data: {
        state: "redirected",
        statusCode: 301,
        targetUrl: active.id,
        revision: row.revision + 1,
      },
      depth: 0,
      overrideAccess: true,
      req,
    })
    return { activeId: active.id, redirectId: input.recordId }
  })
}

export const markUrlRecordGone = async (payload: Payload, recordId: number): Promise<void> => {
  const row = await rowOfRecord(payload, recordId)
  await runUrlRegistryOperation(payload, row.site, async (registry, req) => {
    const urlId = parseUrlId(String(recordId))
    if (!urlId.ok) {
      throw fail("URL_REGISTRY_INPUT_INVALID", "url identity")
    }
    const result = markUrlGone(registry, {
      expectedRevision: registry.revision,
      urlId: urlId.value,
    })
    if (!result.ok) {
      throw new UrlRegistryError(result.error.code, result.error.message)
    }
    await payload.update({
      collection: "url-records",
      id: recordId,
      data: { state: "gone", revision: row.revision + 1 },
      depth: 0,
      overrideAccess: true,
      req,
    })
  })
}

export const sitemapEligibleUrls = async (
  payload: Payload,
  siteId: number,
): Promise<
  readonly { readonly pathname: string; readonly locale: string; readonly canonicalUrl: string }[]
> => {
  const rows = await rowsOfSite(payload, siteId, {})
  return rows
    .filter((row) => row.state === "active" && row.canonicalUrl !== null)
    .map((row) => ({
      canonicalUrl: row.canonicalUrl as string,
      locale: row.locale,
      pathname: row.pathname,
    }))
}
