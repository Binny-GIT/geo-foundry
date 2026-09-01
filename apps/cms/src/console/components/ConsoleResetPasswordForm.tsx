"use client"

import { useSearchParams } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"

export const ConsoleResetPasswordForm = () => {
  const params = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [password, setPassword] = useState("")
  const token = params.get("token") ?? ""

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    if (token.length === 0) {
      setError("重置链接缺少安全令牌，请重新请求密码重置。")
      return
    }
    setLoading(true)
    try {
      const response = await fetch("/api/users/reset-password", {
        body: JSON.stringify({ password, token }),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      if (!response.ok) {
        setError("重置链接无效、已过期，或新密码不符合要求。")
        return
      }
      window.location.assign("/admin")
    } catch {
      setError("暂时无法连接到服务，请稍后重试。")
    } finally {
      setLoading(false)
    }
  }

  return (
    <form className="grid gap-5" method="post" onSubmit={submit}>
      <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
        新密码
        <input
          autoComplete="new-password"
          className="gf-console-focus h-11 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3.5 text-base text-[var(--console-ink)] outline-none"
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>
      {error !== null && (
        <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-700" role="alert">
          {error}
        </p>
      )}
      <Button
        aria-label="Reset password"
        className="w-full disabled:cursor-wait"
        disabled={loading}
        size="lg"
        type="submit"
      >
        {loading ? "正在重置…" : "设置新密码"}
      </Button>
    </form>
  )
}
