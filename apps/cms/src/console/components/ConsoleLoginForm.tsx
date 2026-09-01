"use client"

import { useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"

const safeNext = (value: string | null): string =>
  value !== null && value.startsWith("/admin") && !value.startsWith("//") ? value : "/admin"

export const ConsoleLoginForm = () => {
  const params = useSearchParams()
  const [hydrated, setHydrated] = useState(false)
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [password, setPassword] = useState("")

  useEffect(() => {
    setHydrated(true)
  }, [])

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const response = await fetch("/api/users/login", {
        body: JSON.stringify({ email, password }),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      if (!response.ok) {
        setError("邮箱或密码不正确，请重试。")
        return
      }
      window.location.assign(safeNext(params.get("next")))
    } catch {
      setError("暂时无法连接到服务，请稍后重试。")
    } finally {
      setLoading(false)
    }
  }

  return (
    <form
      className="grid gap-5"
      data-ready={hydrated ? "true" : "false"}
      method="post"
      onSubmit={submit}
    >
      <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
        邮箱
        <input
          autoComplete="email"
          className="gf-console-focus h-11 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3.5 text-base text-[var(--console-ink)] outline-none placeholder:text-[var(--console-ink-muted)]"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="name@example.com"
          required
          type="email"
          value={email}
        />
      </label>
      <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
        密码
        <input
          autoComplete="current-password"
          className="gf-console-focus h-11 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3.5 text-base text-[var(--console-ink)] outline-none placeholder:text-[var(--console-ink-muted)]"
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>
      {error !== null && (
        <p
          className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-700"
          role="alert"
        >
          {error}
        </p>
      )}
      <a
        className="gf-console-focus -mt-1 w-fit text-sm font-semibold text-indigo-700 no-underline hover:underline dark:text-indigo-300"
        href="/admin/forgot-password"
      >
        忘记密码？
      </a>
      <button
        aria-label="登录"
        className="gf-console-focus mt-1 flex h-11 w-full items-center justify-center rounded-xl bg-[var(--console-accent)] px-4 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition-colors hover:bg-[var(--console-accent-hover)] disabled:cursor-wait disabled:opacity-60"
        disabled={loading || !hydrated}
        type="submit"
      >
        {loading ? "正在登录…" : hydrated ? "登录到管理中心" : "正在准备登录…"}
      </button>
    </form>
  )
}
