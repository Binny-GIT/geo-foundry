import { ChartBarIcon } from "@/components/icons"
import { ChartCard, RankedBars, TrendBars, type TrendPoint } from "@/console/components/charts"
import { PageHeader } from "@/console/components/PageHeader"
import { requireConsoleContext } from "@/console/lib/console-context.server"
import { apiUsageSince, listSiteOptions } from "@/server/repositories/console-reads"

export const metadata = { title: "接口统计 | Geo Foundry" }

const DAYS = 14

const emptyDays = (): readonly string[] => {
  const days: string[] = []
  for (let offset = DAYS - 1; offset >= 0; offset -= 1) {
    days.push(new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10))
  }
  return days
}

const ApiStatsPage = async () => {
  const context = await requireConsoleContext()
  const days = emptyDays()
  const cutoff = days[0] as string

  const [rows, sites] = await Promise.all([
    apiUsageSince(context.db, context.scope, cutoff).catch(
      () => [] as Awaited<ReturnType<typeof apiUsageSince>>,
    ),
    listSiteOptions(context.db, context.scope).catch(
      () => [] as Awaited<ReturnType<typeof listSiteOptions>>,
    ),
  ])

  const siteNames = new Map(sites.map((site) => [site.id, site.name] as const))

  const byDay = new Map<string, number>(days.map((day) => [day, 0] as const))
  const bySite = new Map<string, number>()
  let total = 0
  for (const row of rows) {
    total += row.count
    if (byDay.has(row.date)) byDay.set(row.date, (byDay.get(row.date) ?? 0) + row.count)
    const siteKey =
      row.siteId === null
        ? "未知站点"
        : (siteNames.get(row.siteId) ?? `站点 #${String(row.siteId)}`)
    bySite.set(siteKey, (bySite.get(siteKey) ?? 0) + row.count)
  }

  const trend: readonly TrendPoint[] = days.map((day) => ({
    date: day,
    value: byDay.get(day) ?? 0,
  }))
  const siteItems = [...bySite.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 10)

  return (
    <div className="grid gap-6 [&>*]:min-w-0">
      <PageHeader
        icon={ChartBarIcon}
        meta={
          <span className="rounded-full border border-[var(--console-border)] bg-[var(--console-surface)] px-3 py-1 text-xs font-semibold text-[var(--console-ink-muted)]">
            近 {DAYS} 天共 {total} 次调用
          </span>
        }
        title="接口统计"
      />

      <section className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="近 14 天调用量">
          <TrendBars data={trend} emptyLabel="近 14 天暂无接口调用" />
        </ChartCard>
        <ChartCard title="按站点分布">
          <RankedBars emptyLabel="暂无调用数据" items={siteItems} />
        </ChartCard>
      </section>
    </div>
  )
}

export default ApiStatsPage
