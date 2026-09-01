"use client"

import {
  toast,
  useAuth,
  useDocumentInfo,
  useField,
  useFormFields,
  useTranslation,
} from "@payloadcms/ui"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { uiLangOf } from "../i18n/ui-lang"
import { AlertTriangleIcon, ShieldCheckIcon, UsersIcon } from "../icons"
import { Badge, IconBadge } from "../ui"
import { Button } from "../ui/button"
import { WorkflowActions } from "../workflow/WorkflowActions"

type WorkspaceContext = Readonly<{
  edition: Readonly<{ siteTimezone: string | null; workflowRevision: number }>
  assignees: readonly Readonly<{ email: string | null; id: number | null; role: string | null }>[]
  quality: Readonly<{
    createdAt: string | null
    inputHash: string | null
    issues: readonly unknown[]
    overall: number | null
    state: string | null
  }> | null
}>

const EMPTY: WorkspaceContext = {
  assignees: [],
  edition: { siteTimezone: null, workflowRevision: 0 },
  quality: null,
}
type SiteOption = Readonly<{ id: number; name: string }>

const COPY = {
  en: {
    assignment: "Ownership and priority",
    blocked: "Blocked",
    due: "Due date",
    editorial: "Editorial state",
    high: "High",
    low: "Low",
    normal: "Normal",
    owner: "Owner",
    priority: "Priority",
    quality: "Quality",
    qualityMissing: "No quality assessment is available for this version.",
    qualityQueued: "Quality check queued.",
    qualityRun: "Run quality check",
    unassigned: "Unassigned",
    assigned: "Assigned",
    inProgress: "In progress",
    urgent: "Urgent",
    schedule: "Schedule publication",
    scheduleAt: "Publish at (UTC)",
    scheduled: "Publication scheduled.",
    variant: "Create site variant",
    variantAt: "Target site",
    variantCreated: "Site variant draft created.",
    variantEmpty: "No other site is available in this tenant.",
  },
  zh: {
    assignment: "负责人和优先级",
    blocked: "受阻",
    due: "截止时间",
    editorial: "编辑状态",
    high: "高",
    low: "低",
    normal: "普通",
    owner: "负责人",
    priority: "优先级",
    quality: "质量",
    qualityMissing: "当前版本没有可用质量评估。",
    qualityQueued: "已提交质量检查。",
    qualityRun: "运行质量检查",
    unassigned: "未分配",
    assigned: "已分配",
    inProgress: "编辑中",
    urgent: "紧急",
    schedule: "创建发布排期",
    scheduleAt: "发布时间",
    scheduled: "已创建发布排期。",
    variant: "创建站点版本",
    variantAt: "目标站点",
    variantCreated: "已创建站点版本草稿。",
    variantEmpty: "当前租户没有其他可用站点。",
  },
} as const

const idOf = (value: unknown): string => {
  if (typeof value === "number" || typeof value === "string") return String(value)
  if (typeof value === "object" && value !== null)
    return idOf((value as Record<string, unknown>)["id"])
  return ""
}

const localDateValue = (value: unknown): string => {
  if (typeof value !== "string") return ""
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return ""
  // `datetime-local` has no timezone; render UTC deterministically so server
  // and browser hydration do not differ by the viewer's local offset.
  return date.toISOString().slice(0, 16)
}

