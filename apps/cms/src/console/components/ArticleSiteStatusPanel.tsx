"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"

type Option = {
  readonly id: number
  readonly label: string
}

type SiteStatus = {
  readonly lastError: string | null
  readonly pathname: string | null
  readonly publishState: "pending" | "published" | "failed" | "unpublished"
  readonly publishedAt: string | null
  readonly qualityState: "pending" | "running" | "passed" | "failed" | "error"
  readonly releaseId: string | null
  readonly siteId: number
  readonly siteName: string
  readonly url: string | null
  readonly urlState: "reserved" | "active" | "redirected" | "gone" | null
}

const PUBLISH_STATE_LABELS: Readonly<Record<SiteStatus["publishState"], string>> = {
  pending: "待发布",
  published: "已发布",
  failed: "发布失败",
  unpublished: "已撤下",
}

const PUBLISH_STATE_TONES: Readonly<Record<SiteStatus["publishState"], string>> = {
  pending: "bg-amber-50 text-amber-700",
  published: "bg-emerald-50 text-emerald-700",
  failed: "bg-rose-50 text-rose-700",
  unpublished: "bg-[var(--console-surface-muted)] text-[var(--console-ink-muted)]",
}

const QUALITY_STATE_LABELS: Readonly<Record<SiteStatus["qualityState"], string>> = {
  pending: "质量检查待运行",
  running: "质量检查中",
  passed: "质量检查通过",
  failed: "质量检查未通过",
  error: "质量检查出错",
}

const SITE_ACTION_ERRORS: Readonly<Record<string, string>> = {
  EDITION_SITE_ACTOR_INVALID: "服务身份不能执行该操作。",
  EDITION_SITE_ADD_ALREADY_ASSIGNED: "该站点已分配给这篇文章；评估通过后点“发布该站”即可。",
  EDITION_SITE_ADD_ALREADY_PUBLISHED: "该站点已发布，无需重复追加。",
  EDITION_SITE_ADD_NOT_PUBLISHED: "只有已发布的文章才能追加站点。",
  EDITION_SITE_ADD_SITE_NOT_FOUND: "所选站点不存在。",
  EDITION_SITE_ADD_TENANT_MISMATCH: "站点必须属于文章所在租户。",
  EDITION_SITE_REMOVE_ALREADY_REMOVED: "该站点已撤下，无需重复操作。",
  EDITION_SITE_REMOVE_NOT_ASSIGNED: "该站点未分配给这篇文章。",
  EDITION_SITE_REMOVE_NOT_PUBLISHED: "只有已发布的文章才能撤下站点。",
  EDITION_SITE_URL_STATE_INVALID: "该站点 URL 状态异常，请刷新后重试。",
  EDITION_WORKFLOW_NOT_APPROVED: "当前文章状态不能发布，请刷新后重试。",
  EDITION_WORKFLOW_PUBLISHER_REQUIRED: "只有发布者或超级管理员可以执行该操作。",
  EDITION_WORKFLOW_SITE_ALREADY_PUBLISHED: "该站点已发布，无需重试。",
  EDITION_WORKFLOW_SITE_NOT_ASSIGNED: "该站点未分配给这篇文章。",
  EDITION_WORKFLOW_URL_CONFLICT: "该站点 URL 冲突（同标题文章已占用路径），请调整文章标题后重试。",
  IDEMPOTENCY_KEY_REUSED: "操作已提交过，请刷新查看最新状态。",
}

const errorTextOf = (code: unknown): string =>
  (typeof code === "string" ? SITE_ACTION_ERRORS[code] : undefined) ??
  (typeof code === "string" && code.length > 0
    ? `操作未能完成（${code}），请刷新后重试。`
    : "操作未能完成，请刷新后重试。")

const formatInstant = (value: string): string => {
  const date = new Date(value)
  return Number.isNaN(date.valueOf())
    ? "—"
    : new Intl.DateTimeFormat("zh-CN", {
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Shanghai",
      }).format(date)
}

const selectClass =
  "gf-console-focus h-10 w-full rounded-md border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3 text-sm text-[var(--console-ink)] outline-none disabled:cursor-not-allowed disabled:opacity-60"

