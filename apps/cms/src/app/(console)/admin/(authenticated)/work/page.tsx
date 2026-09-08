import { CMS_ACTION, CMS_RESOURCE } from "@/access/policy"
import ReviewBoard from "@/console/components/ReviewBoard"
import { WorkToolbar } from "@/console/components/WorkToolbar"
import { groupBoardCards } from "@/console/lib/board-model"
import { requireConsoleContext } from "@/console/lib/console-context.server"
import { canConsole } from "@/console/lib/session.server"
import { parseWorkQuery, workDateRange } from "@/console/lib/work-filters"
import {
  failedOperationsCount,
  listOwnerOptions,
  listSiteOptions,
  workBoardEditions,
} from "@/server/repositories/console-reads"

export const metadata = { title: "工作台 | Geo Foundry" }

/*
 * The board groups a flat query result into six workflow-status columns
 * (see groupBoardCards), so this is a scope cap, not a page — there is no
 * per-column pagination and none is exposed in the UI. It only surfaces
 * as a truncation notice (below) on the rare filter that matches more
 * than this many editions; narrowing the date range/site/owner filters
 * is the intended way to see the rest.
 */
const WORK_QUERY_LIMIT = 300

type WorkbenchPageProps = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>
}

type OwnerOption = Readonly<{ readonly email: string; readonly id: number }>
type SiteOption = Readonly<{ readonly id: number; readonly name: string }>

const WorkbenchPage = async ({ searchParams }: WorkbenchPageProps) => {
  const query = parseWorkQuery(await searchParams)
  const context = await requireConsoleContext()
  const { session } = context
  const role = session.role
  const canCreateEdition = canConsole(session, CMS_RESOURCE.EDITIONS, CMS_ACTION.CREATE)
  const canReadOperations = canConsole(session, CMS_RESOURCE.OPERATIONS, CMS_ACTION.READ)
  const range = workDateRange(query)

  const [editionResult, failedCount, ownerRows, siteRows] = await Promise.all([
    workBoardEditions(
      context.db,
      context.scope,
      {
        from: range.from,
        owner: query.owner,
        q: query.q,
        site: query.site,
        siteScope: context.siteIds,
        toExclusive: range.toExclusive,
      },
      WORK_QUERY_LIMIT,
    ).catch(() => ({ docs: [] as readonly Record<string, unknown>[], totalDocs: 0 })),
    canReadOperations
      ? failedOperationsCount(context.db, context.scope).catch(() => 0)
      : Promise.resolve(0),
    listOwnerOptions(context.db, context.scope).catch(() => []),
    listSiteOptions(context.db, context.scope).catch(() => []),
  ])

  const editions = editionResult.docs
  const totalDocs = editionResult.totalDocs
  const hiddenCount = totalDocs - editions.length
  const owners: readonly OwnerOption[] = ownerRows.map((row) => ({ email: row.email, id: row.id }))
  const sites: readonly SiteOption[] = siteRows.map((row) => ({ id: row.id, name: row.name }))

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 [&>*]:min-w-0">
      <WorkToolbar
        canCreate={canCreateEdition}
        failedCount={failedCount}
        owners={owners}
        query={query}
        sites={sites}
      />

      <ReviewBoard board={groupBoardCards(editions)} role={role} showColumns={query.showColumns} />

      {hiddenCount > 0 && (
        <p className="m-0 shrink-0 border-t border-[var(--console-border)] pt-3 text-sm text-[var(--console-ink-muted)]">
          当前筛选下共 {totalDocs} 条，仅展示最近更新的 {editions.length}{" "}
          条；请缩小时间范围或使用筛选查看其余 {hiddenCount} 条。
        </p>
      )}
    </div>
  )
}

export default WorkbenchPage
