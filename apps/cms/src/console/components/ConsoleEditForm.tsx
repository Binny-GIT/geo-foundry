"use client"

import { useEffect, useState } from "react"

import { consoleRoute } from "../lib/resources"

type RecordLike = Record<string, unknown>

type SiteOption = {
  readonly id: number | string
  readonly name?: string
}

type PayloadError = {
  readonly errors?: readonly { readonly message?: string }[]
  readonly message?: string
}

const stringValue = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback

const relationId = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") return String(value)
  if (typeof value === "object" && value !== null) {
    const id = (value as Record<string, unknown>)["id"]
    if (typeof id === "string" || typeof id === "number") return String(id)
  }
  return ""
}

const errorMessage = (payload: PayloadError): string =>
  payload.errors?.find((error) => typeof error.message === "string")?.message ??
  payload.message ??
  "保存失败，请检查填写内容后重试。"

export const ConsoleEditForm = ({
  document,
  slug,
}: {
  readonly document: RecordLike
  readonly slug: "contents" | "domains" | "tenants"
}) => {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sites, setSites] = useState<readonly SiteOption[]>([])
  const id = relationId(document["id"])

  useEffect(() => {
    if (slug !== "domains") return
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
  }, [slug])

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setLoading(true)
    const form = new FormData(event.currentTarget)
    const data =
      slug === "tenants"
        ? { name: String(form.get("name") ?? "").trim() }
        : slug === "contents"
          ? {
              createdBy: String(form.get("createdBy") ?? "human"),
              intent: String(form.get("intent") ?? "").trim(),
              topic: String(form.get("topic") ?? "").trim(),
            }
          : {
              hostname: String(form.get("hostname") ?? "").trim(),
              role: String(form.get("role") ?? "canonical"),
              site: String(form.get("site") ?? ""),
              status: String(form.get("status") ?? "active"),
            }

    try {
      const response = await fetch(`/api/${slug}/${encodeURIComponent(id)}`, {
        body: JSON.stringify(data),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "PATCH",
      })
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as PayloadError
        setError(errorMessage(payload))
        return
      }
      window.location.assign(consoleRoute.document(slug, id))
    } catch {
      setError("暂时无法连接到服务，请稍后重试。")
    } finally {
      setLoading(false)
    }
  }

  return (
    <form className="grid gap-5" onSubmit={submit}>
      {slug === "tenants" && (
        <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
          租户名称
          <input
            autoComplete="organization"
            className="gf-console-focus h-11 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3.5 text-base text-[var(--console-ink)] outline-none"
            defaultValue={stringValue(document["name"])}
            name="name"
            required
          />
        </label>
      )}
      {slug === "contents" && (
        <>
          <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
            内容主题
            <input
              className="gf-console-focus h-11 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3.5 text-base text-[var(--console-ink)] outline-none"
              defaultValue={stringValue(document["topic"])}
              name="topic"
              required
            />
          </label>
          <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
            内容意图
            <textarea
              className="gf-console-focus min-h-28 resize-y rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3.5 py-3 text-base leading-6 text-[var(--console-ink)] outline-none"
              defaultValue={stringValue(document["intent"])}
              name="intent"
              required
            />
          </label>
          <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
            创建来源
            <select
              className="gf-console-focus h-11 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3.5 text-base text-[var(--console-ink)] outline-none"
              defaultValue={stringValue(document["createdBy"], "human")}
              name="createdBy"
            >
              <option value="human">人工</option>
              <option value="ai">AI</option>
              <option value="hybrid">混合</option>
            </select>
          </label>
        </>
      )}
      {slug === "domains" && (
        <>
          <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
            主机名
            <input
              autoCapitalize="none"
              autoComplete="off"
              className="gf-console-focus h-11 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3.5 text-base text-[var(--console-ink)] outline-none"
              defaultValue={stringValue(document["hostname"])}
              name="hostname"
              required
            />
            <small className="font-normal leading-5 text-[var(--console-ink-muted)]">
              服务端会统一规范化并验证 DNS 主机名、唯一性和站点租户一致性。
            </small>
          </label>
          <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
            所属站点
            <select
              className="gf-console-focus h-11 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3.5 text-base text-[var(--console-ink)] outline-none disabled:cursor-not-allowed disabled:opacity-60"
              defaultValue={relationId(document["site"])}
              disabled={sites.length === 0}
              name="site"
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
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
              域名角色
              <select
                className="gf-console-focus h-11 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3.5 text-base text-[var(--console-ink)] outline-none"
                defaultValue={stringValue(document["role"], "canonical")}
                name="role"
              >
                <option value="canonical">规范域名</option>
                <option value="alias">别名</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
              状态
              <select
                className="gf-console-focus h-11 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3.5 text-base text-[var(--console-ink)] outline-none"
                defaultValue={stringValue(document["status"], "active")}
                name="status"
              >
                <option value="active">启用</option>
                <option value="disabled">停用</option>
              </select>
            </label>
          </div>
        </>
      )}
      {error !== null && (
        <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm leading-6 text-rose-700" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-3 border-t border-[var(--console-border)] pt-5">
        <a
          className="gf-console-focus inline-flex h-11 items-center justify-center rounded-xl border border-[var(--console-border)] bg-[var(--console-surface)] px-4 text-sm font-semibold text-[var(--console-ink)] no-underline hover:bg-[var(--console-surface-muted)]"
          href={consoleRoute.document(slug, id)}
        >
          取消
        </a>
        <button
          className="gf-console-focus inline-flex h-11 items-center justify-center rounded-xl bg-[var(--console-accent)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--console-accent-hover)] disabled:cursor-wait disabled:opacity-60"
          disabled={loading || (slug === "domains" && sites.length === 0)}
          type="submit"
        >
          {loading ? "正在保存…" : "保存更改"}
        </button>
      </div>
    </form>
  )
}
