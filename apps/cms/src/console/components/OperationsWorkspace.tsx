import Link from "next/link"

import { ChevronDownIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { consoleRoute } from "@/console/lib/resources"

type RecordLike = Record<string, unknown>

const OPERATION_STATES = [
  { key: "queued", label: "排队中" },
  { key: "running", label: "进行中" },
  { key: "succeeded", label: "已成功" },
  { key: "failed", label: "已失败" },
  { key: "cancelled", label: "已取消" },
] as const

const STATE_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  OPERATION_STATES.map((state) => [state.key, state.label]),
)

const TYPE_LABELS: Readonly<Record<string, string>> = {
  evaluate: "评估",
  generate: "生成",
  publish: "发布",
  rollback: "回滚",
}

/*
 * Badge palette mirrors PublicationPlansWorkspace so the same status family
 * reads identically across console surfaces (light + dark).
 */
const STATE_TONE: Readonly<Record<string, string>> = {
  cancelled: "bg-slate-100 text-slate-600 dark:bg-slate-400/15 dark:text-slate-300",
  failed: "bg-rose-50 text-rose-700 dark:bg-rose-400/15 dark:text-rose-300",
  queued: "bg-slate-100 text-slate-600 dark:bg-slate-400/15 dark:text-slate-300",
  running: "bg-amber-50 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300",
  succeeded: "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300",
}

const text = (value: unknown): string => (typeof value === "string" ? value : "")

const formatInstant = (value: unknown): string => {
  if (typeof value !== "string") return "—"
  const date = new Date(value)
  return Number.isNaN(date.valueOf())
    ? "—"
    : new Intl.DateTimeFormat("zh-CN", {
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        month: "short",
        year: "numeric",
      }).format(date)
}

const errorSummary = (value: unknown): string => {
  if (typeof value !== "object" || value === null) return ""
  const record = value as RecordLike
  const message = record["message"] ?? record["error"] ?? record["code"]
  if (typeof message === "string" && message.length > 0) return message
  const serialized = JSON.stringify(value)
  return serialized.length > 160 ? `${serialized.slice(0, 160)}…` : serialized
}

const shortOperationId = (value: string): string =>
  value.length > 12 ? value.slice(0, 12) : value

export const isOperationState = (value: string | undefined): value is string =>
  value !== undefined && OPERATION_STATES.some((state) => state.key === value)

