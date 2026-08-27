import Link from "next/link"

import { AlertTriangleIcon, CheckCircleIcon, LayersIcon, PencilIcon, RotateCcwIcon, SearchIcon } from "@/components/icons"
import { consoleRoute } from "@/console/lib/resources"
import { PerformanceSuggestions, type PerformanceSuggestion } from "@/console/components/PerformanceSuggestions"

type WorkRecord = Readonly<Record<string, unknown>>

type TodayWorkProps = {
  readonly failedOperations: readonly WorkRecord[]
  readonly ownedEditions: readonly WorkRecord[]
  readonly publisherEditions: readonly WorkRecord[]
  readonly reviewEditions: readonly WorkRecord[]
  readonly suggestions: readonly PerformanceSuggestion[]
}

const dateLabel = (value: unknown): string => {
  if (typeof value !== "string") return "No recent activity"
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return "No recent activity"
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date)
}

const relationLabel = (value: unknown): string => {
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>
    for (const key of ["name", "title", "hostname"]) {
      if (typeof record[key] === "string" && record[key].length > 0) return record[key]
    }
  }
  return "Restricted site"
}

const editionTitle = (edition: WorkRecord): string =>
  typeof edition["title"] === "string" && edition["title"].length > 0 ? edition["title"] : "Untitled edition"

const queue = (items: readonly WorkRecord[], empty: string) =>
  items.length === 0 ? (
    <p className="m-0 px-5 py-6 text-sm text-[var(--console-ink-muted)]">{empty}</p>
  ) : (
    <ul className="m-0 list-none divide-y divide-[var(--console-border)] p-0">
      {items.map((item, index) => {
        const id = item["id"]
        const title = editionTitle(item)
        return (
          <li key={String(id ?? index)}>
            {id === undefined || id === null ? (
              <div className="block px-5 py-4">
                <strong className="block text-sm text-[var(--console-ink)]">{title}</strong>
              </div>
            ) : (
              <Link
                className="gf-console-focus block px-5 py-4 no-underline transition-colors hover:bg-indigo-50/55 dark:hover:bg-indigo-400/6"
                href={consoleRoute.document("content-editions", String(id))}
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <span className="min-w-0">
                    <strong className="block truncate text-sm text-[var(--console-ink)]">{title}</strong>
                    <span className="block truncate pt-1 text-xs text-[var(--console-ink-muted)]">
                      {relationLabel(item["site"])} · Updated {dateLabel(item["updatedAt"])}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-[var(--console-surface-muted)] px-2 py-1 text-[11px] font-semibold text-[var(--console-ink-muted)]">
                    {typeof item["workflowStatus"] === "string" ? item["workflowStatus"] : "draft"}
                  </span>
                </div>
              </Link>
            )}
          </li>
        )
      })}
    </ul>
  )

const WorkSection = ({ children, description, title, Icon }: { readonly children: React.ReactNode; readonly description: string; readonly title: string; readonly Icon: typeof LayersIcon }) => (
  <section className="gf-console-card overflow-hidden">
    <div className="flex items-start gap-3 border-b border-[var(--console-border)] px-5 py-4">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-400/15 dark:text-indigo-300"><Icon size={18} /></span>
      <div>
        <h2 className="m-0 text-base font-semibold text-[var(--console-ink)]">{title}</h2>
        <p className="m-0 pt-1 text-xs leading-5 text-[var(--console-ink-muted)]">{description}</p>
      </div>
    </div>
    {children}
  </section>
)

export const TodayWork = ({ failedOperations, ownedEditions, publisherEditions, reviewEditions, suggestions }: TodayWorkProps) => (
  <div className="grid gap-6">
    <header>
      <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-indigo-600">Daily queue</p>
      <h1 className="m-0 pt-1 text-3xl font-semibold tracking-tight text-[var(--console-ink)]">Today Work</h1>
      <p className="m-0 max-w-2xl pt-2 text-sm leading-6 text-[var(--console-ink-muted)]">Work that is visible in your current server-side permission scope.</p>
    </header>

    <div className="grid gap-5 xl:grid-cols-2">
      {suggestions.length > 0 && (
        <WorkSection description="Published editions whose recent traffic dropped well below the prior observation." Icon={RotateCcwIcon} title="Update suggestions">
          <PerformanceSuggestions suggestions={suggestions} />
        </WorkSection>
      )}
      <WorkSection description="Content editions currently assigned to you." Icon={PencilIcon} title="My editions">
        {queue(ownedEditions, "No owned editions need attention right now.")}
      </WorkSection>
      {reviewEditions.length > 0 && (
        <WorkSection description="Editions waiting for a reviewer decision." Icon={SearchIcon} title="Ready for review">
          {queue(reviewEditions, "Nothing is waiting for review.")}
        </WorkSection>
      )}
      {publisherEditions.length > 0 && (
        <WorkSection description="Approved and compiled editions ready for publishing work." Icon={CheckCircleIcon} title="Publish queue">
          {queue(publisherEditions, "Nothing is ready to publish.")}
        </WorkSection>
      )}
      {failedOperations.length > 0 && (
        <WorkSection description="Failed operations readable by your role." Icon={AlertTriangleIcon} title="Needs attention">
          <ul className="m-0 list-none divide-y divide-[var(--console-border)] p-0">
            {failedOperations.map((operation, index) => {
              const id = operation["id"]
              const operationId = typeof operation["operationId"] === "string" ? operation["operationId"] : "Operation"
              return (
                <li key={String(id ?? index)}>
                  {id === undefined || id === null ? <div className="px-5 py-4 text-sm text-[var(--console-ink)]">{operationId}</div> : <Link className="gf-console-focus block px-5 py-4 no-underline transition-colors hover:bg-rose-50/60 dark:hover:bg-rose-400/6" href={consoleRoute.document("operations", String(id))}><strong className="block text-sm text-[var(--console-ink)]">{operationId}</strong><span className="block pt-1 text-xs text-[var(--console-ink-muted)]">{typeof operation["operationType"] === "string" ? operation["operationType"] : "operation"} · Updated {dateLabel(operation["updatedAt"])}</span></Link>}
                </li>
              )
            })}
          </ul>
        </WorkSection>
      )}
    </div>
  </div>
)
