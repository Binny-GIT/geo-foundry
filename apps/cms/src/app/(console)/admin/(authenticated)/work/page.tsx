import Link from "next/link"

import { CMS_ACTION, CMS_RESOURCE } from "@/access/policy"
import { AlertTriangleIcon } from "@/components/icons"
import ReviewBoard from "@/console/components/ReviewBoard"
import { CreateArticleLink } from "@/console/components/CreateArticleLink"
import { PageHeader } from "@/console/components/PageHeader"
import {
  PerformanceSuggestions,
  type PerformanceSuggestion,
} from "@/console/components/PerformanceSuggestions"
import { groupBoardCards } from "@/console/lib/board-model"
import { consoleRoute } from "@/console/lib/resources"
import { siteScopeWhere } from "@/console/lib/site-scope"
import { requireConsolePayloadContext } from "@/console/lib/payload.server"
import { canConsole } from "@/console/lib/session.server"
import { performanceSuggestions } from "@/services/performance-snapshots"

export const metadata = { title: "工作台 | Geo Foundry" }

const WorkbenchPage = async () => {
  const context = await requireConsolePayloadContext()
  const { payload, session, user } = context
  const role = session.role
  const canCreateEdition = canConsole(session, CMS_RESOURCE.EDITIONS, CMS_ACTION.CREATE)
  const canReadOperations = canConsole(session, CMS_RESOURCE.OPERATIONS, CMS_ACTION.READ)
  const scopeWhere = siteScopeWhere(context.session)

  const [editions, failedCount, rawSuggestions] = await Promise.all([
    payload
      .find({
        collection: "content-editions",
        depth: 1,
        draft: true,
        limit: 200,
        overrideAccess: false,
        sort: "-updatedAt",
        user,
        ...(scopeWhere === undefined ? {} : { where: scopeWhere }),
      })
      .then((result) => result.docs as unknown as readonly Record<string, unknown>[])
      .catch(() => [] as readonly Record<string, unknown>[]),
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
  ])

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
    <div className="grid gap-6 [&>*]:min-w-0">
      <PageHeader
        actions={
          <>
            {failedCount > 0 && (
              <Link
                className="gf-console-focus inline-flex h-9 items-center gap-2 rounded-xl border border-rose-300 bg-rose-100 px-3 text-sm font-bold text-rose-800 no-underline hover:bg-rose-200"
                href={consoleRoute.collection("operations")}
              >
                <AlertTriangleIcon size={15} />
                {failedCount} 个失败操作
              </Link>
            )}
            {canCreateEdition && <CreateArticleLink />}
          </>
        }
        title="工作台"
      />

      {suggestions.length > 0 && <PerformanceSuggestions suggestions={suggestions} />}

      <ReviewBoard board={groupBoardCards(editions)} role={role} />
    </div>
  )
}

export default WorkbenchPage
