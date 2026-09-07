"use client"

import {
  toast,
  useAuth,
  useDocumentInfo,
  useField,
  useFormFields,
  useTranslation,
} from "@payloadcms/ui"
import { useEffect, useState } from "react"
import {
  CalendarClockIcon,
  GlobeIcon,
  LinkIcon,
  MessageSquareIcon,
  PlusIcon,
  ShieldCheckIcon,
  UsersIcon,
} from "@/components/icons"
import { uiLangOf } from "../i18n/ui-lang"
import { Badge, IconBadge } from "../ui"
import { Button } from "../ui/button"
import { WorkflowActions } from "../workflow/WorkflowActions"
import { ContentEditionRail, type VersionSelection } from "./ContentEditionRail"

type WorkspaceContext = Readonly<{
  assignees: readonly Readonly<{ email: string | null; id: number | null; role: string | null }>[]
  comments: readonly Readonly<{
    author: Readonly<{ email: string | null; id: number | null }>
    body: string | null
    createdAt: string | null
    id: number | null
  }>[]
  edition: Readonly<{ siteTimezone: string | null; workflowRevision: number }>
  quality: Readonly<{
    issues: readonly unknown[]
    overall: number | null
    state: string | null
  }> | null
  sources: readonly Readonly<{
    id: number | null
    note: string | null
    role: string | null
    intakeItem: Readonly<{ sourceUrl: string | null; title: string | null }>
  }>[]
}>

const EMPTY: WorkspaceContext = {
  assignees: [],
  comments: [],
  edition: { siteTimezone: null, workflowRevision: 0 },
  quality: null,
  sources: [],
}

type SiteOption = Readonly<{ id: number; name: string }>

const idOf = (value: unknown): string => {
  if (typeof value === "number" || typeof value === "string") return String(value)
  if (typeof value === "object" && value !== null)
    return idOf((value as Record<string, unknown>)["id"])
  return ""
}

const idsOf = (value: unknown): readonly number[] =>
  Array.isArray(value)
    ? value.flatMap((entry) => {
        const parsed = Number(idOf(entry))
        return Number.isInteger(parsed) && parsed > 0 ? [parsed] : []
      })
    : []

const localDateValue = (value: unknown): string => {
  if (typeof value !== "string") return ""
  const date = new Date(value)
  // `datetime-local` has no timezone; render UTC deterministically so server
  // and browser hydration do not differ by the viewer's local offset.
  return Number.isNaN(date.valueOf()) ? "" : date.toISOString().slice(0, 16)
}

const stampOf = (value: string | null, lang: string): string => {
  if (value === null) return "—"
  const date = new Date(value)
  return Number.isNaN(date.valueOf())
    ? "—"
    : date.toLocaleString(lang === "zh" ? "zh-CN" : "en-US", { timeZone: "UTC" })
}

const Card = ({
  children,
  count,
  icon,
  title,
  tone = "accent",
}: {
  readonly children: React.ReactNode
  readonly count?: string
  readonly icon: React.ReactNode
  readonly title: string
  readonly tone?: "accent" | "neutral" | "success" | "warning"
}) => (
  <section className="min-w-0 rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] p-4 shadow-[var(--gf-shadow-surface)]">
    <div className="flex min-w-0 items-center gap-3">
      <IconBadge tone={tone}>{icon}</IconBadge>
      <div className="min-w-0">
        <p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">
          {title}
        </p>
        {count !== undefined && (
          <strong className="mt-1 block truncate text-sm text-[var(--theme-text)]">{count}</strong>
        )}
      </div>
    </div>
    {children}
  </section>
)

/**
 * Single editorial rail: assignment (owner, assigned sites, priority),
 * quality, publication scheduling, linked sources, review comments, workflow
 * actions and version history. The workspace keeps one column of controls so
 * the canvas owns the remaining width.
 */
