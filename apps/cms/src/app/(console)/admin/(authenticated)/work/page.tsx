import Link from "next/link"

import { CMS_ACTION, CMS_RESOURCE } from "@/access/policy"
import { AlertTriangleIcon } from "@/components/icons"
import ReviewBoard, { type IntakeStripItem } from "@/console/components/ReviewBoard"
import {
  PerformanceSuggestions,
  type PerformanceSuggestion,
} from "@/console/components/PerformanceSuggestions"
import { groupBoardCards } from "@/console/lib/board-model"
import { consoleRoute } from "@/console/lib/resources"
import { requireConsolePayloadContext } from "@/console/lib/payload.server"
import { canConsole } from "@/console/lib/session.server"
import { performanceSuggestions } from "@/services/performance-snapshots"

export const metadata = { title: "工作台 | Geo Foundry" }

const WorkbenchPage = async () => {
  const context = await requireConsolePayloadContext()
  const { payload, session, user } = context
  const role = session.role
  const canReadIntake = canConsole(session, CMS_RESOURCE.INTAKE_ITEMS, CMS_ACTION.READ)
  const canManageIntake = canConsole(session, CMS_RESOURCE.INTAKE_ITEMS, CMS_ACTION.UPDATE)
  const canCreateEdition = canConsole(session, CMS_RESOURCE.EDITIONS, CMS_ACTION.CREATE)
  const canReadOperations = canConsole(session, CMS_RESOURCE.OPERATIONS, CMS_ACTION.READ)

  const [editions, intakeItems, failedCount, rawSuggestions] = await Promise.all([
    payload
      .find({
        collection: "content-editions",
        depth: 1,
        draft: true,
        limit: 200,
        overrideAccess: false,
        sort: "-updatedAt",
        user,
      })
      .then((result) => result.docs as unknown as readonly Record<string, unknown>[])
      .catch(() => [] as readonly Record<string, unknown>[]),
    canReadIntake
      ? payload
          .find({
            collection: "intake-items",
            depth: 0,
            limit: 20,
            overrideAccess: false,
            sort: "-receivedAt",
            user,
            where: { status: { equals: "ready" } },
          })
          .then((result) =>
            (result.docs as unknown as readonly Record<string, unknown>[]).flatMap((item) => {
              const id = item["id"]
              const title = item["title"]
              const channel = item["channel"]
              return typeof id === "number" &&
                typeof title === "string" &&
                typeof channel === "string"
                ? [{ channel, id, title }]
                : []
            }),
          )
          .catch(() => [] as readonly IntakeStripItem[])
      : Promise.resolve([] as readonly IntakeStripItem[]),
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
    <div className="grid gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-indigo-600">运营</p>
          <h1 className="m-0 pt-1 text-3xl font-semibold tracking-tight text-[var(--console-ink)]">
            工作台
          </h1>
          <p className="m-0 max-w-2xl pt-2 text-sm leading-6 text-[var(--console-ink-muted)]">
            按状态分列的评审看板：新稿源进入后，沿 草稿 → 待审核 → 通过 → 已发布 流转；所有操作走受保护的工作流端点并写入审计。
          </p>
        </div>
        {failedCount > 0 && (
          <Link
            className="gf-console-focus inline-flex h-10 items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 text-sm font-semibold text-rose-700 no-underline hover:bg-rose-100"
            href={consoleRoute.collection("operations")}
          >
            <AlertTriangleIcon size={16} />
            {failedCount} 个失败操作
          </Link>
        )}
      </header>

      {suggestions.length > 0 && <PerformanceSuggestions suggestions={suggestions} />}

      <ReviewBoard
        board={groupBoardCards(editions)}
        canCreateEdition={canCreateEdition}
        canManageIntake={canManageIntake}
        canReadInbox={canReadIntake}
        intakeItems={intakeItems}
        role={role}
      />
    </div>
  )
}

export default WorkbenchPage
