import Link from "next/link"

import { CMS_ACTION, CMS_RESOURCE, type CmsResource } from "@/access/policy"
import { AlertTriangleIcon, CheckCircleIcon, SendIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { CreateArticleLink } from "@/console/components/CreateArticleLink"
import {
  ChartCard,
  type ChartSegment,
  DonutChart,
  RankedBars,
  TrendBars,
  type TrendPoint,
} from "@/console/components/charts"
import { PageHeader } from "@/console/components/PageHeader"
import { requireConsolePayloadContext } from "@/console/lib/payload.server"
import { canConsole } from "@/console/lib/session.server"

export const metadata = {
  title: "控制台 | Geo Foundry",
}

const WORKFLOW_STATES = [
  { color: "#94a3b8", key: "draft", label: "草稿" },
  { color: "#f59e0b", key: "generating", label: "生成中" },
  { color: "#6366f1", key: "review", label: "待审核" },
  { color: "#0ea5e9", key: "approved", label: "已通过" },
  { color: "#06b6d4", key: "compiled", label: "已编译" },
  { color: "#10b981", key: "published", label: "已发布" },
  { color: "#64748b", key: "archived", label: "已删除" },
] as const

const TREND_DAYS = 30

const utcDay = (instant: string): string => instant.slice(0, 10)

const emptyTrend = (): readonly TrendPoint[] => {
  const days: TrendPoint[] = []
  for (let offset = TREND_DAYS - 1; offset >= 0; offset -= 1) {
    days.push({
      date: new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10),
      value: 0,
    })
  }
  return days
}

const bucketByDay = (docs: readonly Record<string, unknown>[]): readonly TrendPoint[] => {
  const byDay = new Map<string, number>()
  for (const doc of docs) {
    const createdAt = doc["createdAt"]
    if (typeof createdAt !== "string") continue
    byDay.set(utcDay(createdAt), (byDay.get(utcDay(createdAt)) ?? 0) + 1)
  }
  return emptyTrend().map((point) => ({ ...point, value: byDay.get(point.date) ?? 0 }))
}

const restrictedNote = "当前角色无权读取"

