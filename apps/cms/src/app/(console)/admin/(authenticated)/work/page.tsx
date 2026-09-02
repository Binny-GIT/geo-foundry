import Link from "next/link"

import { CMS_ACTION, CMS_RESOURCE } from "@/access/policy"
import { Button } from "@/components/ui/button"
import {
  type PerformanceSuggestion,
  PerformanceSuggestions,
} from "@/console/components/PerformanceSuggestions"
import ReviewBoard from "@/console/components/ReviewBoard"
import { WorkToolbar } from "@/console/components/WorkToolbar"
import { groupBoardCards } from "@/console/lib/board-model"
import { requireConsolePayloadContext } from "@/console/lib/payload.server"
import { consoleRoute } from "@/console/lib/resources"
import { canConsole } from "@/console/lib/session.server"
import { siteScopeWhere } from "@/console/lib/site-scope"
import { parseWorkQuery, scopedWorkWhere, workHref } from "@/console/lib/work-filters"
import { performanceSuggestions } from "@/services/performance-snapshots"

export const metadata = { title: "工作台 | Geo Foundry" }

const WORK_PAGE_SIZE = 60

type WorkbenchPageProps = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>
}

type OwnerOption = Readonly<{ readonly email: string; readonly id: number }>
type SiteOption = Readonly<{ readonly id: number; readonly name: string }>

const WorkbenchPage = async ({ searchParams }: WorkbenchPageProps) => {
  const query = parseWorkQuery(await searchParams)
  const context = await requireConsolePayloadContext()
  const { payload, session, user } = context
  const role = session.role
  const canCreateEdition = canConsole(session, CMS_RESOURCE.EDITIONS, CMS_ACTION.CREATE)
  const canReadOperations = canConsole(session, CMS_RESOURCE.OPERATIONS, CMS_ACTION.READ)
  const editionsWhere = scopedWorkWhere(query, siteScopeWhere(context.session))

  const [editionResult, failedCount, rawSuggestions, ownerDocs, siteDocs] = await Promise.all([
    payload
      .find({
        collection: "content-editions",
        depth: 1,
        draft: true,
        limit: WORK_PAGE_SIZE,
        overrideAccess: false,
        page: query.page,
        sort: "-updatedAt",
        user,
        ...(editionsWhere === undefined ? {} : { where: editionsWhere }),
      })
      .catch(() => ({ docs: [], page: 1, totalDocs: 0, totalPages: 1 })),
    canReadOperations
      ? payload
          .count({
            collection: "operations",
            overrideAccess: false,
            user,
            where: { state: { equals: "failed" } },
          })
          .then((result) => result.totalDocs ?? 0)
          .catch(() => 0)
      : Promise.resolve(0),
    role === "editor" || role === "tenant-admin"
      ? performanceSuggestions(payload, user).catch(() => [])
      : Promise.resolve([]),
    payload
      .find({
        collection: "users",
        depth: 0,
        limit: 100,
        overrideAccess: false,
        sort: "email",
        user,
      })
      .then((result) => result.docs as unknown as readonly Record<string, unknown>[])
      .catch(() => [] as readonly Record<string, unknown>[]),
    payload
      .find({
        collection: "sites",
        depth: 0,
        limit: 100,
        overrideAccess: false,
        sort: "name",
        user,
      })
      .then((result) => result.docs as unknown as readonly Record<string, unknown>[])
      .catch(() => [] as readonly Record<string, unknown>[]),
  ])

  const editions = editionResult.docs as unknown as readonly Record<string, unknown>[]
  const currentPage = editionResult.page ?? query.page
  const totalDocs = editionResult.totalDocs ?? 0
  const totalPages = editionResult.totalPages ?? 1

  const owners: readonly OwnerOption[] = ownerDocs.flatMap((doc) => {
    const id = doc["id"]
    const email = doc["email"]
    return typeof id === "number" && typeof email === "string" ? [{ email, id }] : []
  })
  const sites: readonly SiteOption[] = siteDocs.flatMap((doc) => {
    const id = doc["id"]
    const name = doc["name"]
    return typeof id === "number" && typeof name === "string" ? [{ id, name }] : []
  })

  const suggestionEditions =
    rawSuggestions.length > 0
      ? await payload
          .find({
            collection: "content-editions",
            depth: 1,
            limit: 20,
            overrideAccess: false,
            user,
            where: { id: { in: rawSuggestions.map((suggestion) => suggestion.editionId) } },
          })
          .then((result) => result.docs as unknown as readonly Record<string, unknown>[])
          .catch(() => [] as readonly Record<string, unknown>[])
      : []

  const editionLabel = (
    edition: Record<string, unknown>,
  ): { id: number; site: string; title: string } | null => {
    const id = edition["id"]
    if (typeof id !== "number") return null
    const siteRecord = edition["site"]
    const siteName =
      typeof siteRecord === "object" &&
      siteRecord !== null &&
      typeof (siteRecord as Record<string, unknown>)["name"] === "string"
        ? String((siteRecord as Record<string, unknown>)["name"])
        : "受限站点"
    const title = edition["title"]
    return {
      id,
      site: siteName,
      title: typeof title === "string" && title.length > 0 ? title : "未命名稿件",
    }
  }

  const editionsById = new Map(
    suggestionEditions.flatMap((edition) => {
      const labeled = editionLabel(edition)
      return labeled === null ? [] : ([[labeled.id, labeled] as const] as const)
    }),
  )

  const suggestions: readonly PerformanceSuggestion[] = rawSuggestions.flatMap((suggestion) => {
    const edition = editionsById.get(suggestion.editionId)
    if (edition === undefined) return []
    return [
      {
        current: suggestion.visits.current,
        editionId: suggestion.editionId,
        href: consoleRoute.document("content-editions", String(suggestion.editionId)),
        previous: suggestion.visits.previous,
        site: edition.site,
        title: edition.title,
      },
    ]
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 [&>*]:min-w-0">
      <WorkToolbar
        canCreate={canCreateEdition}
        failedCount={failedCount}
        owners={owners}
        query={query}
        sites={sites}
      />

      {suggestions.length > 0 && <PerformanceSuggestions suggestions={suggestions} />}

      <ReviewBoard board={groupBoardCards(editions)} role={role} showColumns={query.showColumns} />

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[var(--console-border)] pt-3 text-sm text-[var(--console-ink-muted)]">
        <span>
          当前条件下 {totalDocs} 条 · 第 {currentPage} / {totalPages} 页
        </span>
        <div className="flex items-center gap-2">
          {currentPage <= 1 ? (
            <Button disabled size="sm" type="button" variant="secondary">
              上一页
            </Button>
          ) : (
            <Button asChild size="sm" type="button" variant="secondary">
              <Link href={workHref(query, { page: currentPage - 1 })}>上一页</Link>
            </Button>
          )}
          {currentPage >= totalPages ? (
            <Button disabled size="sm" type="button" variant="secondary">
              下一页
            </Button>
          ) : (
            <Button asChild size="sm" type="button" variant="secondary">
              <Link href={workHref(query, { page: currentPage + 1 })}>下一页</Link>
            </Button>
          )}
        </div>
      </footer>
    </div>
  )
}

export default WorkbenchPage
