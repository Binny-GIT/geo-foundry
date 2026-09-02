"use client"

import { useState } from "react"

import { PlusIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"

import { consoleRoute } from "../lib/resources"

type EndpointError = { readonly error?: { readonly code?: unknown } }

const messageFor = (code: unknown): string => {
  switch (code) {
    case "ROLLBACK_INTENT_BODY_INVALID":
      return "请填写完整的 release ID、站点 ID 和 64 位小写 SHA-256 摘要。"
    case "ROLLBACK_RELEASE_STATE_MISMATCH":
      return "当前 release 状态或预条件已发生变化，请刷新后重新确认。"
    case "ROLLBACK_INTENT_FORBIDDEN":
      return "只有发布者角色可以创建回滚意图。"
    default:
      return "回滚意图未能创建，请刷新后重试。"
  }
}

const string = (form: FormData, name: string) => String(form.get(name) ?? "").trim()

export const ConsoleRollbackIntentForm = () => {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const siteId = Number(string(form, "siteId"))
    setError(null)
    setLoading(true)
    try {
      const response = await fetch("/api/rollback-operations/intents", {
        body: JSON.stringify({
          expectedCurrentManifestSha256: string(form, "expectedCurrentManifestSha256"),
          expectedCurrentReleaseId: string(form, "expectedCurrentReleaseId"),
          expectedManifestSha256: string(form, "expectedManifestSha256"),
          reason: string(form, "reason") || undefined,
          siteId,
          targetReleaseId: string(form, "targetReleaseId"),
        }),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      const body = (await response.json().catch(() => ({}))) as EndpointError & {
        readonly id?: string | number
      }
      if (!response.ok) {
        setError(messageFor(body.error?.code))
        return
      }
      window.location.assign(
        body.id === undefined
          ? consoleRoute.collection("rollback-intents")
          : consoleRoute.document("rollback-intents", body.id),
      )
    } catch {
      setError("暂时无法连接到服务，请稍后重试。")
    } finally {
      setLoading(false)
    }
  }

  return (
    <form className="grid gap-5" onSubmit={submit}>
      <p className="m-0 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
        回滚会提交一条不可变、可审计的命令意图，而非直接切换发布指针。请从当前 release
        详情中准确复制预条件；服务端会在创建时再次核验。
      </p>
      <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
        站点 ID
        <input
          className="gf-console-focus h-11 rounded-md border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3.5 text-base text-[var(--console-ink)] outline-none"
          inputMode="numeric"
          min="1"
          name="siteId"
          placeholder="例如：377"
          required
          type="number"
        />
      </label>
      <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
        当前 release ID
        <input
          className="gf-console-focus h-11 rounded-md border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3.5 font-mono text-sm text-[var(--console-ink)] outline-none"
          name="expectedCurrentReleaseId"
          required
        />
      </label>
      <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
        当前 manifest SHA-256
        <input
          className="gf-console-focus h-11 rounded-md border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3.5 font-mono text-sm text-[var(--console-ink)] outline-none"
          maxLength={64}
          name="expectedCurrentManifestSha256"
          pattern="[0-9a-f]{64}"
          required
        />
      </label>
      <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
        目标 release ID
        <input
          className="gf-console-focus h-11 rounded-md border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3.5 font-mono text-sm text-[var(--console-ink)] outline-none"
          name="targetReleaseId"
          required
        />
      </label>
      <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
        目标 manifest SHA-256
        <input
          className="gf-console-focus h-11 rounded-md border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3.5 font-mono text-sm text-[var(--console-ink)] outline-none"
          maxLength={64}
          name="expectedManifestSha256"
          pattern="[0-9a-f]{64}"
          required
        />
      </label>
      <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
        回滚原因（可选）
        <textarea
          className="gf-console-focus min-h-24 resize-y rounded-md border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3.5 py-3 text-base leading-6 text-[var(--console-ink)] outline-none"
          maxLength={500}
          name="reason"
        />
      </label>
      {error !== null && (
        <p
          className="m-0 rounded-md border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm leading-6 text-rose-700"
          role="alert"
        >
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-3 border-t border-[var(--console-border)] pt-5">
        <Button asChild size="lg" variant="secondary">
          <a href={consoleRoute.collection("rollback-intents")}>取消</a>
        </Button>
        <Button
          className="disabled:cursor-wait"
          disabled={loading}
          size="lg"
          type="submit"
          variant="danger"
        >
          <PlusIcon size={15} />
          {loading ? "正在提交…" : "创建回滚意图"}
        </Button>
      </div>
    </form>
  )
}
