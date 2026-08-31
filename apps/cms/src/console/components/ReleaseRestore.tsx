"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

/**
 * Business-language rollback entry: the publisher picks a historical release
 * row and this control submits the same protected rollback intent endpoint
 * with fully prefilled CAS preconditions. No hand-typed IDs or hashes.
 */
export const ReleaseRestore = ({
  current,
  reasonHint,
  siteId,
  target,
}: {
  readonly current: { readonly manifestSha256: string; readonly releaseId: string }
  readonly reasonHint: string
  readonly siteId: number
  readonly target: { readonly manifestSha256: string; readonly releaseId: string }
}) => {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const submit = async () => {
    const normalized = reason.trim()
    if (normalized.length === 0) {
      setNotice("请填写恢复原因（会写入审计记录）。")
      return
    }
    setPending(true)
    setNotice(null)
    try {
      const response = await fetch("/api/rollback-operations/intents", {
        body: JSON.stringify({
          expectedCurrentManifestSha256: current.manifestSha256,
          expectedCurrentReleaseId: current.releaseId,
          expectedManifestSha256: target.manifestSha256,
          reason: normalized,
          siteId,
          targetReleaseId: target.releaseId,
        }),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      const body = (await response.json().catch(() => ({}))) as { error?: { code?: string } }
      if (!response.ok) {
        setNotice(
          body.error?.code === "ROLLBACK_RELEASE_STATE_MISMATCH"
            ? "当前发布版本已发生变化，请刷新后重试。"
            : "恢复请求未能创建，请刷新后重试。",
        )
        return
      }
      setOpen(false)
      setReason("")
      setNotice(null)
      router.refresh()
    } catch {
      setNotice("暂时无法连接到服务，请稍后重试。")
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <button
        className="gf-console-focus h-8 rounded-lg border border-[var(--console-border)] bg-[var(--console-surface)] px-2.5 text-[11px] font-semibold text-[var(--console-ink)] hover:bg-[var(--console-surface-muted)]"
        onClick={() => setOpen(true)}
        title={reasonHint}
        type="button"
      >
        恢复到此版本
      </button>
      {open && (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4"
          role="dialog"
        >
          <div className="w-full max-w-md rounded-2xl border border-[var(--console-border)] bg-[var(--console-surface)] p-6 shadow-2xl">
            <h2 className="m-0 text-xl font-bold tracking-tight text-[var(--console-ink)]">
              恢复到历史发布版本
            </h2>
            <p className="m-0 mt-2 text-sm leading-6 text-[var(--console-ink-muted)]">
              目标版本 <span className="font-mono">{target.releaseId.slice(0, 18)}…</span>。
              回滚只切换发布指针，不重新编译；操作会写入不可变审计记录。
            </p>
            <label className="mt-4 block">
              <span className="text-sm font-bold text-[var(--console-ink)]">恢复原因 *</span>
              <textarea
                className="mt-2 min-h-24 w-full resize-y rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] p-3 text-sm text-[var(--console-ink)]"
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
                value={reason}
              />
            </label>
            {notice !== null && (
              <p className="m-0 mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
                {notice}
              </p>
            )}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                className="h-11 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-4 text-sm font-semibold text-[var(--console-ink)]"
                disabled={pending}
                onClick={() => setOpen(false)}
                type="button"
              >
                取消
              </button>
              <button
                className="h-11 rounded-xl bg-rose-600 px-4 text-sm font-semibold text-white disabled:opacity-70"
                disabled={pending}
                onClick={() => void submit()}
                type="button"
              >
                {pending ? "提交中…" : "确认恢复"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default ReleaseRestore
