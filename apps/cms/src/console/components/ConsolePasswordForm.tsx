"use client"

import { type FormEvent, useState } from "react"

import { Button } from "@/components/ui/button"

/**
 * Self-service password change form — POST /api/account/password. The server
 * re-verifies the current password through the login credential path, so this
 * form sends all three fields and maps the endpoint's error codes to copy.
 *
 * The submit button is never greyed out by validation: validation feedback on
 * click (or Enter) tells the operator exactly what is missing, and values are
 * read from the DOM on submit so browser autofill — which does not always
 * fire React onChange — still works.
 */
const ERROR_COPY: Readonly<Record<string, string>> = {
  ACCOUNT_PASSWORD_BODY_INVALID: "输入无效：新密码至少 8 位，且各项不超过 200 字符。",
  ACCOUNT_PASSWORD_CURRENT_INVALID: "当前密码不正确。",
  ACCOUNT_PASSWORD_ROLE_FORBIDDEN: "当前身份不允许在此修改密码。",
  ACCOUNT_PASSWORD_UNAUTHENTICATED: "登录状态已失效，请重新登录后再试。",
}

const inputClass =
  "gf-console-focus h-11 w-full rounded-md border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3.5 text-base text-[var(--console-ink)] outline-none"

const ConsolePasswordForm = () => {
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<{ readonly ok: boolean; readonly text: string } | null>(null)

  const fail = (text: string) => {
    setNotice({ ok: false, text })
  }

  const submit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    // DOM-first read: autofilled values are in the inputs even when the
    // controlled state never heard about them.
    const form = event?.currentTarget
    const valueOf = (name: string, state: string): string => {
      const field = form?.elements.namedItem(name)
      return field instanceof HTMLInputElement && field.value.length > 0 ? field.value : state
    }
    const current = valueOf("currentPassword", currentPassword)
    const next = valueOf("newPassword", newPassword)
    const confirm = valueOf("confirmPassword", confirmPassword)

    if (current.length === 0) return fail("请先输入当前密码。")
    if (next.length < 8) return fail(`新密码至少 8 位，当前只有 ${String(next.length)} 位。`)
    if (next !== confirm) return fail("两次输入的新密码不一致。")

    setPending(true)
    setNotice(null)
    try {
      const response = await fetch("/api/account/password", {
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      const result = (await response.json().catch(() => ({}))) as { error?: { code?: unknown } }
      if (!response.ok) {
        const code = typeof result.error?.code === "string" ? result.error.code : ""
        throw new Error(ERROR_COPY[code] ?? "修改失败，请稍后重试。")
      }
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
      setNotice({ ok: true, text: "密码已更新；下次登录请使用新密码。" })
    } catch (error) {
      setNotice({
        ok: false,
        text: error instanceof Error ? error.message : "修改失败，请稍后重试。",
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      className="grid max-w-md gap-4 border-t border-[var(--console-border)] pt-5"
      onSubmit={(event) => void submit(event)}
    >
      {notice !== null && (
        <p
          className={`m-0 rounded-md border px-3.5 py-2.5 text-sm ${
            notice.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
          role="status"
        >
          {notice.text}
        </p>
      )}
      <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
        当前密码
        <input
          autoComplete="current-password"
          className={inputClass}
          name="currentPassword"
          onChange={(event) => setCurrentPassword(event.target.value)}
          type="password"
          value={currentPassword}
        />
      </label>
      <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
        新密码（至少 8 位）
        <input
          autoComplete="new-password"
          className={inputClass}
          minLength={8}
          name="newPassword"
          onChange={(event) => setNewPassword(event.target.value)}
          type="password"
          value={newPassword}
        />
      </label>
      <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
        确认新密码
        <input
          autoComplete="new-password"
          className={inputClass}
          minLength={8}
          name="confirmPassword"
          onChange={(event) => setConfirmPassword(event.target.value)}
          type="password"
          value={confirmPassword}
        />
      </label>
      {/* type="submit" routes through the form onSubmit so DOM (autofill)
       * values are read alongside controlled state. */}
      <Button disabled={pending} size="lg" type="submit">
        {pending ? "提交中…" : "更新密码"}
      </Button>
    </form>
  )
}

export default ConsolePasswordForm
