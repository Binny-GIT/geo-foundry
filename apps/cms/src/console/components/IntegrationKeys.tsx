"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import {
  AlertTriangleIcon,
  ChevronDownIcon,
  CopyIcon,
  HelpCircleIcon,
  KeyRoundIcon,
  PlusIcon,
  TrashIcon,
} from "@/components/icons"
import { Button } from "@/components/ui/button"

type CredentialRow = Readonly<Record<string, unknown>>

type IdentityRow = Readonly<Record<string, unknown>>

type SiteOption = {
  readonly id: number
  readonly name: string
}

type IntegrationKeysProps = {
  /** admin 代签可选的 automation 身份；普通用户视角为空数组。 */
  readonly adminIdentities: readonly IdentityRow[]
  /** 是否具备代签能力（users 资源 create）。 */
  readonly canDelegate: boolean
  /** server 已按视角过滤：admin 见本租户全部，普通用户只见自己的。 */
  readonly credentials: readonly CredentialRow[]
  /** 本租户可选的默认站点（各真人角色对站点均只读可见）。 */
  readonly siteOptions: readonly SiteOption[]
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

const inputClass =
  "gf-console-focus h-10 rounded-md border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3 text-sm text-[var(--console-ink)] outline-none"

export const IntegrationKeys = ({
  adminIdentities,
  canDelegate,
  credentials,
  siteOptions,
  viewerIsService,
}: IntegrationKeysProps) => {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [issuedKey, setIssuedKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

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
    const defaultSiteId = String(data.get("defaultSiteId") ?? "").trim()
    const expiresAt = String(data.get("expiresAt") ?? "").trim()
    if (name.length === 0) return
    await issue(
      {
        name,
        ...(defaultSiteId.length > 0 ? { defaultSiteId: Number(defaultSiteId) } : {}),
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
    const data = new FormData(form)
    const name = String(data.get("name") ?? "").trim()
    const userId = String(data.get("userId") ?? "").trim()
    const defaultSiteId = String(data.get("defaultSiteId") ?? "").trim()
    const expiresAt = String(data.get("expiresAt") ?? "").trim()
    if (name.length === 0 || userId.length === 0) {
      setError("请填写密钥名称并选择一个自动化身份。")
      return
    }
    await issue(
      {
        name,
        userId: Number(userId),
        ...(defaultSiteId.length > 0 ? { defaultSiteId: Number(defaultSiteId) } : {}),
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

  const helpButton = (
    <Button
      aria-expanded={showHelp}
      aria-label="集成密钥说明"
      onClick={() => setShowHelp(!showHelp)}
      size="md"
      type="button"
      variant="secondary"
    >
      <HelpCircleIcon size={15} />
      说明
    </Button>
  )

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

      <section className="gf-console-card overflow-hidden">
        {viewerIsService ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--console-border)] px-5 py-4">
            <p className="m-0 text-sm leading-6 text-[var(--console-ink-muted)]">
              集成密钥跟真人走，机器身份不签发个人密钥；请用个人账号登录后创建。
            </p>
            {helpButton}
          </div>
        ) : (
          <form
            className="grid gap-3 border-b border-[var(--console-border)] px-5 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_170px_auto_auto] lg:items-center"
            onSubmit={issueSelf}
          >
            <input
              aria-label="密钥名称"
              className={inputClass}
              maxLength={200}
              name="name"
              placeholder="新建密钥，如：我的 n8n 采集流"
              required
              type="text"
            />
            <select aria-label="默认站点（可选）" className={inputClass} name="defaultSiteId">
              <option value="">默认站点：不设</option>
              {siteOptions.map((site) => (
                <option key={site.id} value={String(site.id)}>
                  {site.name}
                </option>
              ))}
            </select>
            <input
              aria-label="有效期至（可选）"
              className={inputClass}
              name="expiresAt"
              type="date"
            />
            <Button disabled={busy} type="submit">
              <PlusIcon size={15} />
              创建
            </Button>
            {helpButton}
          </form>
        )}

        {showHelp ? (
          <div className="grid gap-1.5 border-b border-[var(--console-border)] bg-[var(--console-surface-muted)] px-5 py-4 text-sm leading-6 text-[var(--console-ink-muted)]">
            <p className="m-0">
              <strong className="text-[var(--console-ink)]">密钥跟创建者走。</strong>
              用它投稿的素材记在你名下，采纳成文章后作者归属是你，并标注「AI 生成」来源。
            </p>
            <p className="m-0">
              <strong className="text-[var(--console-ink)]">只有投稿权限。</strong>
              密钥只能把素材投进稿源收件箱，不能采纳成文章，也不能编辑、流转或发布任何内容——
              采纳与发布始终是工作台里的人工决定。明文只显示一次，可随时吊销。
            </p>
            <p className="m-0">
              请求头格式：
              <code className="rounded bg-[var(--console-surface)] px-1.5 py-0.5 font-mono text-xs text-[var(--console-ink)]">
                Authorization: users API-Key gfa_…
              </code>
              　完整接入说明与 curl 示例见
              <Link
                className="gf-console-focus font-medium text-[var(--console-accent)] underline"
                href="/admin/integration-docs"
              >
                集成文档
              </Link>
              。
            </p>
          </div>
        ) : null}

        {canDelegate ? (
          <details className="group border-b border-[var(--console-border)]">
            <summary className="flex cursor-pointer select-none list-none items-center gap-1.5 px-5 py-3 text-sm text-[var(--console-ink-muted)] hover:text-[var(--console-ink)] [&>svg]:transition-transform group-open:[&>svg]:rotate-180">
              <ChevronDownIcon size={14} />
              管理员代签 · 为共享「自动化投稿」身份签发密钥
            </summary>
            {adminIdentities.length === 0 ? (
              <p className="m-0 px-5 pb-4 text-sm leading-6 text-[var(--console-ink-muted)]">
                当前租户还没有「自动化投稿」身份。需要共享身份时，可先到「用户」页新建一个角色为
                <strong>自动化投稿</strong>的用户，再回来为它代签。
              </p>
            ) : (
              <form
                className="grid gap-3 px-5 pb-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_170px_auto] lg:items-center"
                onSubmit={issueDelegate}
              >
                <input
                  aria-label="密钥名称"
                  className={inputClass}
                  maxLength={200}
                  name="name"
                  placeholder="密钥名称，如：共享 RSS 投稿"
                  required
                  type="text"
                />
                <select aria-label="自动化身份" className={inputClass} name="userId" required>
                  {adminIdentities.map((identity) => (
                    <option key={String(identity["id"])} value={String(identity["id"])}>
                      {String(identity["email"])}
                    </option>
                  ))}
                </select>
                <select aria-label="默认站点（可选）" className={inputClass} name="defaultSiteId">
                  <option value="">默认站点：不设</option>
                  {siteOptions.map((site) => (
                    <option key={site.id} value={String(site.id)}>
                      {site.name}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="有效期至（可选）"
                  className={inputClass}
                  name="expiresAt"
                  type="date"
                />
                <Button disabled={busy} type="submit">
                  <PlusIcon size={15} />
                  代签
                </Button>
              </form>
            )}
          </details>
        ) : null}

        {credentials.length === 0 ? (
          <div className="grid min-h-64 place-items-center px-5 text-center">
            <div className="grid max-w-sm gap-2">
              <strong className="text-sm text-[var(--console-ink)]">
                {canDelegate ? "租户内还没有签发过密钥" : "你还没有签发过密钥"}
              </strong>
              <span className="text-sm leading-6 text-[var(--console-ink-muted)]">
                在上方填一个名称即可创建；密钥交给 n8n / Dify
                等自动化工具，用来把采集的素材投进稿源收件箱。
              </span>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead className="bg-[var(--console-surface-muted)]">
                <tr>
                  {[
                    "名称",
                    ...(canDelegate ? ["归属"] : []),
                    "默认站点",
                    "前缀",
                    "最后使用",
                    "状态",
                  ].map((label) => (
                    <th
                      className="whitespace-nowrap border-b border-[var(--console-border)] px-5 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--console-ink-muted)]"
                      key={label}
                      scope="col"
                    >
                      {label}
                    </th>
                  ))}
                  <th
                    aria-label="操作"
                    className="border-b border-[var(--console-border)] px-5 py-3"
                    scope="col"
                  />
                </tr>
              </thead>
              <tbody>
                {credentials.map((credential, index) => {
                  const status = String(credential["status"] ?? "active")
                  return (
                    <tr
                      className="gf-row transition-colors hover:bg-[var(--console-surface-muted)]"
                      key={String(credential["id"])}
                      style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
                    >
                      <td className="max-w-[280px] border-b border-[var(--console-border)] px-5 py-4 text-sm font-semibold text-[var(--console-ink)]">
                        <span className="block truncate">{String(credential["name"])}</span>
                      </td>
                      {canDelegate ? (
                        <td className="border-b border-[var(--console-border)] px-5 py-4 text-sm text-[var(--console-ink-muted)]">
                          {typeof credential["ownerEmail"] === "string"
                            ? credential["ownerEmail"]
                            : `#${String(credential["user"])}`}
                        </td>
                      ) : null}
                      <td className="border-b border-[var(--console-border)] px-5 py-4 text-sm text-[var(--console-ink-muted)]">
                        {typeof credential["defaultSiteName"] === "string" ? (
                          credential["defaultSiteName"]
                        ) : (
                          <span title="投稿需显式带 suggestedSiteId">—</span>
                        )}
                      </td>
                      <td className="border-b border-[var(--console-border)] px-5 py-4 font-mono text-xs text-[var(--console-ink-muted)]">
                        {String(credential["keyPrefix"])}…
                      </td>
                      <td className="border-b border-[var(--console-border)] px-5 py-4 text-sm text-[var(--console-ink-muted)]">
                        {dateLabel(credential["lastUsedAt"])}
                      </td>
                      <td className="border-b border-[var(--console-border)] px-5 py-4 text-sm text-[var(--console-ink)]">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className={`inline-block size-2 rounded-full ${STATUS_TONE[status] ?? "bg-slate-400"}`}
                          />
                          {STATUS_LABEL[status] ?? status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap border-b border-[var(--console-border)] px-5 py-4">
                        {status === "revoked" ? null : (
                          <Button
                            disabled={busy}
                            onClick={() => void revoke(credential["id"], credential["name"])}
                            size="xs"
                            type="button"
                            variant="destructive"
                          >
                            <TrashIcon size={13} />
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
