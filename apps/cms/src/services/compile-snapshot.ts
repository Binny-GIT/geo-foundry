import type { CompileRequest, CompileSiteSnapshot } from "@geo/compiler"
import type { Payload } from "payload"

import {
  type Doc,
  deriveListings,
  deriveRoutes,
  idOf,
  mapEdition,
  textOf,
} from "./compile-snapshot-mappers"
import { EditionWorkflowError, requireServiceIdentity } from "./edition-workflow"

const fail = (code: string, detail: string): EditionWorkflowError =>
  new EditionWorkflowError(code, detail)

const COMPILABLE_STATUSES = ["approved", "compiled", "published"]

export type CompileSnapshotOptions = {
  readonly siteId: number
  readonly user: unknown
}

/**
 * Immutable site snapshot for the deterministic compiler: the site with its
 * canonical domain, every compilable edition with its active URL, latest
 * assessment, author, and taxonomy, plus single-hop redirects derived from
 * the URL registry. The worker injects clock and compilerVersion; everything
 * here is read-only ledger state.
 */
export async function buildCompileSnapshot(
  payload: Payload,
  options: CompileSnapshotOptions,
): Promise<Omit<CompileRequest, "clock" | "compilerVersion">> {
  const siteResult = await payload.find({
    collection: "sites",
    where: { id: { equals: options.siteId } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const site = siteResult.docs[0] as unknown as Doc | undefined
  if (site === undefined) {
    throw fail("COMPILE_SNAPSHOT_SITE_MISSING", `site ${options.siteId}`)
  }
  const claims = requireServiceIdentity(options.user)
  const siteTenant = idOf(site["tenant"])
  if (
    claims.tenantId === null ||
    siteTenant === null ||
    String(claims.tenantId) !== String(siteTenant)
  ) {
    throw fail("COMPILE_SNAPSHOT_TENANT_MISMATCH", `site ${options.siteId}`)
  }

  const domainResult = await payload.find({
    collection: "domains",
    where: {
      and: [
        { site: { equals: options.siteId } },
        { role: { equals: "canonical" } },
        { status: { equals: "active" } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const canonicalDomain = textOf((domainResult.docs[0] as unknown as Doc | undefined)?.["hostname"])
  if (canonicalDomain.length === 0) {
    throw fail("COMPILE_SNAPSHOT_CANONICAL_DOMAIN_MISSING", `site ${options.siteId}`)
  }

  const seoDefaultsRaw = (site["seoDefaults"] ?? {}) as Record<string, unknown>
  const siteName = textOf(site["name"])
  const siteKey = `site-${options.siteId}`
  const compileSite: CompileSiteSnapshot = {
    canonicalDomain,
    locale: textOf(site["locale"]) || "en-US",
    name: siteName,
    organization: { name: siteName },
    seoDefaults: {
      description: textOf(seoDefaultsRaw["defaultDescription"]) || `${siteName} content`,
      title: textOf(seoDefaultsRaw["titleSuffix"]) || siteName,
    },
    siteId: siteKey,
    timezone: textOf(site["timezone"]) || "UTC",
  }

  const editionResult = await payload.find({
    collection: "content-editions",
    draft: true,
    where: {
      and: [{ site: { equals: options.siteId } }, { workflowStatus: { in: COMPILABLE_STATUSES } }],
    },
    limit: 500,
    depth: 0,
    overrideAccess: true,
  })
  const editions = editionResult.docs as unknown as Doc[]

  const editionIds = editions
    .map((edition) => idOf(edition["id"]))
    .filter((id): id is number => id !== null)
  const latestAssessment = new Map<number, { state: string; inputHash: string }>()
  if (editionIds.length > 0) {
    const assessments = await payload.find({
      collection: "quality-assessments",
      where: { edition: { in: editionIds } },
      sort: "-createdAt",
      limit: editionIds.length * 4,
      depth: 0,
      overrideAccess: true,
    })
    for (const doc of assessments.docs as unknown as Doc[]) {
      const editionId = idOf(doc["edition"])
      if (editionId !== null && !latestAssessment.has(editionId)) {
        latestAssessment.set(editionId, {
          state: textOf(doc["state"]),
          inputHash: textOf(doc["inputHash"]),
        })
      }
    }
  }

  const urlResult = await payload.find({
    collection: "url-records",
    where: { site: { equals: options.siteId } },
    limit: 1000,
    depth: 1,
    overrideAccess: true,
  })
  const { activeUrlByContent, redirects } = deriveRoutes(urlResult.docs as unknown as Doc[])

  const topics: { categories: string[]; tags: string[] }[] = []
  const compileEditions = []
  for (const edition of editions) {
    const editionId = idOf(edition["id"])
    const contentId = idOf(edition["content"])
    if (editionId === null || contentId === null) {
      continue
    }
    const urlPathname = activeUrlByContent.get(contentId)
    if (urlPathname === undefined) {
      continue
    }
    const mapped = mapEdition({
      assessment: latestAssessment.get(editionId),
      authorId: `author-site-${options.siteId}`,
      authorName: `${siteName} Editorial Team`,
      canonicalDomain,
      edition,
      siteKey,
      urlPathname,
    })
    if (mapped === null) {
      continue
    }
    compileEditions.push(mapped)
    topics.push({ categories: [...mapped.categories], tags: [...mapped.tags] })
  }

  return {
    editions: compileEditions,
    listings: {
      articles: { pathname: "/articles", pageSize: 20 },
      ...deriveListings(topics),
    },
    notFound: { pathname: "/not-found" },
    redirects: [...redirects].sort((left, right) =>
      left.fromPathname.localeCompare(right.fromPathname),
    ),
    site: compileSite,
  }
}
