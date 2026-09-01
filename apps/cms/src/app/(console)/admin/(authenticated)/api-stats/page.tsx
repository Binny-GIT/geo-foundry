import { PageHeader } from "@/console/components/PageHeader"
import { ChartBarIcon } from "@/components/icons"
import { ChartCard, RankedBars, TrendBars, type TrendPoint } from "@/console/components/charts"
import { requireConsolePayloadContext } from "@/console/lib/payload.server"

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
  const context = await requireConsolePayloadContext()
  const { payload, user } = context
  const days = emptyDays()
  const cutoff = days[0] as string

  const [rows, sites] = await Promise.all([
    payload
      .find({
        collection: "api-usage-dailies",
        depth: 0,
        limit: 500,
        overrideAccess: false,
        sort: "-date",
        user,
        where: { date: { greater_than_equal: cutoff } },
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

  const siteNames = new Map(
    sites.flatMap((site) => {
      const id = site["id"]
      const name = site["name"]
      return typeof id === "number" && typeof name === "string" ? ([[id, name] as const] as const) : []
    }),
  )

  const byDay = new Map<string, number>(days.map((day) => [day, 0] as const))
  const bySite = new Map<string, number>()
  let total = 0
  for (const row of rows) {
    const date = row["date"]
    const count = typeof row["count"] === "number" ? row["count"] : 0
    total += count
    if (typeof date === "string" && byDay.has(date)) {
      byDay.set(date, (byDay.get(date) ?? 0) + count)
    }
    const siteId = row["siteId"]
    const siteKey = typeof siteId === "number" ? (siteNames.get(siteId) ?? `站点 #${String(siteId)}`) : "未知站点"
    bySite.set(siteKey, (bySite.get(siteKey) ?? 0) + count)
  }

  const trend: readonly TrendPoint[] = days.map((day) => ({ date: day, value: byDay.get(day) ?? 0 }))
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