/**
 * A4 已发布文章的每站发布状态：站点 / URL / 发布状态 / 质量状态 / 最近
 * release / 失败原因，以及按站操作（发布该站、单站重试、撤下、重新追加、
 * 追加站点）。追加站点先跑该站质量检查，通过后由"发布该站"完成发布——
 * 内容没变，不重走编辑审核。
 */
const ArticleSiteStatusPanel = ({
  canManage,
  editionId,
  siteOptions,
  sites,
}: {
  readonly canManage: boolean
  readonly editionId: number
  readonly siteOptions: readonly Option[]
  readonly sites: readonly SiteStatus[]
}) => {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<{ readonly ok: boolean; readonly text: string } | null>(null)
  const [addSiteValue, setAddSiteValue] = useState("")
  const [takedown, setTakedown] = useState<number | null>(null)
  const [takedownReason, setTakedownReason] = useState("")

  const memberSiteIds = new Set(sites.map((site) => site.siteId))
  const addableSites = siteOptions.filter((option) => !memberSiteIds.has(option.id))

  const run = async (action: () => Promise<void>, successText: string) => {
    setPending(true)
    setNotice(null)
    try {
      await action()
      setNotice({ ok: true, text: successText })
      router.refresh()
    } catch (error) {
      setNotice({ ok: false, text: error instanceof Error ? error.message : "操作未能完成。" })
    } finally {
      setPending(false)
      setTakedown(null)
      setTakedownReason("")
    }
  }

  const postJson = async (path: string, body: Record<string, unknown>) => {
    const response = await fetch(path, {
      body: JSON.stringify(body),
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "POST",
    })
    const result = (await response.json().catch(() => ({}))) as { error?: { code?: unknown } }
    if (!response.ok) throw new Error(errorTextOf(result.error?.code))
  }

  const publishSite = (siteId: number) =>
    run(
      () => postJson(`/api/editions/${editionId}/publish-operations`, { siteId }),
      "发布任务已提交；完成后该站会出现新的线上版本。",
    )

  const addSite = () => {
    const siteId = Number(addSiteValue)
    if (!Number.isInteger(siteId) || siteId <= 0) return
    setAddSiteValue("")
    void run(
      () => postJson(`/api/editions/${editionId}/sites`, { siteId }),
      "站点已追加：正在运行该站质量检查，通过后点“发布该站”。",
    )
  }

  const removeSite = (siteId: number) => {
    if (takedownReason.trim().length === 0) return
    void run(async () => {
      const response = await fetch(`/api/editions/${editionId}/sites/${siteId}`, {
        body: JSON.stringify({ reason: takedownReason.trim() }),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "DELETE",
      })
      const result = (await response.json().catch(() => ({}))) as {
        error?: { code?: unknown }
      }
      if (!response.ok) throw new Error(errorTextOf(result.error?.code))
    }, "站点已撤下：URL 转 410，该站新版本不再包含这篇文章。")
  }

  return (
    <section className="gf-console-card grid gap-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="m-0 text-base font-semibold tracking-tight text-[var(--console-ink)]">
          站点发布状态
        </h2>
      </div>

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

      {canManage && addableSites.length > 0 && (
        <div className="grid gap-2 border-t border-[var(--console-border)] pt-4">
          <span className="text-sm font-medium text-[var(--console-ink)]">追加站点</span>
          <p className="m-0 text-xs leading-5 text-[var(--console-ink-muted)]">
            追加后先运行该站质量检查；通过后再发布到该站，不影响其他站点。
          </p>
          <div className="flex gap-2">
            <select
              className={selectClass}
              disabled={pending}
              onChange={(event) => setAddSiteValue(event.target.value)}
              value={addSiteValue}
            >
              <option value="">选择站点…</option>
              {addableSites.map((site) => (
                <option key={site.id} value={String(site.id)}>
                  {site.label}
                </option>
              ))}
            </select>
            <Button
              className="shrink-0"
              disabled={pending || addSiteValue.length === 0}
              onClick={addSite}
              size="sm"
              type="button"
            >
              追加
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-3">
        {sites.map((site) => {
          const qualityBlocksPublish =
            site.publishState === "pending" &&
            (site.qualityState === "failed" || site.qualityState === "error")
          return (
            <div
              className="grid gap-2 rounded-lg border border-[var(--console-border)] bg-[var(--console-surface-muted)] p-3.5"
              key={site.siteId}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-[var(--console-ink)]">
                  {site.siteName}
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${PUBLISH_STATE_TONES[site.publishState]}`}
                >
                  {PUBLISH_STATE_LABELS[site.publishState]}
                </span>
              </div>
              <p className="m-0 break-all font-mono text-xs text-[var(--console-ink-muted)]">
                {site.urlState === "active" && site.url !== null ? (
                  <a
                    className="gf-console-focus hover:text-[var(--console-accent)]"
                    href={site.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {site.url}
                  </a>
                ) : site.urlState === "gone" && site.pathname !== null ? (
                  <span title={site.pathname}>已下线（410）</span>
                ) : site.urlState === "reserved" && site.pathname !== null ? (
                  <span>已预留 {site.pathname}</span>
                ) : (
                  "无 URL"
                )}
              </p>
              <p className="m-0 text-xs leading-5 text-[var(--console-ink-muted)]">
                {QUALITY_STATE_LABELS[site.qualityState]}
                {site.releaseId !== null && (
                  <>
                    {" · "}
                    <span className="font-mono">{site.releaseId.slice(0, 16)}…</span>
                  </>
                )}
                {site.publishedAt !== null && <> · 发布于 {formatInstant(site.publishedAt)}</>}
              </p>
              {site.lastError !== null && (
                <p className="m-0 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs leading-5 text-rose-700">
                  {site.lastError}
                </p>
              )}
              {canManage && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {site.publishState === "published" && (
                    <Button
                      disabled={pending}
                      onClick={() => setTakedown(site.siteId)}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      撤下该站
                    </Button>
                  )}
                  {site.publishState === "pending" && !qualityBlocksPublish && (
                    <Button
                      disabled={pending || site.qualityState !== "passed"}
                      onClick={() => void publishSite(site.siteId)}
                      size="sm"
                      type="button"
                      variant={site.qualityState === "passed" ? "default" : "secondary"}
                    >
                      {site.qualityState === "passed" ? "发布该站" : "等待质量检查"}
                    </Button>
                  )}
                  {site.publishState === "pending" && qualityBlocksPublish && (
                    <p className="m-0 text-xs leading-5 text-rose-700">
                      质量检查未通过，发布会被阻断；调整内容或站点后重新追加评估。
                    </p>
                  )}
                  {site.publishState === "failed" && (
                    <Button
                      disabled={pending}
                      onClick={() => void publishSite(site.siteId)}
                      size="sm"
                      type="button"
                    >
                      重试该站
                    </Button>
                  )}
                  {site.publishState === "unpublished" && (
                    <Button
                      disabled={pending}
                      onClick={() => {
                        setAddSiteValue("")
                        void run(
                          () =>
                            postJson(`/api/editions/${editionId}/sites`, { siteId: site.siteId }),
                          "站点已重新追加：正在运行该站质量检查。",
                        )
                      }}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      重新追加
                    </Button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {takedown !== null && (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4"
          role="dialog"
        >
          <div className="w-full max-w-md rounded-2xl border border-[var(--console-border)] bg-[var(--console-surface)] p-6 shadow-2xl">
            <h3 className="m-0 text-xl font-bold tracking-tight text-[var(--console-ink)]">
              撤下该站点
            </h3>
            <p className="m-0 mt-2 text-sm leading-6 text-[var(--console-ink-muted)]">
              撤下后该站这篇文章的 URL 转为 410，并立即重发该站新版本（不含这篇文章）；
              其他站点不受影响。操作会写入不可变审计记录。
            </p>
            <label className="mt-4 block">
              <span className="text-sm font-bold text-[var(--console-ink)]">撤下原因 *</span>
              <textarea
                className="mt-2 min-h-24 w-full resize-y rounded-md border border-[var(--console-border)] bg-[var(--console-surface-muted)] p-3 text-sm text-[var(--console-ink)]"
                maxLength={500}
                onChange={(event) => setTakedownReason(event.target.value)}
                value={takedownReason}
              />
            </label>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                disabled={pending}
                onClick={() => {
                  setTakedown(null)
                  setTakedownReason("")
                }}
                size="lg"
                type="button"
                variant="secondary"
              >
                取消
              </Button>
              <Button
                disabled={pending || takedownReason.trim().length === 0}
                onClick={() => removeSite(takedown)}
                size="lg"
                type="button"
                variant="destructive"
              >
                {pending ? "提交中…" : "确认撤下"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default ArticleSiteStatusPanel
