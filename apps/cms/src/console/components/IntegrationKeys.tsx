"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { AlertTriangleIcon, CopyIcon, KeyRoundIcon, PlusIcon, TrashIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"

type CredentialRow = Readonly<Record<string, unknown>>

type IdentityRow = Readonly<Record<string, unknown>>

type IntegrationKeysProps = {
  /** admin 代签可选的 automation 身份；普通用户视角为空数组。 */
  readonly adminIdentities: readonly IdentityRow[]
  /** 是否具备代签能力（users 资源 create）。 */
  readonly canDelegate: boolean
  /** server 已按视角过滤：admin 见本租户全部，普通用户只见自己的。 */
  readonly credentials: readonly CredentialRow[]
  /** automation 身份登录时不出自助表单（密钥只跟真人走）。 */
  readonly viewerIsService: boolean
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

export const IntegrationKeys = ({
  adminIdentities,
  canDelegate,
  credentials,
  viewerIsService,
}: IntegrationKeysProps) => {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [issuedKey, setIssuedKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const issue = async (
    payload: Readonly<Record<string, unknown>>,
    form: HTMLFormElement,
  ): Promise<void> => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch("/api/api-credentials", {
        body: JSON.stringify(payload),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          readonly error?: { readonly code?: string }
        }
        setError(
          body.error?.code === "API_CREDENTIAL_EXPIRY_INVALID"
            ? "签发失败：有效期必须晚于现在。"
            : "签发失败，请稍后重试。",
        )
        return
      }
      const body = (await response.json()) as { readonly apiKey?: string }
      setIssuedKey(body.apiKey ?? null)
      setCopied(false)
      form.reset()
      startTransition(() => router.refresh())
    } catch {
      setError("暂时无法连接到服务，请稍后重试。")
    } finally {
      setBusy(false)
    }
  }

  const issueSelf = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const name = String(data.get("name") ?? "").trim()
    const expiresAt = String(data.get("expiresAt") ?? "").trim()
    if (name.length === 0) return
    await issue(
      {
        name,
        ...(expiresAt.length > 0
          ? { expiresAt: new Date(`${expiresAt}T23:59:59Z`).toISOString() }
          : {}),
      },
      form,
    )
  }

  const issueDelegate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const name = String(new FormData(form).get("name") ?? "").trim()
    const userId = String(new FormData(form).get("userId") ?? "").trim()
    const expiresAt = String(new FormData(form).get("expiresAt") ?? "").trim()
    if (name.length === 0 || userId.length === 0) {
      setError("请填写密钥名称并选择一个自动化身份。")
      return
    }
    await issue(
      {
        name,
        userId: Number(userId),
        ...(expiresAt.length > 0
          ? { expiresAt: new Date(`${expiresAt}T23:59:59Z`).toISOString() }
          : {}),
      },
      form,
    )
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

      {viewerIsService ? (
        <section className="gf-console-card grid gap-2 p-5 sm:p-6">
          <h2 className="m-0 text-base font-semibold tracking-tight text-[var(--console-ink)]">
            我的密钥
          </h2>
          <p className="m-0 text-sm leading-6 text-[var(--console-ink-muted)]">
            集成密钥跟真人用户走，用于把自动化工具的投稿归属到人；机器身份不签发个人密钥。请用你的个人账号创建。
          </p>
        </section>
      ) : (
        <section className="gf-console-card grid gap-4 p-5 sm:p-6">
          <div className="grid gap-1">
            <h2 className="m-0 text-base font-semibold tracking-tight text-[var(--console-ink)]">
              我的密钥
            </h2>
            <p className="m-0 text-sm leading-6 text-[var(--console-ink-muted)]">
              为自己创建一把密钥，交给 n8n / Dify /
              脚本等自动化工具。用这把密钥采集的投稿会记在你的名下，采纳成文章后
              <strong>作者归属是你</strong>，并标注「AI 生成」来源。
            </p>
          </div>
          <form
            className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end"
            onSubmit={issueSelf}
          >
            <label className="grid gap-1.5 text-sm text-[var(--console-ink-muted)]">
              密钥名称
              <input
                className="h-9 rounded-md border border-[var(--console-border)] bg-[var(--console-surface)] px-3 text-sm text-[var(--console-ink)]"
                maxLength={200}
                name="name"
                placeholder="例如：我的 n8n 采集流"
                required
                type="text"
              />
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
              创建
            </Button>
          </form>
        </section>
      )}

      {canDelegate ? (
        <section className="gf-console-card grid gap-4 p-5 sm:p-6">
          <div className="grid gap-1">
            <h2 className="m-0 text-base font-semibold tracking-tight text-[var(--console-ink)]">
              管理员代签
            </h2>
            <p className="m-0 text-sm leading-6 text-[var(--console-ink-muted)]">
              为租户内的「自动化投稿」身份代签密钥（兼容共享机器身份的用法）。
            </p>
          </div>
          {adminIdentities.length === 0 ? (
            <p className="m-0 text-sm leading-6 text-[var(--console-ink-muted)]">
              当前租户还没有「自动化投稿」身份。需要共享身份时，可先到「用户」页新建一个角色为
              <strong>自动化投稿</strong>的用户，再回来为它签发密钥。
            </p>
          ) : (
            <form
              className="grid gap-3 sm:grid-cols-[2fr_2fr_1fr_auto] sm:items-end"
              onSubmit={issueDelegate}
            >
              <label className="grid gap-1.5 text-sm text-[var(--console-ink-muted)]">
                密钥名称
                <input
                  className="h-9 rounded-md border border-[var(--console-border)] bg-[var(--console-surface)] px-3 text-sm text-[var(--console-ink)]"
                  maxLength={200}
                  name="name"
                  placeholder="例如：共享 RSS 投稿"
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
                  {adminIdentities.map((identity) => (
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
                代签
              </Button>
            </form>
          )}
        </section>
      ) : null}

      <section className="gf-console-card grid gap-4 p-5 sm:p-6">
        <h2 className="m-0 text-base font-semibold tracking-tight text-[var(--console-ink)]">
          {canDelegate ? "租户内已签发的密钥" : "我已签发的密钥"}
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
                  {canDelegate ? <th className="pb-2 pr-4 font-medium">归属</th> : null}
                  <th className="pb-2 pr-4 font-medium">前缀</th>
                  <th className="pb-2 pr-4 font-medium">最后使用</th>
                  <th className="pb-2 pr-4 font-medium">状态</th>
                  <th className="pb-2 font-medium">操作</th>
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
                      {canDelegate ? (
                        <td className="py-3 pr-4 text-[var(--console-ink-muted)]">
                          {typeof credential["ownerEmail"] === "string"
                            ? credential["ownerEmail"]
                            : `#${String(credential["user"])}`}
                        </td>
                      ) : null}
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
