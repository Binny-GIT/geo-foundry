"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

export const ConsoleForgotPasswordForm = () => {
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const response = await fetch("/api/users/forgot-password", {
        body: JSON.stringify({ email }),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      if (!response.ok) {
        setError("暂时无法处理密码重置请求，请稍后重试。")
        return
      }
      setSent(true)
    } catch {
      setError("暂时无法连接到服务，请稍后重试。")
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <p className="m-0 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-800">
        如果该邮箱属于有效账户，密码重置说明已发送。请检查邮箱并按照邮件中的安全链接继续操作。
      </p>
    )
  }

  return (
    <form className="grid gap-5" method="post" onSubmit={submit}>
      <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
        账户邮箱
        <input
          autoComplete="email"
          className="gf-console-focus h-11 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3.5 text-base text-[var(--console-ink)] outline-none"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>
      {error !== null && (
        <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-700" role="alert">
          {error}
        </p>
      )}
      <Button
        aria-label="Send password reset"
        className="w-full disabled:cursor-wait"
        disabled={loading}
        size="lg"
        type="submit"
      >
        {loading ? "正在发送…" : "发送密码重置说明"}
      </Button>
    </form>
  )
}
