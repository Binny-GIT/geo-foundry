"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState, useTransition } from "react"

import { AlertTriangleIcon, PlugIcon, PlusIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"

type ConnectorRow = Readonly<Record<string, unknown>>

type SiteOption = Readonly<{ readonly id: number | string; readonly name?: string }>

type ConnectorManagerProps = {
  readonly canManage: boolean
  readonly connectors: readonly ConnectorRow[]
}

const TYPES = ["rss", "url", "webhook", "manual"] as const

const TYPE_LABEL: Readonly<Record<string, string>> = {
  manual: "手动",
  rss: "RSS 轮询",
  url: "URL",
  webhook: "Webhook",
}

const dateLabel = (value: unknown): string => {
  if (typeof value !== "string") return "从未轮询"
  const date = new Date(value)
  return Number.isNaN(date.valueOf())
    ? "从未轮询"
    : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date)
}

const text = (value: unknown, fallback = "—"): string =>
  typeof value === "string" && value.length > 0 ? value : fallback

export const ConnectorManager = ({ canManage, connectors }: ConnectorManagerProps) => {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [sites, setSites] = useState<readonly SiteOption[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)

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

  const refresh = () => startTransition(() => router.refresh())

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = String(form.get("name") ?? "").trim()
    const type = String(form.get("type") ?? "")
    const site = String(form.get("site") ?? "").trim()
    if (name.length === 0 || site.length === 0 || type.length === 0) {
      setError("请填写名称、类型并选择目标站点。")
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch("/api/connectors", {
        body: JSON.stringify({
          name,
          pollIntervalMinutes: Number(form.get("pollIntervalMinutes") ?? 60),
          site: Number(site),
          ...(String(form.get("sourceEndpoint") ?? "").trim().length === 0
            ? {}
            : { sourceEndpoint: String(form.get("sourceEndpoint")).trim() }),
          type,
        }),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          readonly errors?: readonly { readonly message?: string }[]
        }
        setError(
          `创建失败（${payload.errors?.[0]?.message ?? response.status}）。RSS 源必须填 feed 端点。`,
        )
        return
      }
      setNotice(`已创建采集源「${name}」。`)
      event.currentTarget.reset()
      refresh()
    } catch {
      setError("暂时无法连接到服务，请稍后重试。")
    } finally {
      setBusy(false)
    }
  }

  const patch = async (id: number, body: Record<string, unknown>, message: string) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(`/api/connectors/${id}`, {
        body: JSON.stringify(body),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "PATCH",
      })
      if (!response.ok) {
        setError("保存失败，请检查填写内容。")
        return
      }
      setNotice(message)
      setEditingId(null)
      refresh()
    } catch {
      setError("暂时无法连接到服务，请稍后重试。")
    } finally {
      setBusy(false)
    }
  }

  const editing = connectors.find((item) => Number(item["id"]) === editingId) ?? null

  return (
    <div className="grid gap-6 [&>*]:min-w-0">
      {error !== null ? (
        <p className="m-0 flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-600">
          <AlertTriangleIcon />
          {error}
        </p>
      ) : null}
      {notice !== null ? (
        <p className="m-0 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface)] px-4 py-3 text-sm text-[var(--console-ink-muted)]">
          {notice}
        </p>
      ) : null}

      {canManage ? (
        <section className="gf-console-card grid gap-4 p-5 sm:p-6">
          <h2 className="m-0 text-base font-semibold tracking-tight text-[var(--console-ink)]">
            新建采集源
          </h2>
          {sites.length === 0 ? (
            <p className="m-0 text-sm leading-6 text-[var(--console-ink-muted)]">
              当前租户还没有站点，先到「站点」页面创建一个。
            </p>
          ) : (
            <form
              className="grid gap-3 sm:grid-cols-[2fr_1fr_2fr_1fr_auto] sm:items-end"
              onSubmit={create}
            >
              <label className="grid gap-1.5 text-sm text-[var(--console-ink-muted)]">
                名称
                <input
                  className="h-9 rounded-md border border-[var(--console-border)] bg-[var(--console-surface)] px-3 text-sm text-[var(--console-ink)]"
                  maxLength={200}
                  name="name"
                  placeholder="例如：行业资讯 RSS"
                  required
                  type="text"
                />
              </label>
              <label className="grid gap-1.5 text-sm text-[var(--console-ink-muted)]">
                类型
                <select
                  className="h-9 rounded-md border border-[var(--console-border)] bg-[var(--console-surface)] px-3 text-sm text-[var(--console-ink)]"
                  name="type"
                  required
                >
                  {TYPES.map((type) => (
                    <option key={type} value={type}>
                      {TYPE_LABEL[type]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-sm text-[var(--console-ink-muted)]">
                Feed 端点（RSS 必填）
                <input
                  className="h-9 rounded-md border border-[var(--console-border)] bg-[var(--console-surface)] px-3 font-mono text-xs text-[var(--console-ink)]"
                  name="sourceEndpoint"
                  placeholder="https://example.com/feed.xml"
                  type="url"
                />
              </label>
              <label className="grid gap-1.5 text-sm text-[var(--console-ink-muted)]">
                轮询间隔（分钟）
                <input
                  className="h-9 rounded-md border border-[var(--console-border)] bg-[var(--console-surface)] px-3 text-sm text-[var(--console-ink)]"
                  max={10080}
                  min={5}
                  name="pollIntervalMinutes"
                  type="number"
                  value={60}
                />
              </label>
              <label className="grid gap-1.5 text-sm text-[var(--console-ink-muted)]">
                目标站点
                <select
                  className="h-9 rounded-md border border-[var(--console-border)] bg-[var(--console-surface)] px-3 text-sm text-[var(--console-ink)]"
                  name="site"
                  required
                >
                  {sites.map((site) => (
                    <option key={String(site.id)} value={String(site.id)}>
                      {String(site.name ?? site.id)}
                    </option>
                  ))}
                </select>
              </label>
              <Button disabled={busy} type="submit">
                <PlusIcon />
                创建
              </Button>
            </form>
          )}
        </section>
      ) : null}

      <section className="gf-console-card grid gap-4 p-5 sm:p-6">
        <h2 className="m-0 text-base font-semibold tracking-tight text-[var(--console-ink)]">
          采集源
        </h2>
        {connectors.length === 0 ? (
          <p className="m-0 text-sm leading-6 text-[var(--console-ink-muted)]">
            还没有配置任何采集源。RSS 源由 Worker 每分钟检查、按各自间隔轮询。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--console-ink-muted)]">
                  <th className="pb-2 pr-4 font-medium">名称</th>
                  <th className="pb-2 pr-4 font-medium">类型</th>
                  <th className="pb-2 pr-4 font-medium">状态</th>
                  <th className="pb-2 pr-4 font-medium">端点</th>
                  <th className="pb-2 pr-4 font-medium">间隔</th>
                  <th className="pb-2 pr-4 font-medium">上次轮询</th>
                  {canManage ? <th className="pb-2 font-medium">操作</th> : null}
                </tr>
              </thead>
              <tbody>
                {connectors.map((connector) => {
                  const id = Number(connector["id"])
                  const status = String(connector["status"] ?? "active")
                  const isEditing = editingId === id
                  return (
                    <tr
                      className="border-t border-[var(--console-border)] text-[var(--console-ink)]"
                      key={id}
                    >
                      <td className="py-3 pr-4">{text(connector["name"])}</td>
                      <td className="py-3 pr-4 text-[var(--console-ink-muted)]">
                        {TYPE_LABEL[String(connector["type"])] ?? String(connector["type"])}
                      </td>
                      <td className="py-3 pr-4">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className={`inline-block size-2 rounded-full ${status === "active" ? "bg-emerald-500" : "bg-slate-400"}`}
                          />
                          {status === "active" ? "启用" : "停用"}
                        </span>
                      </td>
                      <td className="max-w-64 truncate py-3 pr-4 font-mono text-xs text-[var(--console-ink-muted)]">
                        {text(connector["sourceEndpoint"], "—")}
                      </td>
                      <td className="py-3 pr-4 text-[var(--console-ink-muted)]">
                        {isEditing ? (
                          <input
                            className="h-8 w-20 rounded-md border border-[var(--console-border)] bg-[var(--console-surface)] px-2 text-xs"
                            defaultValue={Number(connector["pollIntervalMinutes"] ?? 60)}
                            id={`interval-${id}`}
                            max={10080}
                            min={5}
                            type="number"
                          />
                        ) : (
                          `${Number(connector["pollIntervalMinutes"] ?? 60)} 分钟`
                        )}
                      </td>
                      <td className="py-3 pr-4 text-[var(--console-ink-muted)]">
                        {dateLabel(connector["lastPolledAt"])}
                      </td>
                      {canManage ? (
                        <td className="py-3">
                          <div className="flex gap-1.5">
                            {isEditing && editing !== null ? (
                              <>
                                <Button
                                  disabled={busy}
                                  onClick={() => {
                                    const input = document.getElementById(
                                      `interval-${id}`,
                                    ) as HTMLInputElement | null
                                    const minutes = Number(input?.value ?? 60)
                                    void patch(
                                      id,
                                      {
                                        name: String(editing["name"] ?? ""),
                                        pollIntervalMinutes: minutes,
                                        status: String(editing["status"] ?? "active") as
                                          | "active"
                                          | "disabled",
                                      },
                                      "已保存。",
                                    )
                                  }}
                                  size="xs"
                                  type="button"
                                >
                                  保存
                                </Button>
                                <Button
                                  onClick={() => setEditingId(null)}
                                  size="xs"
                                  type="button"
                                  variant="secondary"
                                >
                                  取消
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button
                                  disabled={busy}
                                  onClick={() => void setEditingId(id)}
                                  size="xs"
                                  type="button"
                                  variant="secondary"
                                >
                                  <PlugIcon />
                                  改间隔
                                </Button>
                                <Button
                                  disabled={busy}
                                  onClick={() =>
                                    void patch(
                                      id,
                                      {
                                        status:
                                          status === "active"
                                            ? ("disabled" as const)
                                            : ("active" as const),
                                      },
                                      status === "active" ? "已停用。" : "已启用。",
                                    )
                                  }
                                  size="xs"
                                  type="button"
                                  variant={status === "active" ? "destructive" : "default"}
                                >
                                  {status === "active" ? "停用" : "启用"}
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
