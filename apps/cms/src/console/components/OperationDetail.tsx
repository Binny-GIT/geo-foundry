import Link from "next/link"
import { notFound } from "next/navigation"

import { CMS_ACTION, CMS_RESOURCE } from "@/access/policy"
import { Button } from "@/components/ui/button"
import { consoleRoute } from "@/console/lib/resources"
import { requireConsoleContext } from "@/console/lib/console-context.server"
import { canConsole } from "@/console/lib/session.server"
import { findConsoleRecord } from "@/server/repositories/console-collections"

const TYPE_LABELS: Readonly<Record<string, string>> = {
  evaluate: "评估",
  generate: "生成",
  publish: "发布",
  rollback: "回滚",
}

const STATE_LABELS: Readonly<Record<string, string>> = {
  cancelled: "已取消",
  failed: "已失败",
  queued: "排队中",
  running: "进行中",
  succeeded: "已成功",
}

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
        second: "2-digit",
        year: "numeric",
      }).format(date)
}

const prettyJson = (value: unknown): string => {
  if (value === null || value === undefined) return ""
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const FieldList = ({
  rows,
}: {
  readonly rows: readonly { readonly label: string; readonly value: readonly React.ReactNode[] }[]
}) => (
  <dl className="m-0 divide-y divide-[var(--console-border)]">
    {rows.map((row) => (
      <div className="grid gap-1 px-5 py-4 sm:grid-cols-[160px_1fr] sm:gap-6" key={row.label}>
        <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--console-ink-muted)]">
          {row.label}
        </dt>
        <dd className={`m-0 break-words text-sm leading-6 ${row.value[1] ?? ""}`}>{row.value[0]}</dd>
      </div>
    ))}
  </dl>
)

const JsonCard = ({
  body,
  tone,
  title,
}: {
  readonly body: string
  readonly tone: "danger" | "neutral"
  readonly title: string
}) => (
  <section
    className={`gf-console-card overflow-hidden ${tone === "danger" ? "border-rose-200 dark:border-rose-400/30" : ""}`}
  >
    <div className="border-b border-[var(--console-border)] px-5 py-4">
      <h2
        className={`m-0 text-sm font-semibold ${tone === "danger" ? "text-rose-700 dark:text-rose-300" : "text-[var(--console-ink)]"}`}
      >
        {title}
      </h2>
    </div>
    <pre className="m-0 overflow-x-auto px-5 py-4 font-mono text-xs leading-6 text-[var(--console-ink)]">
      {body}
    </pre>
  </section>
)

export const OperationDetail = async ({ id }: { readonly id: string }) => {
  const context = await requireConsoleContext()
  const { session } = context
  if (!canConsole(session, CMS_RESOURCE.OPERATIONS, CMS_ACTION.READ)) notFound()
  const numericId = Number.parseInt(id, 10)
  if (!Number.isSafeInteger(numericId) || numericId <= 0) notFound()
  const doc = await findConsoleRecord(context.db, context.scope, "operations", numericId)
  if (doc === null) notFound()

  const state = text(doc["state"]) || "queued"
  const operationType = text(doc["operationType"])
  const operationId = text(doc["operationId"])
  const attempt = typeof doc["attempt"] === "number" ? doc["attempt"] : null
  const siteId = typeof doc["site"] === "number" ? doc["site"] : null
  const tenantId = typeof doc["tenant"] === "number" ? doc["tenant"] : null
  const errorBody = prettyJson(doc["error"])
  const resultBody = prettyJson(doc["result"])
  const auditLog = Array.isArray(doc["auditLog"]) ? (doc["auditLog"] as readonly unknown[]) : []

  return (
    <div className="grid gap-6 [&>*]:min-w-0">
      <header className="grid gap-3">
        <Button asChild className="gf-console-focus w-fit" size="sm" type="button" variant="secondary">
          <Link href={consoleRoute.collection("operations")}>← 返回操作日志</Link>
        </Button>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h1 className="m-0 text-2xl font-bold tracking-tight text-[var(--console-ink)]">
              {TYPE_LABELS[operationType] ?? operationType}操作
            </h1>
            <span
              className={`inline-block shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATE_TONE[state] ?? STATE_TONE["queued"]}`}
            >
              {STATE_LABELS[state] ?? state}
            </span>
          </div>
          <span className="w-fit rounded-full border border-[var(--console-border)] bg-[var(--console-surface)] px-3 py-1 text-xs font-semibold text-[var(--console-ink-muted)]">
            记录 {id}
          </span>
        </div>
      </header>

      <section className="gf-console-card overflow-hidden">
        <FieldList
          rows={[
            {
              label: "操作 ID",
              value: [
                <span className="break-all font-mono text-xs" key="op">
                  {operationId || "—"}
                </span>,
              ],
            },
            { label: "调用端点", value: [text(doc["endpoint"]) || "—"] },
            {
              label: "站点 / 租户",
              value: [
                `${siteId === null ? "—" : `#${String(siteId)}`} / ${tenantId === null ? "—" : `#${String(tenantId)}`}`,
              ],
            },
            {
              label: "尝试次数",
              value: [attempt === null ? "—" : `第 ${String(attempt)} 次执行`],
            },
            { label: "当前阶段", value: [text(doc["currentStage"]) || "—"] },
          ]}
        />
      </section>

      <section className="gf-console-card overflow-hidden">
        <FieldList
          rows={[
            { label: "创建时间", value: [formatInstant(doc["createdAt"])] },
            { label: "最后阶段推进", value: [formatInstant(doc["lastStageAt"])] },
            { label: "最近更新", value: [formatInstant(doc["updatedAt"])] },
          ]}
        />
      </section>

      {errorBody.length > 0 && errorBody !== "null" && (
        <JsonCard body={errorBody} title="错误详情" tone="danger" />
      )}
      {resultBody.length > 0 && resultBody !== "null" && (
        <JsonCard body={resultBody} title="执行结果" tone="neutral" />
      )}
      {auditLog.length > 0 && (
        <JsonCard body={prettyJson(auditLog)} title="审计轨迹" tone="neutral" />
      )}
    </div>
  )
}