export const ContentEditionControlRail = ({
  onSelectVersion,
  readOnly,
  selectedVersion,
}: {
  readonly onSelectVersion: (version: VersionSelection) => void
  readonly readOnly: boolean
  readonly selectedVersion: VersionSelection
}) => {
  const { id } = useDocumentInfo()
  const { user } = useAuth()
  const { i18n } = useTranslation()
  const lang = uiLangOf(i18n.language)
  const { setValue: setOwner, value: owner } = useField<unknown>({ path: "owner" })
  const { setValue: setPriority, value: priority } = useField<string>({ path: "priority" })
  const { setValue: setDueAt, value: dueAt } = useField<unknown>({ path: "dueAt" })
  const { setValue: setEditorialStatus, value: editorialStatus } = useField<string>({
    path: "editorialStatus",
  })
  const { setValue: setSite, value: site } = useField<unknown>({ path: "site" })
  const { setValue: setSites, value: sites } = useField<unknown>({ path: "sites" })
  const body = useFormFields(([fields]) => fields["body"]?.value)
  const tenant = useFormFields(([fields]) => fields["tenant"]?.value)
  const workflowRevision = useFormFields(([fields]) => fields["workflowRevision"]?.value)
  const [context, setContext] = useState<WorkspaceContext>(EMPTY)
  const [siteOptions, setSiteOptions] = useState<readonly SiteOption[]>([])
  const [scheduledFor, setScheduledFor] = useState("")
  const [scheduling, setScheduling] = useState(false)
  const [intakeItemId, setIntakeItemId] = useState("")
  const [sourceRole, setSourceRole] = useState<"primary" | "supporting">("supporting")
  const [comment, setComment] = useState("")

  const reload = () => {
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
  }

  useEffect(() => {
    reload()
  }, [id])

  /* Site options must stay inside the edition's tenant: a cross-tenant site
   * is rejected by the collection hook, so offering one would only produce a
   * failed save. Super admins read every tenant, hence the explicit filter. */
  useEffect(() => {
    const tenantId = idOf(tenant)
    if (tenantId.length === 0) {
      setSiteOptions([])
      return
    }
    let active = true
    void fetch(
      `/api/sites?depth=0&limit=100&sort=name&where[tenant][equals]=${encodeURIComponent(tenantId)}`,
      { credentials: "same-origin" },
    )
      .then(async (response) =>
        response.ok
          ? ((await response.json()) as { docs?: readonly Record<string, unknown>[] })
          : { docs: [] },
      )
      .then((data) => {
        if (!active) return
        setSiteOptions(
          (data.docs ?? []).flatMap((entry) => {
            const siteId = Number(entry["id"])
            const name = typeof entry["name"] === "string" ? entry["name"].trim() : ""
            return Number.isInteger(siteId) && siteId > 0 && name.length > 0
              ? [{ id: siteId, name }]
              : []
          }),
        )
      })
      .catch(() => {
        if (active) setSiteOptions([])
      })
    return () => {
      active = false
    }
  }, [tenant])

  const role = user?.["role"]
  const privileged = role === "editor" || role === "tenant-admin" || role === "super-admin"
  const assignedSiteIds = idsOf(sites)
  const mainSiteId = idOf(site)

  /* Assigned sites drive delivery: a site reads this edition only when it is
   * assigned. The primary site stays a single value because the publication
   * URL registry is scoped to one site, so it follows the assignment. */
  const toggleSite = (siteId: number) => {
    const next = assignedSiteIds.includes(siteId)
      ? assignedSiteIds.filter((entry) => entry !== siteId)
      : [...assignedSiteIds, siteId]
    setSites(next)
    if (next.length > 0 && !next.includes(Number(mainSiteId))) setSite(next[0])
  }

  const qualityTone =
    context.quality?.state === "passed"
      ? "success"
      : context.quality === null
        ? "neutral"
        : "warning"
  const canSchedule =
    (role === "publisher" || role === "super-admin") &&
    id !== undefined &&
    id !== null &&
    context.edition.siteTimezone !== null
  const canEditSources = privileged && id !== undefined && id !== null
  const canComment = (privileged || role === "reviewer") && id !== undefined && id !== null

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
      toast.success(lang === "zh" ? "已创建发布排期。" : "Publication scheduled.")
    } catch {
      toast.error(lang === "zh" ? "创建发布排期失败。" : "Could not schedule publication.")
    } finally {
      setScheduling(false)
    }
  }

  const addSource = async () => {
    if (id === undefined || id === null || !/^\d+$/.test(intakeItemId.trim())) return
    const response = await fetch(`/api/editions/${id}/article-sources`, {
      body: JSON.stringify({ intakeItemId: Number(intakeItemId), role: sourceRole }),
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "POST",
    })
    if (!response.ok) {
      toast.error(lang === "zh" ? "关联来源失败。" : "Could not link source.")
      return
    }
    setIntakeItemId("")
    reload()
  }

  const addComment = async () => {
    if (id === undefined || id === null || comment.trim().length === 0) return
    const response = await fetch(`/api/editions/${id}/review-comments`, {
      body: JSON.stringify({
        body: comment.trim(),
        ...(typeof workflowRevision === "number" ? { workflowRevision } : {}),
      }),
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "POST",
    })
    if (!response.ok) {
      toast.error(lang === "zh" ? "添加评论失败。" : "Could not add comment.")
      return
    }
    setComment("")
    reload()
  }

  const fieldClass =
    "min-h-10 w-full min-w-0 rounded-lg border border-[var(--theme-elevation-250)] bg-[var(--theme-elevation-50)] px-3 text-sm text-[var(--theme-text)] focus:border-[var(--gf-accent-400)] focus:outline-none focus:ring-2 focus:ring-[var(--gf-accent-200)]"
  const labelClass = "grid gap-1 text-xs font-bold text-[var(--theme-elevation-600)]"

  return (
    <aside
      aria-label={lang === "zh" ? "编辑控制与工作流" : "Editorial controls and workflow"}
      className="grid min-w-0 content-start gap-4"
    >
      <WorkflowActions />

      <Card
        icon={<UsersIcon size={18} />}
        title={lang === "zh" ? "归属与优先级" : "Ownership and priority"}
      >
        <div className="mt-4 grid gap-3">
          <label className={labelClass}>
            {lang === "zh" ? "负责人" : "Owner"}
            <select
              className={fieldClass}
              disabled={readOnly}
              onChange={(event) =>
                setOwner(event.target.value.length === 0 ? null : Number(event.target.value))
              }
              value={idOf(owner)}
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
          <label className={labelClass}>
            {lang === "zh" ? "优先级" : "Priority"}
            <select
              className={fieldClass}
              disabled={readOnly}
              onChange={(event) => setPriority(event.target.value)}
              value={typeof priority === "string" ? priority : "normal"}
            >
              <option value="low">{lang === "zh" ? "低" : "Low"}</option>
              <option value="normal">{lang === "zh" ? "普通" : "Normal"}</option>
              <option value="high">{lang === "zh" ? "高" : "High"}</option>
              <option value="urgent">{lang === "zh" ? "紧急" : "Urgent"}</option>
            </select>
          </label>
          <label className={labelClass}>
            {lang === "zh" ? "截止时间" : "Due date"}
            <input
              className={fieldClass}
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
          <label className={labelClass}>
            {lang === "zh" ? "编辑状态" : "Editorial state"}
            <select
              className={fieldClass}
              disabled={readOnly}
              onChange={(event) => setEditorialStatus(event.target.value)}
              value={typeof editorialStatus === "string" ? editorialStatus : "unassigned"}
            >
              <option value="unassigned">{lang === "zh" ? "未分配" : "Unassigned"}</option>
              <option value="assigned">{lang === "zh" ? "已分配" : "Assigned"}</option>
              <option value="in-progress">{lang === "zh" ? "编辑中" : "In progress"}</option>
              <option value="blocked">{lang === "zh" ? "受阻" : "Blocked"}</option>
            </select>
          </label>
        </div>
      </Card>

      <Card
        count={`${assignedSiteIds.length} ${lang === "zh" ? "个站点" : "sites"}`}
        icon={<GlobeIcon size={18} />}
        title={lang === "zh" ? "所属站点" : "Assigned sites"}
      >
        <p className="m-0 mt-3 text-xs leading-5 text-[var(--theme-elevation-600)]">
          {lang === "zh"
            ? "勾选的站点才能读取这篇文章；第一个勾选的站点作为发布主站点。"
            : "Only assigned sites can read this article; the first one is the primary publication site."}
        </p>
        {siteOptions.length === 0 ? (
          <p className="m-0 mt-3 text-sm text-[var(--theme-elevation-600)]">
            {lang === "zh" ? "暂无可选站点。" : "No site is available."}
          </p>
        ) : (
          <ul className="m-0 mt-3 grid list-none gap-2 p-0 [&>li]:min-w-0">
            {siteOptions.map((option) => {
              const checked = assignedSiteIds.includes(option.id)
              return (
                <li key={option.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1 text-sm text-[var(--theme-text)] hover:bg-[var(--theme-elevation-50)]">
                    <input
                      checked={checked}
                      disabled={readOnly}
                      onChange={() => toggleSite(option.id)}
                      type="checkbox"
                    />
                    <span className="min-w-0 flex-1 truncate">{option.name}</span>
                    {String(option.id) === mainSiteId && (
                      <Badge tone="accent">{lang === "zh" ? "主站点" : "Primary"}</Badge>
                    )}
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <Card
        count={context.quality?.state ?? "—"}
        icon={<ShieldCheckIcon size={18} />}
        title={lang === "zh" ? "质量" : "Quality"}
        tone={qualityTone}
      >
        {context.quality === null ? (
          <p className="m-0 mt-4 text-sm leading-6 text-[var(--theme-elevation-600)]">
            {lang === "zh"
              ? "当前版本没有可用质量评估。"
              : "No quality assessment is available for this version."}
          </p>
        ) : (
          <div className="mt-4 grid gap-2">
            <div className="flex items-center justify-between gap-3">
              <Badge tone={qualityTone}>{context.quality.state ?? "—"}</Badge>
              <span className="text-xs text-[var(--theme-elevation-600)]">
                {context.quality.overall ?? "—"}
              </span>
            </div>
            <p className="m-0 text-xs leading-5 text-[var(--theme-elevation-600)]">
              {context.quality.issues.length} issue(s) · {Array.isArray(body) ? body.length : 0}{" "}
              block(s)
            </p>
          </div>
        )}
      </Card>

      {canSchedule && (
        <Card
          icon={<CalendarClockIcon size={18} />}
          title={lang === "zh" ? "发布排期" : "Schedule publication"}
        >
          <label className={`mt-3 ${labelClass}`}>
            {lang === "zh" ? "发布时间" : "Publish at"}
            <input
              className={fieldClass}
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
            size="md"
            type="button"
          >
            <CalendarClockIcon size={15} /> {lang === "zh" ? "创建发布排期" : "Schedule"}
          </Button>
        </Card>
      )}

      <Card
        count={String(context.sources.length)}
        icon={<LinkIcon size={18} />}
        title={lang === "zh" ? "来源" : "Sources"}
        tone="neutral"
      >
        {context.sources.length === 0 ? (
          <p className="m-0 mt-4 text-sm text-[var(--theme-elevation-600)]">
            {lang === "zh" ? "暂时没有关联来源。" : "No linked sources yet."}
          </p>
        ) : (
          <ul className="m-0 mt-4 grid list-none gap-3 p-0 [&>li]:min-w-0">
            {context.sources.map((source, index) => (
              <li
                className="min-w-0 overflow-hidden rounded-xl border border-[var(--theme-elevation-150)] bg-[var(--theme-elevation-50)] p-3"
                key={source.id ?? index}
              >
                <p className="m-0 text-xs font-bold uppercase tracking-[0.06em] text-[var(--gf-accent-700)]">
                  {source.role ?? "supporting"}
                </p>
                <strong className="mt-1 block text-sm text-[var(--theme-text)]">
                  {source.intakeItem.title ?? "—"}
                </strong>
                {source.intakeItem.sourceUrl !== null && (
                  <a
                    className="mt-1 block truncate text-xs font-semibold text-[var(--gf-accent-700)] no-underline hover:text-[var(--gf-accent-400)]"
                    href={source.intakeItem.sourceUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {source.intakeItem.sourceUrl}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEditSources && (
          <div className="mt-4 grid gap-2 border-t border-[var(--theme-elevation-150)] pt-4">
            <input
              aria-label={lang === "zh" ? "稿源条目 ID" : "Intake item ID"}
              className={fieldClass}
              onChange={(event) => setIntakeItemId(event.target.value)}
              placeholder={lang === "zh" ? "稿源条目 ID" : "Intake item ID"}
              value={intakeItemId}
            />
            <select
              aria-label={lang === "zh" ? "来源角色" : "Source role"}
              className={fieldClass}
              onChange={(event) => setSourceRole(event.target.value as "primary" | "supporting")}
              value={sourceRole}
            >
              <option value="supporting">{lang === "zh" ? "辅助来源" : "Supporting"}</option>
              <option value="primary">{lang === "zh" ? "主要来源" : "Primary"}</option>
            </select>
            <Button
              disabled={intakeItemId.trim().length === 0}
              onClick={() => void addSource()}
              size="md"
              type="button"
              variant="secondary"
            >
              <PlusIcon size={15} /> {lang === "zh" ? "关联来源" : "Add source"}
            </Button>
          </div>
        )}
      </Card>

      <Card
        count={String(context.comments.length)}
        icon={<MessageSquareIcon size={18} />}
        title={lang === "zh" ? "审核评论" : "Review comments"}
        tone="neutral"
      >
        {context.comments.length === 0 ? (
          <p className="m-0 mt-4 text-sm text-[var(--theme-elevation-600)]">
            {lang === "zh" ? "暂时没有审核评论。" : "No review comments yet."}
          </p>
        ) : (
          <ul className="m-0 mt-4 grid list-none gap-3 p-0 [&>li]:min-w-0">
            {context.comments.map((entry, index) => (
              <li
                className="min-w-0 overflow-hidden rounded-xl border border-[var(--theme-elevation-150)] bg-[var(--theme-elevation-50)] p-3"
                key={entry.id ?? index}
              >
                <div className="flex items-center justify-between gap-2">
                  <strong className="truncate text-xs text-[var(--theme-text)]">
                    {entry.author.email ?? "—"}
                  </strong>
                  <span className="shrink-0 text-[11px] text-[var(--theme-elevation-600)]">
                    {stampOf(entry.createdAt, lang)}
                  </span>
                </div>
                <p className="m-0 mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--theme-elevation-700)]">
                  {entry.body ?? "—"}
                </p>
              </li>
            ))}
          </ul>
        )}
        {canComment && (
          <div className="mt-4 border-t border-[var(--theme-elevation-150)] pt-4">
            <textarea
              aria-label={lang === "zh" ? "评论" : "Comment"}
              className="min-h-20 w-full resize-y rounded-lg border border-[var(--theme-elevation-250)] bg-[var(--theme-elevation-50)] p-3 text-sm text-[var(--theme-text)]"
              maxLength={2000}
              onChange={(event) => setComment(event.target.value)}
              placeholder={
                lang === "zh"
                  ? "为当前版本添加编辑意见…"
                  : "Add editorial feedback for this version…"
              }
              value={comment}
            />
            <Button
              className="mt-2 w-full"
              disabled={comment.trim().length === 0}
              onClick={() => void addComment()}
              size="md"
              type="button"
              variant="secondary"
            >
              <MessageSquareIcon size={15} /> {lang === "zh" ? "添加评论" : "Add comment"}
            </Button>
          </div>
        )}
      </Card>

      {id !== undefined && id !== null && (
        <ContentEditionRail
          onSelectVersion={onSelectVersion}
          selectedVersion={selectedVersion}
          showWorkflow={false}
        />
      )}
    </aside>
  )
}
