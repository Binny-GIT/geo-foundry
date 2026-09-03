import Link from "next/link"

import { Button } from "@/components/ui/button"
import type { requireConsolePayloadContext } from "@/console/lib/payload.server"
import { consoleRoute } from "@/console/lib/resources"

type PlanRecord = Readonly<Record<string, unknown>>

type PublicationPlansWorkspaceProps = {
  readonly context: Awaited<ReturnType<typeof requireConsolePayloadContext>>
  readonly view: "day" | "week"
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}

const text = (value: unknown): string =>
  typeof value === "string" && value.length > 0 ? value : ""

const relationName = (value: unknown): string => {
  const row = record(value)
  return text(row["title"]) || text(row["name"]) || "受限"
}

const utcDayKey = (instant: string): string => instant.slice(0, 10)

const utcWeekKey = (instant: string): string => {
  const date = new Date(instant)
  const weekday = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - weekday)
  return date.toISOString().slice(0, 10)
}

const dayLabel = (key: string): string =>
  new Intl.DateTimeFormat("zh-CN", {
    day: "numeric",
    month: "long",
    weekday: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${key}T00:00:00.000Z`))

const weekLabel = (key: string): string => `${dayLabel(key)} 起的一周`

const timeLabel = (instant: string): string =>
  new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(instant))

const STATUS_TONE: Readonly<Record<string, string>> = {
  cancelled: "bg-slate-100 text-slate-600 dark:bg-slate-400/15 dark:text-slate-300",
  failed: "bg-rose-50 text-rose-700 dark:bg-rose-400/15 dark:text-rose-300",
  pending: "bg-indigo-50 text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-300",
  running: "bg-amber-50 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300",
  succeeded: "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300",
}

const PlanRow = ({ plan }: { readonly plan: PlanRecord }) => {
  const id = typeof plan["id"] === "number" ? plan["id"] : null
  const scheduledFor = text(plan["scheduledFor"])
  const status = text(plan["status"]) || "pending"
  const edition = plan["edition"]
  const lastError = text(plan["lastError"])
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5">
      <span className="w-14 shrink-0 font-mono text-sm font-semibold text-[var(--console-ink)]">
        {scheduledFor.length > 0 ? `${timeLabel(scheduledFor)} UTC` : "—"}
      </span>
      {id === null ? (
        <span className="min-w-0 flex-1 truncate text-sm text-[var(--console-ink)]">
          {relationName(edition)}
        </span>
      ) : (
        <Link
          className="gf-console-focus min-w-0 flex-1 truncate text-sm font-semibold text-[var(--console-ink)] no-underline hover:text-[var(--console-accent)]"
          href={consoleRoute.document("content-editions", String(record(edition)["id"] ?? id))}
        >
          {relationName(edition)}
        </Link>
      )}
      <span className="min-w-0 truncate text-xs text-[var(--console-ink-muted)]">
        {relationName(plan["site"])}
      </span>
      <span className="shrink-0 text-xs text-[var(--console-ink-muted)]">
        {text(plan["timezone"]) || "UTC"}
      </span>
      <span
        className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${STATUS_TONE[status] ?? STATUS_TONE["pending"]}`}
      >
        {status}
      </span>
      {lastError.length > 0 && (
        <span
          className="w-full truncate pt-1 text-xs text-rose-600 dark:text-rose-300"
          title={lastError}
        >
          {lastError}
        </span>
      )}
    </li>
  )
}

export const PublicationPlansWorkspace = async ({
  context,
  view,
}: PublicationPlansWorkspaceProps) => {
  const payload = context.payload
  const user = context.user
  const [active, terminal] = await Promise.all([
    payload.find({
      collection: "publication-plans",
      depth: 1,
      limit: 100,
      overrideAccess: false,
      sort: "scheduledFor",
      user,
      where: { or: [{ status: { equals: "pending" } }, { status: { equals: "running" } }] },
    }),
    payload.find({
      collection: "publication-plans",
      depth: 1,
      limit: 10,
      overrideAccess: false,
      sort: "-updatedAt",
      user,
      where: {
        or: [
          { status: { equals: "succeeded" } },
          { status: { equals: "failed" } },
          { status: { equals: "cancelled" } },
        ],
      },
    }),
  ])

  const groups = new Map<string, PlanRecord[]>()
  for (const doc of active.docs as unknown as PlanRecord[]) {
    const scheduledFor = text(doc["scheduledFor"])
    if (scheduledFor.length === 0) continue
    const key = view === "week" ? utcWeekKey(scheduledFor) : utcDayKey(scheduledFor)
    const bucket = groups.get(key) ?? []
    bucket.push(doc)
    groups.set(key, bucket)
  }
  const sortedGroups = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))

  return (
    <div className="grid gap-5">
      <section className="gf-console-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[var(--console-border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="m-0 text-sm font-semibold text-[var(--console-ink)]">
              排期列表（按{view === "week" ? "周" : "日"}分组，UTC）
            </h2>
            <p className="m-0 pt-1 text-xs text-[var(--console-ink-muted)]">
              待执行与执行中的发布计划；创建排期请在稿件工作台右侧由 publisher 提交。
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              asChild
              size="sm"
              type="button"
              variant={view === "day" ? "default" : "secondary"}
            >
              <Link href={`${consoleRoute.collection("publication-plans")}?view=day`}>按日</Link>
            </Button>
            <Button
              asChild
              size="sm"
              type="button"
              variant={view === "week" ? "default" : "secondary"}
            >
              <Link href={`${consoleRoute.collection("publication-plans")}?view=week`}>按周</Link>
            </Button>
          </div>
        </div>
        {sortedGroups.length === 0 ? (
          <div className="grid min-h-48 place-items-center px-5 text-center">
            <div className="grid max-w-sm gap-2">
              <strong className="text-sm text-[var(--console-ink)]">
                当前范围内没有待执行的发布计划
              </strong>
              <span className="text-sm leading-6 text-[var(--console-ink-muted)]">
                在稿件工作台右侧「创建发布排期」提交后，计划会按 UTC 时间出现在这里。
              </span>
            </div>
          </div>
        ) : (
          <div className="grid">
            {sortedGroups.map(([key, plans]) => (
              <section key={key}>
                <h3 className="m-0 border-y border-[var(--console-border)] bg-[var(--console-surface-muted)] px-5 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--console-ink-muted)] first:border-t-0">
                  {view === "week" ? weekLabel(key) : dayLabel(key)}
                </h3>
                <ul className="m-0 list-none divide-y divide-[var(--console-border)] p-0">
                  {plans.map((plan) => (
                    <PlanRow key={String(plan["id"])} plan={plan} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </section>

      {terminal.docs.length > 0 && (
        <section className="gf-console-card overflow-hidden">
          <div className="border-b border-[var(--console-border)] px-5 py-4">
            <h2 className="m-0 text-sm font-semibold text-[var(--console-ink)]">最近完成</h2>
            <p className="m-0 pt-1 text-xs text-[var(--console-ink-muted)]">
              已成功、失败或取消的计划（最近 10 条）。
            </p>
          </div>
          <ul className="m-0 list-none divide-y divide-[var(--console-border)] p-0">
            {(terminal.docs as unknown as PlanRecord[]).map((plan) => (
              <PlanRow key={String(plan["id"])} plan={plan} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