const ConsoleDashboardPage = async () => {
  const context = await requireConsolePayloadContext()
  const { payload, session, user } = context
  const canRead = (resource: CmsResource) => canConsole(session, resource, CMS_ACTION.READ)

  const cutoff = new Date(Date.now() - (TREND_DAYS - 1) * 86_400_000).toISOString()

  const canReadEditions = canRead(CMS_RESOURCE.EDITIONS)
  const canReadIntake = canRead(CMS_RESOURCE.INTAKE_ITEMS)
  const canReadReleases = canRead(CMS_RESOURCE.RELEASES)
  const canReadOperations = canRead(CMS_RESOURCE.OPERATIONS)
  const canReadSites = canRead(CMS_RESOURCE.SITES)
  const canReadSnapshots = canRead(CMS_RESOURCE.PERFORMANCE_SNAPSHOTS)

  const [statusCounts, intakeDocs, releaseDocs, failedOperations, sites, snapshotDocs] =
    await Promise.all([
      canReadEditions
        ? Promise.all(
            WORKFLOW_STATES.map((state) =>
              payload
                .count({
                  collection: "content-editions",
                  overrideAccess: false,
                  user,
                  where: { workflowStatus: { equals: state.key } },
                })
                .then((result) => result.totalDocs ?? 0),
            ),
          )
        : null,
      canReadIntake
        ? payload
            .find({
              collection: "intake-items",
              depth: 0,
              limit: 1000,
              overrideAccess: false,
              pagination: false,
              select: { createdAt: true },
              sort: "-createdAt",
              user,
              where: { createdAt: { greater_than_equal: cutoff } },
            })
            .then((result) => result.docs as unknown as readonly Record<string, unknown>[])
        : null,
      canReadReleases
        ? payload
            .find({
              collection: "releases",
              depth: 0,
              limit: 1000,
              overrideAccess: false,
              pagination: false,
              select: { createdAt: true },
              sort: "-createdAt",
              user,
              where: { createdAt: { greater_than_equal: cutoff } },
            })
            .then((result) => result.docs as unknown as readonly Record<string, unknown>[])
        : null,
      canReadOperations
        ? payload
            .count({
              collection: "operations",
              overrideAccess: false,
              user,
              where: { state: { equals: "failed" } },
            })
            .then((result) => result.totalDocs ?? 0)
        : null,
      canReadSites
        ? payload
            .find({
              collection: "sites",
              depth: 0,
              limit: 12,
              overrideAccess: false,
              sort: "name",
              user,
            })
            .then((result) => result.docs as unknown as readonly Record<string, unknown>[])
        : null,
      canReadSnapshots
        ? payload
            .find({
              collection: "performance-snapshots",
              depth: 0,
              limit: 1000,
              overrideAccess: false,
              select: { observedAt: true, visits: true },
              sort: "-observedAt",
              user,
              where: { observedAt: { greater_than_equal: cutoff } },
            })
            .then((result) => result.docs as unknown as readonly Record<string, unknown>[])
        : null,
    ])

  const segments: readonly ChartSegment[] | null =
    statusCounts === null
      ? null
      : WORKFLOW_STATES.map((state, index) => ({
          color: state.color,
          label: state.label,
          value: statusCounts[index] ?? 0,
        }))

  const siteArticleItems = await (async () => {
    if (sites === null || !canReadEditions) return null
    return Promise.all(
      sites.map(async (site) => {
        const siteId = site["id"] as number
        const name =
          typeof site["name"] === "string" && site["name"].length > 0
            ? site["name"]
            : `站点 #${String(siteId)}`
        const result = await payload.count({
          collection: "content-editions",
          overrideAccess: false,
          user,
          where: { site: { equals: siteId } },
        })
        return { label: name, value: result.totalDocs ?? 0 }
      }),
    )
  })()

  const readingByDay = new Map<string, number>(
    emptyTrend().map((point) => [point.date, 0] as const),
  )
  for (const snapshot of snapshotDocs ?? []) {
    const observedAt = snapshot["observedAt"]
    const visits = typeof snapshot["visits"] === "number" ? snapshot["visits"] : 0
    if (typeof observedAt !== "string" || !readingByDay.has(observedAt.slice(0, 10))) continue
    const day = observedAt.slice(0, 10)
    readingByDay.set(day, (readingByDay.get(day) ?? 0) + visits)
  }
  const readingTrend: readonly TrendPoint[] = [...readingByDay.entries()].map(([date, value]) => ({
    date,
    value,
  }))

  const reviewCount = statusCounts === null ? null : (statusCounts[2] ?? 0)
  const publishReadyCount =
    statusCounts === null ? null : (statusCounts[3] ?? 0) + (statusCounts[4] ?? 0)
  const canCreateEdition = canConsole(session, CMS_RESOURCE.EDITIONS, CMS_ACTION.CREATE)

  const todoCards = [
    {
      href: "/admin/work",
      Icon: CheckCircleIcon,
      label: "待审核",
      tone: "text-indigo-600 bg-indigo-50 dark:bg-indigo-400/15 dark:text-indigo-300",
      value: reviewCount,
    },
    {
      href: "/admin/work",
      Icon: SendIcon,
      label: "待发布",
      tone: "text-sky-600 bg-sky-50 dark:bg-sky-400/15 dark:text-sky-300",
      value: publishReadyCount,
    },
    {
      href: "/admin/collections/operations",
      Icon: AlertTriangleIcon,
      label: "失败操作",
      tone: "text-rose-600 bg-rose-50 dark:bg-rose-400/15 dark:text-rose-300",
      value: failedOperations,
    },
  ] as const

  return (
    <div className="grid gap-7 [&>*]:min-w-0">
      <PageHeader
        actions={
          <>
            {canReadIntake && (
              <Button asChild className="rounded-xl" size="sm" type="button" variant="secondary">
                <Link href="/admin/inbox">采集 / 导入</Link>
              </Button>
            )}
            {canCreateEdition && <CreateArticleLink />}
          </>
        }
        meta={
          <span className="rounded-full border border-[var(--console-border)] bg-[var(--console-surface)] px-3 py-1 text-xs font-semibold text-[var(--console-ink-muted)]">
            {session.role}
            {session.tenantId === null
              ? ""
              : ` · ${session.tenantName ?? `租户 #${String(session.tenantId)}`}`}
          </span>
        }
        title="控制台"
      />

      <section className="grid gap-4 sm:grid-cols-3">
        {todoCards.map((card) => (
          <Link
            className="gf-console-card gf-console-focus group grid content-between gap-3 p-5 no-underline transition-transform hover:-translate-y-0.5"
            href={card.href}
            key={card.label}
          >
            <span className={`grid size-10 place-items-center rounded-xl ${card.tone}`}>
              <card.Icon size={20} />
            </span>
            <div>
              <strong className="block text-3xl font-semibold tracking-tight tabular-nums text-[var(--console-ink)]">
                {card.value === null ? "受限" : card.value}
              </strong>
              <span className="block pt-1 text-sm font-medium text-[var(--console-ink)]">
                {card.label}
              </span>
            </div>
          </Link>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
        <ChartCard title="文章状态分布">
          {segments === null ? (
            <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-[var(--console-border)]">
              <span className="text-sm text-[var(--console-ink-muted)]">{restrictedNote}</span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-6">
              <DonutChart segments={segments} />
              <ul className="m-0 grid min-w-40 flex-1 list-none gap-2 p-0">
                {segments.map((segment) => (
                  <li className="flex items-center gap-2.5 text-sm" key={segment.label}>
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: segment.color }}
                    />
                    <span className="min-w-0 flex-1 text-[var(--console-ink)]">
                      {segment.label}
                    </span>
                    <span className="font-semibold tabular-nums text-[var(--console-ink)]">
                      {segment.value}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </ChartCard>

        <ChartCard title="近 30 天稿源进入">
          {intakeDocs === null ? (
            <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-[var(--console-border)]">
              <span className="text-sm text-[var(--console-ink-muted)]">{restrictedNote}</span>
            </div>
          ) : (
            <TrendBars data={bucketByDay(intakeDocs)} emptyLabel="近 30 天暂无稿源进入" />
          )}
        </ChartCard>

        <ChartCard title="近 30 天发布趋势">
          {releaseDocs === null ? (
            <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-[var(--console-border)]">
              <span className="text-sm text-[var(--console-ink-muted)]">{restrictedNote}</span>
            </div>
          ) : (
            <TrendBars
              color="#10b981"
              data={bucketByDay(releaseDocs)}
              emptyLabel="近 30 天暂无发布"
            />
          )}
        </ChartCard>

        <ChartCard title="各站点文章数">
          {siteArticleItems === null ? (
            <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-[var(--console-border)]">
              <span className="text-sm text-[var(--console-ink-muted)]">{restrictedNote}</span>
            </div>
          ) : (
            <RankedBars emptyLabel="暂无站点" items={siteArticleItems} />
          )}
        </ChartCard>

        <ChartCard title="近 30 天阅读趋势">
          {snapshotDocs === null ? (
            <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-[var(--console-border)]">
              <span className="text-sm text-[var(--console-ink-muted)]">{restrictedNote}</span>
            </div>
          ) : (
            <TrendBars color="#f59e0b" data={readingTrend} emptyLabel="近 30 天暂无阅读数据" />
          )}
        </ChartCard>
      </section>
    </div>
  )
}

export default ConsoleDashboardPage
