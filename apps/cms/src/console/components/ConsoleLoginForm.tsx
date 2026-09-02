"use client"

import { useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { normalizeConsoleNext } from "@/console/lib/console-next"

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
      window.location.assign(normalizeConsoleNext(params.get("next")))
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
          className="gf-console-focus h-11 rounded-md border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3.5 text-base text-[var(--console-ink)] outline-none placeholder:text-[var(--console-ink-muted)]"
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
          className="gf-console-focus h-11 rounded-md border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3.5 text-base text-[var(--console-ink)] outline-none placeholder:text-[var(--console-ink-muted)]"
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>
      {error !== null && (
        <p
          className="m-0 rounded-md border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-700"
          role="alert"
        >
          {error}
        </p>
      )}
      <a
        className="gf-console-focus -mt-1 w-fit text-sm font-semibold text-[var(--console-ink-muted)] no-underline hover:text-[var(--console-accent)]"
        href="/admin/forgot-password"
      >
        忘记密码？
      </a>
      <Button
        aria-label="登录"
        className="mt-1 w-full disabled:cursor-wait"
        disabled={loading || !hydrated}
        size="lg"
        type="submit"
      >
        {loading ? "正在登录…" : hydrated ? "登录到管理中心" : "正在准备登录…"}
      </Button>
    </form>
  )
}