export const OperationsWorkspace = ({
  docs,
  editionTitles,
  page,
  siteNames,
  stateFilter,
  totalDocs,
  totalPages,
}: {
  readonly docs: readonly RecordLike[]
  readonly editionTitles: ReadonlyMap<number, string>
  readonly page: number
  readonly siteNames: ReadonlyMap<number, string>
  readonly stateFilter: string | null
  readonly totalDocs: number
  readonly totalPages: number
}) => {
  const tabs: readonly { readonly active: boolean; readonly href: string; readonly label: string }[] =
    [
      {
        active: stateFilter === null,
        href: consoleRoute.collection("operations"),
        label: "全部",
      },
      ...OPERATION_STATES.map((state) => ({
        active: stateFilter === state.key,
        href: `${consoleRoute.collection("operations")}?state=${state.key}`,
        label: state.label,
      })),
    ]

  return (
    <section className="gf-console-card overflow-hidden">
      <nav aria-label="按状态筛选" className="flex flex-wrap gap-2 border-b border-[var(--console-border)] px-5 py-4">
        {tabs.map((tab) => (
          <Link
            aria-current={tab.active ? "page" : undefined}
            className={`gf-console-focus rounded-full border px-3 py-1 text-xs font-semibold no-underline transition-colors ${
              tab.active
                ? "border-[var(--console-accent)] bg-[var(--console-accent)]/10 text-[var(--gf-btn-primary)]"
                : "border-[var(--console-border)] bg-[var(--console-surface)] text-[var(--console-ink-muted)] hover:text-[var(--console-ink)]"
            }`}
            href={tab.href}
            key={tab.label}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {docs.length === 0 ? (
        <div className="grid min-h-64 place-items-center px-5 text-center">
          <div className="grid max-w-sm gap-2">
            <strong className="text-sm text-[var(--console-ink)]">
              {stateFilter === null ? "还没有操作记录" : `没有${STATE_LABELS[stateFilter] ?? stateFilter}的操作`}
            </strong>
            <span className="text-sm leading-6 text-[var(--console-ink-muted)]">
              发布、生成、评估与回滚等异步操作会在这里留下可审计的执行轨迹。
            </span>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead className="bg-[var(--console-surface-muted)]">
              <tr>
                {["状态", "操作", "进度", "站点", "创建时间", "最近更新"].map((header) => (
                  <th
                    className="whitespace-nowrap border-b border-[var(--console-border)] px-5 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--console-ink-muted)]"
                    key={header}
                    scope="col"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {docs.map((doc, index) => {
                const id = typeof doc["id"] === "number" ? doc["id"] : null
                const state = text(doc["state"]) || "queued"
                const operationType = text(doc["operationType"])
                const operationId = text(doc["operationId"])
                const currentStage = text(doc["currentStage"])
                const attempt = typeof doc["attempt"] === "number" ? doc["attempt"] : null
                const siteId = typeof doc["site"] === "number" ? doc["site"] : null
                const targetIds = doc["targetIds"]
                const targetEditionId =
                  typeof targetIds === "object" &&
                  targetIds !== null &&
                  typeof (targetIds as RecordLike)["editionId"] === "number"
                    ? ((targetIds as RecordLike)["editionId"] as number)
                    : null
                const editionTitle =
                  targetEditionId === null ? null : (editionTitles.get(targetEditionId) ?? null)
                const targetLabel =
                  targetEditionId === null
                    ? operationType === "rollback"
                      ? siteId === null
                        ? "站点"
                        : (siteNames.get(siteId) ?? `站点 #${String(siteId)}`)
                      : ""
                    : editionTitle === null
                      ? `文章 #${String(targetEditionId)}`
                      : `《${editionTitle}》`
                const failure = state === "failed" ? errorSummary(doc["error"]) : ""
                return (
                  <tr
                    className="gf-row transition-colors hover:bg-[var(--console-surface-muted)]"
                    key={String(id ?? index)}
                    style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
                  >
                    <td className="border-b border-[var(--console-border)] px-5 py-4">
                      <span
                        className={`inline-block whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-semibold ${STATE_TONE[state] ?? STATE_TONE["queued"]}`}
                      >
                        {STATE_LABELS[state] ?? state}
                      </span>
                    </td>
                    <td className="max-w-[300px] border-b border-[var(--console-border)] px-5 py-4">
                      {id === null ? (
                        <span className="text-sm text-[var(--console-ink)]">
                          {TYPE_LABELS[operationType] ?? operationType}
                          {targetLabel}
                        </span>
                      ) : (
                        <Link
                          className="gf-console-focus block truncate text-sm font-semibold text-[var(--console-ink)] no-underline hover:text-[var(--console-accent)]"
                          href={consoleRoute.document("operations", String(id))}
                          title={operationId}
                        >
                          {TYPE_LABELS[operationType] ?? operationType}
                          {targetLabel}
                          {operationId.length > 0 && (
                            <span className="pl-2 font-mono text-xs font-normal text-[var(--console-ink-muted)]">
                              {shortOperationId(operationId)}
                            </span>
                          )}
                        </Link>
                      )}
                      {failure.length > 0 && (
                        <span className="mt-1 block truncate text-xs leading-5 text-rose-600 dark:text-rose-400">
                          {failure}
                        </span>
                      )}
                    </td>
                    <td className="border-b border-[var(--console-border)] px-5 py-4 text-sm text-[var(--console-ink)]">
                      {currentStage.length > 0 ? currentStage : "—"}
                      {attempt !== null && attempt > 1 && (
                        <span className="pl-1.5 text-xs text-[var(--console-ink-muted)]">
                          第 {attempt} 次
                        </span>
                      )}
                    </td>
                    <td className="border-b border-[var(--console-border)] px-5 py-4 text-sm text-[var(--console-ink)]">
                      {siteId === null
                        ? "—"
                        : (siteNames.get(siteId) ?? `站点 #${String(siteId)}`)}
                    </td>
                    <td className="whitespace-nowrap border-b border-[var(--console-border)] px-5 py-4 text-sm text-[var(--console-ink)]">
                      {formatInstant(doc["createdAt"])}
                    </td>
                    <td className="whitespace-nowrap border-b border-[var(--console-border)] px-5 py-4 text-sm text-[var(--console-ink)]">
                      {formatInstant(doc["updatedAt"])}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <footer className="flex items-center justify-between gap-3 px-5 py-4">
        <span className="text-xs text-[var(--console-ink-muted)]">
          第 {page} / {Math.max(totalPages, 1)} 页 · 共 {totalDocs} 条
        </span>
        <div className="flex gap-2">
          {page <= 1 ? (
            <Button disabled size="sm" type="button" variant="secondary">
              上一页
            </Button>
          ) : (
            <Button asChild size="sm" type="button" variant="secondary">
              <Link
                href={`${consoleRoute.collection("operations")}?${stateFilter === null ? `page=${page - 1}` : `state=${stateFilter}&page=${page - 1}`}`}
              >
                上一页
              </Link>
            </Button>
          )}
          {page >= totalPages ? (
            <Button disabled size="sm" type="button" variant="secondary">
              下一页 <ChevronDownIcon size={13} />
            </Button>
          ) : (
            <Button asChild size="sm" type="button" variant="secondary">
              <Link
                href={`${consoleRoute.collection("operations")}?${stateFilter === null ? `page=${page + 1}` : `state=${stateFilter}&page=${page + 1}`}`}
              >
                下一页 <ChevronDownIcon size={13} />
              </Link>
            </Button>
          )}
        </div>
      </footer>
    </section>
  )
}
