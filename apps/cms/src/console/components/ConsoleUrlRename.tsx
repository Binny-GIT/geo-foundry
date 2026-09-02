"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

import { consoleRoute } from "../lib/resources"

type RenameProps = {
  readonly id: number | string
  readonly initialLocale: string
  readonly initialPathname: string
}

const messageFor = (code: unknown): string => {
  switch (code) {
    case "URL_RECORD_RENAME_FORBIDDEN":
      return "当前角色没有重命名 URL 的权限。"
    case "URL_RECORD_TENANT_MISMATCH":
      return "该 URL 不属于当前租户。"
    case "URL_RECORD_RENAME_BODY_INVALID":
      return "请填写有效的语言和以 / 开头的路径。"
    case "URL_RECORD_RESERVED_PATH":
      return "该路径为系统保留路径，不能使用。"
    case "URL_RECORD_PATH_CONFLICT":
      return "该站点和语言下的路径已存在。"
    default:
      return "重命名失败，请刷新后重试。"
  }
}

export const ConsoleUrlRename = ({ id, initialLocale, initialPathname }: RenameProps) => {
  const [error, setError] = useState<string | null>(null)
  const [locale, setLocale] = useState(initialLocale)
  const [loading, setLoading] = useState(false)
  const [pathname, setPathname] = useState(initialPathname)

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const response = await fetch(
        `/api/url-record-operations/${encodeURIComponent(String(id))}/rename`,
        {
          body: JSON.stringify({ locale, pathname }),
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      )
      const body = (await response.json().catch(() => ({}))) as { error?: { code?: unknown } }
      if (!response.ok) {
        setError(messageFor(body.error?.code))
        return
      }
      window.location.assign(consoleRoute.document("url-records", id))
    } catch {
      setError("暂时无法连接到服务，请稍后重试。")
    } finally {
      setLoading(false)
    }
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
        语言
        <input
          className="gf-console-focus h-10 rounded-md border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3 text-sm text-[var(--console-ink)] outline-none"
          maxLength={64}
          onChange={(event) => setLocale(event.target.value)}
          required
          value={locale}
        />
      </label>
      <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
        路径
        <input
          className="gf-console-focus h-10 rounded-md border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3 text-sm text-[var(--console-ink)] outline-none"
          maxLength={2000}
          onChange={(event) => setPathname(event.target.value)}
          placeholder="/example"
          required
          value={pathname}
        />
      </label>
      {error !== null && (
        <p
          className="m-0 rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700"
          role="alert"
        >
          {error}
        </p>
      )}
      <Button disabled={loading} type="submit">
        {loading ? "正在提交…" : "提交受控重命名"}
      </Button>
    </form>
  )
}
