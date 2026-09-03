"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

/**
 * Self-service password change form — POST /api/users/me/password. The server
 * re-verifies the current password through the login credential path, so this
 * form sends all three fields and maps the endpoint's error codes to copy.
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
  const [notice, setNotice] = useState<{ readonly ok: boolean; readonly text: string } | null>(
    null,
  )

  const submit = async () => {
    if (newPassword !== confirmPassword) {
      setNotice({ ok: false, text: "两次输入的新密码不一致。" })
      return
    }
    setPending(true)
    setNotice(null)
    try {
      const response = await fetch("/api/users/me/password", {
        body: JSON.stringify({ currentPassword, newPassword }),
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

  const canSubmit =
    !pending &&
    currentPassword.length > 0 &&
    newPassword.length >= 8 &&
    confirmPassword.length > 0

  return (
    <div className="grid max-w-md gap-4 border-t border-[var(--console-border)] pt-5">
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
          onChange={(event) => setConfirmPassword(event.target.value)}
          type="password"
          value={confirmPassword}
        />
      </label>
      <Button
        className="gf-console-focus"
        disabled={!canSubmit}
        onClick={() => void submit()}
        size="lg"
        type="button"
      >
        {pending ? "提交中…" : "更新密码"}
      </Button>
    </div>
  )
}

export default ConsolePasswordForm
