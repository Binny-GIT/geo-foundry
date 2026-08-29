"use client"

import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState, useTransition } from "react"

import { AlertTriangleIcon, CheckCircleIcon, EyeIcon, LayersIcon } from "@/components/icons"

type IntakeItem = Readonly<Record<string, unknown>>

type SiteOption = Readonly<{ readonly id: number | string; readonly name?: string }>

type IntakeInboxProps = {
  readonly canManage: boolean
  readonly initialChannel: string
  readonly initialItems: readonly IntakeItem[]
  readonly initialStatus: string
}

const CHANNELS = ["", "manual", "url", "webhook", "rss"] as const
const STATUSES = ["", "new", "fetching", "ready", "failed", "ignored", "duplicate", "adopted", "merged"] as const

const dateLabel = (value: unknown): string => {
  if (typeof value !== "string") return "—"
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? "—" : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date)
}

const text = (value: unknown, fallback = "—"): string => typeof value === "string" && value.length > 0 ? value : fallback

export const IntakeInbox = ({ canManage, initialChannel, initialItems, initialStatus }: IntakeInboxProps) => {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [selectedId, setSelectedId] = useState<string>(() => String(initialItems[0]?.["id"] ?? ""))
  const [mergeTarget, setMergeTarget] = useState("")
  const [notice, setNotice] = useState<string | null>(null)
  const [sites, setSites] = useState<readonly SiteOption[]>([])
  const [importError, setImportError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const selected = useMemo(() => initialItems.find((item) => String(item["id"]) === selectedId) ?? initialItems[0] ?? null, [initialItems, selectedId])

  useEffect(() => {
    if (!canManage) return
    let active = true
    void fetch("/api/sites?depth=0&limit=100&sort=name", { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) return []
        const payload = (await response.json()) as { readonly docs?: readonly SiteOption[] }
        return payload.docs ?? []
      })
      .then((docs) => {
        if (active) setSites(docs)
      })
      .catch(() => {
        if (active) setSites([])
      })
    return () => {
      active = false
    }
  }, [canManage])

  const setFilter = (key: "channel" | "status", value: string) => {
    const params = new URLSearchParams()
    const nextChannel = key === "channel" ? value : initialChannel
    const nextStatus = key === "status" ? value : initialStatus
    if (nextChannel) params.set("channel", nextChannel)
    if (nextStatus) params.set("status", nextStatus)
    startTransition(() => router.replace(`/admin/inbox${params.size > 0 ? `?${params.toString()}` : ""}`))
  }

  const importUrl = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setImportError(null)
    setImporting(true)
    const form = new FormData(event.currentTarget)
    const title = String(form.get("title") ?? "").trim()
    const sourceUrl = String(form.get("sourceUrl") ?? "").trim()
    const suggestedSiteId = String(form.get("suggestedSiteId") ?? "").trim()
    try {
      const response = await fetch("/api/intake-operations", {
        body: JSON.stringify({
          channel: "url",
          sourceUrl,
          suggestedSiteId: Number(suggestedSiteId),
          title,
        }),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      if (!response.ok) {
        setImportError("无法导入该 URL。请确认它是公开可访问的网页并检查填写内容。")
        return
      }
      setNotice("URL 已导入，正在抓取正文。")
      event.currentTarget.reset()
      startTransition(() => router.refresh())
    } catch {
      setImportError("暂时无法连接到服务，请稍后重试。")
    } finally {
      setImporting(false)
    }
  }

  const operate = async (action: "ignore" | "adopt" | "merge" | "retry") => {
    if (selected === null || selected["id"] === undefined || selected["id"] === null) return
    if (action === "merge" && mergeTarget.trim().length === 0) {
      setNotice("Enter the target intake item ID before merging.")
      return
    }
    setNotice(null)
    const body =
      action === "merge"
        ? JSON.stringify({ targetIntakeItemId: mergeTarget.trim() })
        : action === "adopt"
          ? JSON.stringify({})
          : null
    const response = await fetch(`/api/intake-operations/${encodeURIComponent(String(selected["id"]))}/${action}`, {
      credentials: "same-origin",
      ...(body === null ? {} : { body, headers: { "content-type": "application/json" } }),
      method: "POST",
    })
    if (!response.ok) {
      setNotice(`Could not ${action} this intake item. Please try again.`)
      return
    }
    setNotice(
      action === "adopt"
        ? "Intake item adopted."
        : action === "merge"
          ? "Intake items merged."
          : action === "retry"
            ? "Intake fetch queued."
            : "Intake item ignored.",
    )
    startTransition(() => router.refresh())
  }

  return (
    <div className="grid gap-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-indigo-600">Editorial intake</p>
          <h1 className="m-0 pt-1 text-3xl font-semibold tracking-tight text-[var(--console-ink)]">Inbox</h1>
          <p className="m-0 max-w-2xl pt-2 text-sm leading-6 text-[var(--console-ink-muted)]">Review normalized intake items and turn viable sources into content work.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="grid gap-1 text-xs font-semibold text-[var(--console-ink-muted)]">Channel<select className="gf-console-focus h-10 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface)] px-3 text-sm text-[var(--console-ink)]" disabled={isPending} onChange={(event) => setFilter("channel", event.target.value)} value={initialChannel}>{CHANNELS.map((channel) => <option key={channel} value={channel}>{channel || "All channels"}</option>)}</select></label>
          <label className="grid gap-1 text-xs font-semibold text-[var(--console-ink-muted)]">Status<select className="gf-console-focus h-10 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface)] px-3 text-sm text-[var(--console-ink)]" disabled={isPending} onChange={(event) => setFilter("status", event.target.value)} value={initialStatus}>{STATUSES.map((status) => <option key={status} value={status}>{status || "All statuses"}</option>)}</select></label>
        </div>
      </header>

      {canManage && (
        <form
          className="gf-console-card grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(180px,0.7fr)_auto] sm:items-end"
          onSubmit={importUrl}
        >
          <div className="sm:col-span-full">
            <p className="m-0 text-sm font-semibold text-[var(--console-ink)]">导入公开 URL</p>
            <p className="m-0 pt-1 text-xs leading-5 text-[var(--console-ink-muted)]">URL 会先进入稿源箱并由后台安全抓取；确认后再采用为内容版本。</p>
          </div>
          <label className="grid gap-1.5 text-sm font-medium text-[var(--console-ink)]">
            稿源标题
            <input
              className="gf-console-focus h-11 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3 text-base text-[var(--console-ink)] outline-none"
              name="title"
              placeholder="例如：官方产品更新"
              required
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-[var(--console-ink)]">
            公开 URL
            <input
              autoCapitalize="none"
              className="gf-console-focus h-11 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3 text-base text-[var(--console-ink)] outline-none"
              inputMode="url"
              name="sourceUrl"
              placeholder="https://example.com/article"
              required
              type="url"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-[var(--console-ink)]">
            目标站点
            <select
              className="gf-console-focus h-11 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3 text-base text-[var(--console-ink)] outline-none disabled:cursor-not-allowed disabled:opacity-60"
              disabled={sites.length === 0 || importing}
              name="suggestedSiteId"
              required
            >
              <option value="">{sites.length === 0 ? "没有可关联的站点" : "请选择站点"}</option>
              {sites.map((site) => (
                <option key={String(site.id)} value={String(site.id)}>
                  {site.name ?? "受限站点"}
                </option>
              ))}
            </select>
          </label>
          <button
            className="gf-console-focus inline-flex h-11 items-center justify-center rounded-xl bg-[var(--console-accent)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--console-accent-hover)] disabled:cursor-wait disabled:opacity-60"
            disabled={importing || sites.length === 0}
            type="submit"
          >
            {importing ? "正在导入…" : "导入 URL"}
          </button>
          {importError !== null && (
            <p className="sm:col-span-full m-0 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm leading-6 text-rose-700" role="alert">
              {importError}
            </p>
          )}
        </form>
      )}

      <section className="gf-console-card grid min-h-[520px] overflow-hidden lg:grid-cols-[minmax(340px,0.95fr)_minmax(420px,1.35fr)]">
        <div className="border-b border-[var(--console-border)] lg:border-r lg:border-b-0">
          <div className="flex items-center justify-between border-b border-[var(--console-border)] px-5 py-4"><span className="text-sm font-semibold text-[var(--console-ink)]">{initialItems.length} visible items</span>{isPending && <span className="text-xs text-[var(--console-ink-muted)]">Refreshing…</span>}</div>
          {initialItems.length === 0 ? <div className="grid min-h-64 place-items-center p-6 text-center"><div><LayersIcon size={22} /><p className="m-0 pt-3 text-sm font-semibold text-[var(--console-ink)]">No intake items found</p><p className="m-0 pt-1 text-xs leading-5 text-[var(--console-ink-muted)]">Try a different channel or status filter.</p></div></div> : <ul className="m-0 max-h-[620px] list-none overflow-y-auto p-0">{initialItems.map((item, index) => { const id = String(item["id"] ?? index); const active = selected !== null && String(selected["id"]) === id; return <li key={id}><button className={`gf-console-focus block w-full border-b border-[var(--console-border)] px-5 py-4 text-left transition-colors ${active ? "bg-indigo-50/80 dark:bg-indigo-400/10" : "hover:bg-[var(--console-surface-muted)]"}`} onClick={() => setSelectedId(id)} type="button"><div className="flex gap-3"><span className={`mt-1.5 size-2 shrink-0 rounded-full ${item["status"] === "failed" ? "bg-rose-500" : item["status"] === "ready" ? "bg-emerald-500" : "bg-indigo-500"}`} /><span className="min-w-0"><strong className="block truncate text-sm text-[var(--console-ink)]">{text(item["title"], "Untitled intake")}</strong><span className="block truncate pt-1 text-xs text-[var(--console-ink-muted)]">{text(item["channel"])} · {text(item["status"])} · {dateLabel(item["receivedAt"])}</span></span></div></button></li>})}</ul>}
        </div>

        <div className="min-w-0 p-5 sm:p-6">
          {selected === null ? <div className="grid min-h-64 place-items-center text-center"><div><EyeIcon size={24} /><p className="m-0 pt-3 text-sm text-[var(--console-ink-muted)]">Choose an intake item to preview it.</p></div></div> : <div className="grid gap-5"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-indigo-600">{text(selected["channel"])}</p><h2 className="m-0 pt-1 text-xl font-semibold tracking-tight text-[var(--console-ink)]">{text(selected["title"], "Untitled intake")}</h2></div><span className="rounded-full bg-[var(--console-surface-muted)] px-2.5 py-1 text-xs font-semibold text-[var(--console-ink-muted)]">{text(selected["status"])}</span></div><dl className="m-0 grid gap-3 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] p-4 text-sm sm:grid-cols-2"><div><dt className="text-xs font-semibold text-[var(--console-ink-muted)]">Received</dt><dd className="m-0 pt-1 text-[var(--console-ink)]">{dateLabel(selected["receivedAt"])}</dd></div><div><dt className="text-xs font-semibold text-[var(--console-ink-muted)]">Duplicate check</dt><dd className="m-0 pt-1 text-[var(--console-ink)]">{text(selected["duplicateStatus"])}</dd></div></dl><div><h3 className="m-0 text-sm font-semibold text-[var(--console-ink)]">Summary</h3><p className="m-0 whitespace-pre-wrap pt-2 text-sm leading-6 text-[var(--console-ink-muted)]">{text(selected["summary"], "No summary was provided.")}</p></div>{typeof selected["sourceUrl"] === "string" && selected["sourceUrl"].length > 0 && <a className="gf-console-focus w-fit text-sm font-semibold text-indigo-700 hover:underline dark:text-indigo-300" href={selected["sourceUrl"]} rel="noreferrer" target="_blank">Open source</a>}{typeof selected["failureReason"] === "string" && selected["failureReason"].length > 0 && <div className="flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-200"><AlertTriangleIcon size={18} /><span>{selected["failureReason"]}</span></div>}{notice && <p aria-live="polite" className="m-0 rounded-xl bg-[var(--console-surface-muted)] p-3 text-sm text-[var(--console-ink-muted)]">{notice}</p>}{canManage && <div className="border-t border-[var(--console-border)] pt-5"><p className="m-0 text-sm font-semibold text-[var(--console-ink)]">Actions</p><div className="flex flex-wrap gap-2 pt-3"><button className="gf-console-focus h-10 rounded-xl bg-[var(--console-accent)] px-3.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--console-accent-hover)] disabled:opacity-60" disabled={isPending} onClick={() => void operate("adopt")} type="button"><CheckCircleIcon size={16} /> Adopt</button>{(selected["status"] === "failed" || selected["failureCode"] === "INTAKE_QUEUE_UNAVAILABLE") && <button className="gf-console-focus h-10 rounded-xl border border-amber-300 bg-amber-50 px-3.5 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100" disabled={isPending} onClick={() => void operate("retry")} type="button">Retry fetch</button>}<button className="gf-console-focus h-10 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface)] px-3.5 text-sm font-semibold text-[var(--console-ink)] hover:bg-[var(--console-surface-muted)] disabled:opacity-60" disabled={isPending} onClick={() => void operate("ignore")} type="button">Ignore</button></div><div className="flex flex-col gap-2 pt-3 sm:flex-row"><label className="sr-only" htmlFor="merge-target">Merge target intake item ID</label><input className="gf-console-focus h-10 min-w-0 flex-1 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface)] px-3 text-sm text-[var(--console-ink)]" id="merge-target" onChange={(event) => setMergeTarget(event.target.value)} placeholder="Target intake item ID" value={mergeTarget} /><button className="gf-console-focus h-10 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface)] px-3.5 text-sm font-semibold text-[var(--console-ink)] hover:bg-[var(--console-surface-muted)] disabled:opacity-60" disabled={isPending} onClick={() => void operate("merge")} type="button">Merge</button></div></div>}</div>}
        </div>
      </section>
    </div>
  )
}