export const ContentEditionControlRail = ({ readOnly }: { readonly readOnly: boolean }) => {
  const { id } = useDocumentInfo()
  const router = useRouter()
  const { user } = useAuth()
  const { i18n } = useTranslation()
  const lang = uiLangOf(i18n.language)
  const t = COPY[lang]
  const { setValue: setOwner, value: owner } = useField<unknown>({ path: "owner" })
  const { setValue: setPriority, value: priority } = useField<string>({ path: "priority" })
  const { setValue: setDueAt, value: dueAt } = useField<unknown>({ path: "dueAt" })
  const { setValue: setEditorialStatus, value: editorialStatus } = useField<string>({
    path: "editorialStatus",
  })
  const body = useFormFields(([fields]) => fields["body"]?.value)
  const currentSite = useFormFields(([fields]) => fields["site"]?.value)
  const [context, setContext] = useState<WorkspaceContext>(EMPTY)
  const [scheduledFor, setScheduledFor] = useState("")
  const [scheduling, setScheduling] = useState(false)
  const [sites, setSites] = useState<readonly SiteOption[]>([])
  const [targetSiteId, setTargetSiteId] = useState("")
  const [creatingVariant, setCreatingVariant] = useState(false)
  const [runningQuality, setRunningQuality] = useState(false)

  useEffect(() => {
    if (id === undefined || id === null) return
    void fetch(`/api/workspaces/editions/${id}/context`, {
      credentials: "same-origin",
      headers: { "x-request-id": crypto.randomUUID() },
    })
      .then(async (response) =>
        response.ok ? ((await response.json()) as WorkspaceContext) : EMPTY,
      )
      .then(setContext)
      .catch(() => setContext(EMPTY))
  }, [id])

  useEffect(() => {
    let active = true
    void fetch("/api/sites?depth=0&limit=100&sort=name", { credentials: "same-origin" })
      .then(async (response) =>
        response.ok
          ? ((await response.json()) as { docs?: readonly Record<string, unknown>[] })
          : { docs: [] },
      )
      .then((data) => {
        if (!active) return
        setSites(
          (data.docs ?? []).flatMap((site) => {
            const siteId = Number(site["id"])
            const name = typeof site["name"] === "string" ? site["name"].trim() : ""
            return Number.isInteger(siteId) && siteId > 0 && name.length > 0
              ? [{ id: siteId, name }]
              : []
          }),
        )
      })
      .catch(() => {
        if (active) setSites([])
      })
    return () => {
      active = false
    }
  }, [])

  const qualityTone =
    context.quality?.state === "passed"
      ? "success"
      : context.quality === null
        ? "neutral"
        : "warning"
  const currentOwner = idOf(owner)
  const currentBodyCount = Array.isArray(body) ? body.length : 0
  const currentSiteId = idOf(currentSite)
  const canCreateVariant =
    !readOnly &&
    id !== undefined &&
    id !== null &&
    (user?.["role"] === "editor" ||
      user?.["role"] === "tenant-admin" ||
      user?.["role"] === "super-admin")
  const variantSites = sites.filter((site) => String(site.id) !== currentSiteId)
  const canRunQuality = !readOnly && user?.["role"] === "editor" && id !== undefined && id !== null
  const runQuality = async () => {
    if (!canRunQuality || id === undefined || id === null) return
    setRunningQuality(true)
    try {
      const response = await fetch(`/api/workspaces/editor/editions/${id}/evaluation-operations`, {
        body: JSON.stringify({}),
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
          "x-request-id": crypto.randomUUID(),
        },
        method: "POST",
      })
      if (!response.ok) throw new Error()
      toast.success(t.qualityQueued)
      router.refresh()
    } catch {
      toast.error(lang === "zh" ? "提交质量检查失败。" : "Could not queue the quality check.")
    } finally {
      setRunningQuality(false)
    }
  }
  const canSchedule =
    user?.["role"] === "publisher" &&
    id !== undefined &&
    id !== null &&
    context.edition.siteTimezone !== null
  const schedule = async () => {
    if (!canSchedule || scheduledFor.length === 0 || id === undefined || id === null) return
    setScheduling(true)
    try {
      const response = await fetch("/api/publication-plan-operations", {
        body: JSON.stringify({
          editionId: Number(id),
          scheduledFor,
          timezone: context.edition.siteTimezone,
        }),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      if (!response.ok) throw new Error()
      setScheduledFor("")
      toast.success(t.scheduled)
    } catch {
      toast.error(lang === "zh" ? "创建发布排期失败。" : "Could not schedule publication.")
    } finally {
      setScheduling(false)
    }
  }
  const createVariant = async () => {
    if (!canCreateVariant || targetSiteId.length === 0 || id === undefined || id === null) return
    setCreatingVariant(true)
    try {
      const response = await fetch(`/api/editions/${id}/site-variants`, {
        body: JSON.stringify({ siteId: Number(targetSiteId) }),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      const result = (await response.json().catch(() => null)) as { editionId?: number }
      if (!response.ok || !Number.isInteger(result?.editionId)) throw new Error()
      toast.success(t.variantCreated)
      router.push(`/admin/collections/content-editions/${result.editionId}`)
    } catch {
      toast.error(lang === "zh" ? "创建站点版本失败。" : "Could not create the site variant.")
    } finally {
      setCreatingVariant(false)
    }
  }

  return (
    <aside
      aria-label={lang === "zh" ? "任务控制和工作流" : "Editorial controls and workflow"}
      className="grid min-w-0 content-start gap-4"
    >
      <section className="rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] p-4 shadow-[var(--gf-shadow-surface)]">
        <div className="flex items-center gap-3">
          <IconBadge tone="accent">
            <UsersIcon size={18} />
          </IconBadge>
          <div>
            <p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">
              {t.assignment}
            </p>
            <strong className="mt-1 block text-sm text-[var(--theme-text)]">{t.editorial}</strong>
          </div>
        </div>
        <div className="mt-4 grid gap-3">
          <label className="grid gap-1 text-xs font-bold text-[var(--theme-elevation-600)]">
            {t.owner}
            <select
              className="min-h-10 rounded-lg border border-[var(--theme-elevation-250)] bg-[var(--theme-elevation-50)] px-3 text-sm text-[var(--theme-text)] focus:border-[var(--gf-accent-400)] focus:outline-none focus:ring-2 focus:ring-[var(--gf-accent-200)]"
              disabled={readOnly}
              onChange={(event) =>
                setOwner(event.target.value.length === 0 ? null : Number(event.target.value))
              }
              value={currentOwner}
            >
              <option value="">—</option>
              {context.assignees
                .filter((assignee) => assignee.id !== null)
                .map((assignee) => (
                  <option key={assignee.id} value={String(assignee.id)}>
                    {assignee.email ?? assignee.id}
                  </option>
                ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-bold text-[var(--theme-elevation-600)]">
            {t.priority}
            <select
              className="min-h-10 rounded-lg border border-[var(--theme-elevation-250)] bg-[var(--theme-elevation-50)] px-3 text-sm text-[var(--theme-text)] focus:border-[var(--gf-accent-400)] focus:outline-none focus:ring-2 focus:ring-[var(--gf-accent-200)]"
              disabled={readOnly}
              onChange={(event) => setPriority(event.target.value)}
              value={typeof priority === "string" ? priority : "normal"}
            >
              <option value="low">{t.low}</option>
              <option value="normal">{t.normal}</option>
              <option value="high">{t.high}</option>
              <option value="urgent">{t.urgent}</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs font-bold text-[var(--theme-elevation-600)]">
            {t.due}
            <input
              className="min-h-10 rounded-lg border border-[var(--theme-elevation-250)] bg-[var(--theme-elevation-50)] px-3 text-sm text-[var(--theme-text)] focus:border-[var(--gf-accent-400)] focus:outline-none focus:ring-2 focus:ring-[var(--gf-accent-200)]"
              disabled={readOnly}
              onChange={(event) =>
                setDueAt(
                  event.target.value.length === 0
                    ? null
                    : new Date(event.target.value).toISOString(),
                )
              }
              type="datetime-local"
              value={localDateValue(dueAt)}
            />
          </label>
          <label className="grid gap-1 text-xs font-bold text-[var(--theme-elevation-600)]">
            {t.editorial}
            <select
              className="min-h-10 rounded-lg border border-[var(--theme-elevation-250)] bg-[var(--theme-elevation-50)] px-3 text-sm text-[var(--theme-text)] focus:border-[var(--gf-accent-400)] focus:outline-none focus:ring-2 focus:ring-[var(--gf-accent-200)]"
              disabled={readOnly}
              onChange={(event) => setEditorialStatus(event.target.value)}
              value={typeof editorialStatus === "string" ? editorialStatus : "unassigned"}
            >
              <option value="unassigned">{t.unassigned}</option>
              <option value="assigned">{t.assigned}</option>
              <option value="in-progress">{t.inProgress}</option>
              <option value="blocked">{t.blocked}</option>
            </select>
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] p-4 shadow-[var(--gf-shadow-surface)]">
        <div className="flex items-center gap-3">
          <IconBadge tone={qualityTone}>
            <ShieldCheckIcon size={18} />
          </IconBadge>
          <div>
            <p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">
              {t.quality}
            </p>
            <strong className="mt-1 block text-sm text-[var(--theme-text)]">
              {context.quality?.state ?? "—"}
            </strong>
          </div>
        </div>
        {context.quality === null ? (
          <p className="m-0 mt-4 text-sm leading-6 text-[var(--theme-elevation-600)]">
            {t.qualityMissing}
          </p>
        ) : (
          <div className="mt-4 grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <Badge tone={qualityTone}>{context.quality.state ?? "—"}</Badge>
              <span className="text-xs text-[var(--theme-elevation-600)]">
                {context.quality.overall ?? "—"}
              </span>
            </div>
            <p className="m-0 text-xs leading-5 text-[var(--theme-elevation-600)]">
              {context.quality.issues.length} issue(s) · {currentBodyCount} block(s)
            </p>
          </div>
        )}
        {canRunQuality && (
          <Button
            className="mt-4 w-full"
            disabled={runningQuality}
            onClick={() => void runQuality()}
            size="lg"
            type="button"
          >
            {runningQuality ? "…" : t.qualityRun}
          </Button>
        )}
      </section>

      {canCreateVariant && (
        <section className="rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] p-4 shadow-[var(--gf-shadow-surface)]">
          <p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">
            {t.variant}
          </p>
          {variantSites.length === 0 ? (
            <p className="m-0 mt-3 text-sm leading-6 text-[var(--theme-elevation-600)]">
              {t.variantEmpty}
            </p>
          ) : (
            <>
              <label className="mt-3 grid gap-1 text-xs font-bold text-[var(--theme-elevation-600)]">
                {t.variantAt}
                <select
                  className="min-h-10 rounded-lg border border-[var(--theme-elevation-250)] bg-[var(--theme-elevation-50)] px-3 text-sm text-[var(--theme-text)] focus-visible:ring-2 focus-visible:ring-[var(--gf-accent-400)]"
                  disabled={creatingVariant}
                  onChange={(event) => setTargetSiteId(event.target.value)}
                  value={targetSiteId}
                >
                  <option value="">—</option>
                  {variantSites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                className="mt-3 w-full"
                disabled={targetSiteId.length === 0 || creatingVariant}
                onClick={() => void createVariant()}
                size="lg"
                type="button"
              >
                {t.variant}
              </Button>
            </>
          )}
        </section>
      )}

      {canSchedule && (
        <section className="rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] p-4 shadow-[var(--gf-shadow-surface)]">
          <p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">
            {t.schedule}
          </p>
          <label className="mt-3 grid gap-1 text-xs font-bold text-[var(--theme-elevation-600)]">
            {t.scheduleAt}
            <input
              className="min-h-10 rounded-lg border border-[var(--theme-elevation-250)] bg-[var(--theme-elevation-50)] px-3 text-sm text-[var(--theme-text)] focus:border-[var(--gf-accent-400)] focus:outline-none focus:ring-2 focus:ring-[var(--gf-accent-200)]"
              onChange={(event) => setScheduledFor(event.target.value)}
              placeholder="2026-12-01T15:00:00.000Z"
              value={scheduledFor}
            />
          </label>
          <p className="m-0 mt-2 text-xs text-[var(--theme-elevation-600)]">
            {context.edition.siteTimezone}
          </p>
          <Button
            className="mt-3 w-full"
            disabled={scheduledFor.length === 0 || scheduling}
            onClick={() => void schedule()}
            size="lg"
            type="button"
          >
            {t.schedule}
          </Button>
        </section>
      )}

      <WorkflowActions />
    </aside>
  )
}
