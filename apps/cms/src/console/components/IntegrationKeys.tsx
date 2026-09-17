"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { AlertTriangleIcon, CopyIcon, KeyRoundIcon, PlusIcon, TrashIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"

type CredentialRow = Readonly<Record<string, unknown>>

type IdentityRow = Readonly<Record<string, unknown>>

type IntegrationKeysProps = {
  readonly canManage: boolean
  readonly credentials: readonly CredentialRow[]
  readonly identities: readonly IdentityRow[]
}

const STATUS_LABEL: Readonly<Record<string, string>> = {
  active: "启用中",
  expired: "已过期",
  revoked: "已吊销",
}

const STATUS_TONE: Readonly<Record<string, string>> = {
  active: "bg-emerald-500",
  expired: "bg-amber-500",
  revoked: "bg-slate-400",
}

const dateLabel = (value: unknown): string => {
  if (typeof value !== "string") return "从未使用"
  const date = new Date(value)
  return Number.isNaN(date.valueOf())
    ? "从未使用"
    : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date)
}

export const IntegrationKeys = ({ canManage, credentials, identities }: IntegrationKeysProps) => {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [issuedKey, setIssuedKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const issue = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = String(form.get("name") ?? "").trim()
    const userId = String(form.get("userId") ?? "").trim()
    const expiresAt = String(form.get("expiresAt") ?? "").trim()
    if (name.length === 0 || userId.length === 0) {
      setError("请填写密钥名称并选择一个自动化身份。")
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch("/api/api-credentials", {
        body: JSON.stringify({
          name,
          userId: Number(userId),
          ...(expiresAt.length > 0
            ? { expiresAt: new Date(`${expiresAt}T23:59:59Z`).toISOString() }
            : {}),
        }),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      if (!response.ok) {
        setError("签发失败。请确认所选身份属于当前租户，且有效期晚于今天。")
        return
      }
      const payload = (await response.json()) as { readonly apiKey?: string }
      setIssuedKey(payload.apiKey ?? null)
      setCopied(false)
      event.currentTarget.reset()
      startTransition(() => router.refresh())
    } catch {
      setError("暂时无法连接到服务，请稍后重试。")
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (id: unknown, name: unknown) => {
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      const response = await fetch(
        `/api/api-credentials/${encodeURIComponent(String(id))}/revoke`,
        {
          credentials: "same-origin",
          method: "POST",
        },
      )
      if (!response.ok) {
        setError("吊销失败。该密钥可能已经被吊销。")
        return
      }
      setNotice(`已吊销「${String(name)}」，下一次请求起立即失效。`)
      startTransition(() => router.refresh())
    } catch {
      setError("暂时无法连接到服务，请稍后重试。")
    } finally {
      setBusy(false)
    }
  }

  const copyKey = async () => {
    if (issuedKey === null) return
    try {
      await navigator.clipboard.writeText(issuedKey)
      setCopied(true)
    } catch {
      setError("浏览器拒绝了剪贴板访问，请手动选中复制。")
    }
  }

  return (
    <div className="grid gap-6 [&>*]:min-w-0">
      {issuedKey !== null ? (
        <section className="gf-console-card grid gap-3 border-2 border-emerald-500/60 p-5 sm:p-6">
          <h2 className="m-0 flex items-center gap-2 text-base font-semibold tracking-tight text-[var(--console-ink)]">
            <KeyRoundIcon />
            密钥已生成，请立即复制
          </h2>
          <p className="m-0 text-sm leading-6 text-[var(--console-ink-muted)]">
            这是这把密钥唯一一次完整显示。关闭后服务端只保留校验索引，无法再次查看；遗失只能吊销重建。
          </p>
          <code className="block overflow-x-auto rounded-xl bg-slate-900 p-4 font-mono text-sm text-slate-100">
            {issuedKey}
          </code>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={copyKey} size="sm" type="button">
              <CopyIcon />
              {copied ? "已复制" : "复制密钥"}
            </Button>
            <Button
              onClick={() => {
                setIssuedKey(null)
                setCopied(false)
              }}
              size="sm"
              type="button"
              variant="secondary"
            >
              我已保存，关闭
            </Button>
          </div>
        </section>
      ) : null}

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
            新建密钥
          </h2>
          {identities.length === 0 ? (
            <p className="m-0 text-sm leading-6 text-[var(--console-ink-muted)]">
              当前租户还没有「自动化投稿」身份。请先到「用户」页面新建一个角色为
              <strong>自动化投稿</strong>的用户，再回来为它签发密钥。
            </p>
          ) : (
            <form
              className="grid gap-3 sm:grid-cols-[2fr_2fr_1fr_auto] sm:items-end"
              onSubmit={issue}
            >
              <label className="grid gap-1.5 text-sm text-[var(--console-ink-muted)]">
                密钥名称
                <input
                  className="h-9 rounded-md border border-[var(--console-border)] bg-[var(--console-surface)] px-3 text-sm text-[var(--console-ink)]"
                  maxLength={200}
                  name="name"
                  placeholder="例如：n8n 自动投稿"
                  required
                  type="text"
                />
              </label>
              <label className="grid gap-1.5 text-sm text-[var(--console-ink-muted)]">
                自动化身份
                <select
                  className="h-9 rounded-md border border-[var(--console-border)] bg-[var(--console-surface)] px-3 text-sm text-[var(--console-ink)]"
                  name="userId"
                  required
                >
                  {identities.map((identity) => (
                    <option key={String(identity["id"])} value={String(identity["id"])}>
                      {String(identity["email"])}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-sm text-[var(--console-ink-muted)]">
                有效期至（可选）
                <input
                  className="h-9 rounded-md border border-[var(--console-border)] bg-[var(--console-surface)] px-3 text-sm text-[var(--console-ink)]"
                  name="expiresAt"
                  type="date"
                />
              </label>
              <Button disabled={busy} type="submit">
                <PlusIcon />
                签发
              </Button>
            </form>
          )}
        </section>
      ) : null}

      <section className="gf-console-card grid gap-4 p-5 sm:p-6">
        <h2 className="m-0 text-base font-semibold tracking-tight text-[var(--console-ink)]">
          已签发的密钥
        </h2>
        {credentials.length === 0 ? (
          <p className="m-0 text-sm leading-6 text-[var(--console-ink-muted)]">
            还没有签发过任何集成密钥。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--console-ink-muted)]">
                  <th className="pb-2 pr-4 font-medium">名称</th>
                  <th className="pb-2 pr-4 font-medium">前缀</th>
                  <th className="pb-2 pr-4 font-medium">最后使用</th>
                  <th className="pb-2 pr-4 font-medium">状态</th>
                  {canManage ? <th className="pb-2 font-medium">操作</th> : null}
                </tr>
              </thead>
              <tbody>
                {credentials.map((credential) => {
                  const status = String(credential["status"] ?? "active")
                  return (
                    <tr
                      className="border-t border-[var(--console-border)] text-[var(--console-ink)]"
                      key={String(credential["id"])}
                    >
                      <td className="py-3 pr-4">{String(credential["name"])}</td>
                      <td className="py-3 pr-4 font-mono text-xs text-[var(--console-ink-muted)]">
                        {String(credential["keyPrefix"])}…
                      </td>
                      <td className="py-3 pr-4 text-[var(--console-ink-muted)]">
                        {dateLabel(credential["lastUsedAt"])}
                      </td>
                      <td className="py-3 pr-4">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className={`inline-block size-2 rounded-full ${STATUS_TONE[status] ?? "bg-slate-400"}`}
                          />
                          {STATUS_LABEL[status] ?? status}
                        </span>
                      </td>
                      {canManage ? (
                        <td className="py-3">
                          {status === "revoked" ? null : (
                            <Button
                              disabled={busy}
                              onClick={() => void revoke(credential["id"], credential["name"])}
                              size="xs"
                              type="button"
                              variant="destructive"
                            >
                              <TrashIcon />
                              吊销
                            </Button>
                          )}
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
