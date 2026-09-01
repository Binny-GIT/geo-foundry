import type { Payload } from "payload"

import { CMS_ROLE, type CmsRole } from "../../access/roles"
import {
  formatDate,
  idOf,
  type RecordLike,
  recordsOf,
  stringOf,
} from "../dashboard/operations-model"
import { type HasLanguage, uiLangOf } from "../i18n/ui-lang"
import { AlertTriangleIcon, LayersIcon, ShieldCheckIcon } from "../icons"
import { Badge, IconBadge } from "../ui"
import { isWorkflowStatus, workflowStatusLabel } from "../workflow/workflow-actions-model"
import {
  assessmentStateLabel,
  operationStateLabel,
  releaseStateLabel,
} from "../workspaces/workspace-labels"
import {
  type WorkspaceServerContext,
  workspaceUserOf,
} from "../workspaces/workspace-server-context"
import {
  cardClass,
  StatusBadge,
  WorkspaceAction,
  WorkspaceDenied,
  WorkspaceShell,
} from "../workspaces/workspace-shared"

export type EditionWorkspaceProps = WorkspaceServerContext & {
  readonly i18n?: HasLanguage
  readonly params?: { readonly id?: string | readonly string[] | undefined }
  readonly payload: Payload
}

const readableRoles = new Set<CmsRole>([
  CMS_ROLE.EDITOR,
  CMS_ROLE.PUBLISHER,
  CMS_ROLE.REVIEWER,
  CMS_ROLE.SUPER_ADMIN,
  CMS_ROLE.TENANT_ADMIN,
])

const operationRoles = new Set<CmsRole>([
  CMS_ROLE.EDITOR,
  CMS_ROLE.PUBLISHER,
  CMS_ROLE.SUPER_ADMIN,
  CMS_ROLE.TENANT_ADMIN,
])

const releaseRoles = new Set<CmsRole>([
  CMS_ROLE.PUBLISHER,
  CMS_ROLE.SUPER_ADMIN,
  CMS_ROLE.TENANT_ADMIN,
])

const TEXT = {
  en: {
    activity: "Recent lifecycle activity",
    audit: "Audit and diagnostics",
    content: "Content",
    current: "Current state",
    diagnostics: "Technical fields remain available in the record view.",
    edition: "Edition workspace",
    evidence: "Quality evidence",
    evidenceCurrent: "Evidence matches the current content",
    evidenceMissing: "No assessment is visible in your scope",
    evidenceStale: "Evidence belongs to an earlier content revision",
    openRecord: "Open full record",
    operation: "Latest operation",
    operationRestricted: "Operation details are restricted for this role.",
    publishing: "Publishing context",
    release: "Compiled release",
    releaseRestricted: "Release details are restricted for this role.",
    score: "Score",
    summary: "Summary",
    workflow: "Workflow actions remain available on the standard record.",
  },
  zh: {
    activity: "最近生命周期活动",
    audit: "审计与诊断",
    content: "内容",
    current: "当前状态",
    diagnostics: "完整技术字段仍可在原始记录页查看。",
    edition: "内容版本工作台",
    evidence: "质量证据",
    evidenceCurrent: "证据与当前内容一致",
    evidenceMissing: "您的权限范围内没有可见质量评估",
    evidenceStale: "证据属于较早的内容版本",
    openRecord: "打开完整记录",
    operation: "最近操作",
    operationRestricted: "当前角色无权查看操作详情。",
    publishing: "发布上下文",
    release: "已编译发布版本",
    releaseRestricted: "当前角色无权查看发布详情。",
    score: "得分",
    summary: "摘要",
    workflow: "工作流动作仍由原始记录页的受保护操作面板提供。",
  },
} as const

const safeFind = async (
  payload: Payload,
  user: EditionWorkspaceProps["user"],
  collection: Parameters<Payload["find"]>[0]["collection"],
  options: Omit<Parameters<Payload["find"]>[0], "collection" | "overrideAccess" | "user"> = {},
) =>
  payload.find({
    collection,
    depth: 0,
    limit: 12,
    overrideAccess: false,
    ...(user === undefined ? {} : { user }),
    ...options,
  })

const documentIdOf = (params: EditionWorkspaceProps["params"]): number | null => {
  const raw = params?.id
  const value = Array.isArray(raw) ? raw[0] : raw
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

const assessmentTone = (state: unknown) => {
  if (state === "passed") return "success" as const
  if (state === "failed" || state === "error") return "danger" as const
  return "warning" as const
}

export const EditionWorkspace = async ({
  i18n,
  initPageResult,
  params,
  payload,
  user,
}: EditionWorkspaceProps) => {
  const lang = uiLangOf(i18n?.language)
  const t = TEXT[lang]
  const id = documentIdOf(params)
  const currentUser = workspaceUserOf({ initPageResult, user })
  const role = currentUser?.role as CmsRole | undefined
  if (id === null || role === undefined || !readableRoles.has(role))
    return <WorkspaceDenied i18n={i18n} />

  const editionResult = await safeFind(payload, currentUser, "content-editions", {
    draft: true,
    limit: 1,
    where: { id: { equals: id } },
  })
  const edition = recordsOf(editionResult.docs)[0]
  if (edition === undefined) return <WorkspaceDenied i18n={i18n} />

  const canReadOperations = operationRoles.has(role)
  const canReadReleases = releaseRoles.has(role)
  const [assessmentsResult, operationsResult, releasesResult] = await Promise.all([
    safeFind(payload, currentUser, "quality-assessments", {
      sort: "-createdAt",
      where: { edition: { equals: id } },
    }),
    canReadOperations
      ? safeFind(payload, currentUser, "operations", { sort: "-updatedAt" })
      : Promise.resolve({ docs: [] as unknown[] }),
    canReadReleases
      ? safeFind(payload, currentUser, "releases", { sort: "-updatedAt" })
      : Promise.resolve({ docs: [] as unknown[] }),
  ])

  const assessments = recordsOf(assessmentsResult.docs)
  const latestAssessment = assessments[0]
  const operations = recordsOf(operationsResult.docs)
  const releases = recordsOf(releasesResult.docs)
  const editionId = idOf(edition) ?? String(id)
  const latestOperation = operations.find((operation) => {
    const targets = operation["targetIds"]
    return Array.isArray(targets) && targets.map(String).includes(editionId)
  })
  const compiledRelease = stringOf(edition["compiledRelease"], "")
  const release =
    compiledRelease.length > 0
      ? releases.find((row) => row["releaseId"] === compiledRelease)
      : undefined
  const assessmentMatches =
    latestAssessment !== undefined &&
    typeof latestAssessment["inputHash"] === "string" &&
    latestAssessment["inputHash"] === edition["inputHash"]

  return (
    <WorkspaceShell i18n={i18n} kicker="Geo Foundry" title={t.edition}>
      <section
        className={`${cardClass} grid gap-5 p-5 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]`}
      >
        <div className="min-w-0">
          <p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">
            {t.content}
          </p>
          <h2 className="m-0 mt-1 truncate text-2xl font-bold tracking-tight text-[var(--theme-text)]">
            {stringOf(edition["title"], `${lang === "zh" ? "内容版本" : "Edition"} ${editionId}`)}
          </h2>
          <p className="m-0 mt-2 max-w-3xl whitespace-pre-wrap text-sm leading-6 text-[var(--theme-elevation-700)]">
            {stringOf(edition["summary"], "—")}
          </p>
        </div>
        <aside className="grid content-start gap-3 border-t border-[var(--theme-elevation-150)] pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-[var(--theme-elevation-600)]">{t.current}</span>
            <StatusBadge
              label={
                isWorkflowStatus(edition["workflowStatus"])
                  ? workflowStatusLabel(edition["workflowStatus"], lang)
                  : "—"
              }
              state={stringOf(edition["workflowStatus"], "")}
            />
          </div>
          <p className="m-0 text-sm text-[var(--theme-elevation-600)]">{t.workflow}</p>
          <WorkspaceAction href={`/admin/collections/content-editions/${editionId}`} primary>
            {t.openRecord}
          </WorkspaceAction>
        </aside>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className={`${cardClass} flex flex-col gap-4 p-5`}>
          <div className="flex items-center gap-3">
            <IconBadge
              tone={
                latestAssessment === undefined
                  ? "neutral"
                  : assessmentTone(latestAssessment["state"])
              }
            >
              <ShieldCheckIcon size={18} />
            </IconBadge>
            <div>
              <h2 className="m-0 text-base font-bold text-[var(--theme-text)]">{t.evidence}</h2>
              <p className="m-0 mt-0.5 text-xs text-[var(--theme-elevation-600)]">
                {latestAssessment === undefined
                  ? t.evidenceMissing
                  : assessmentMatches
                    ? t.evidenceCurrent
                    : t.evidenceStale}
              </p>
            </div>
          </div>
          {latestAssessment !== undefined && (
            <dl className="m-0 grid grid-cols-2 gap-3 border-t border-[var(--theme-elevation-100)] pt-3">
              <div>
                <dt className="text-xs text-[var(--theme-elevation-600)]">{t.current}</dt>
                <dd className="m-0 mt-1">
                  <Badge tone={assessmentTone(latestAssessment["state"])}>
                    {assessmentStateLabel(latestAssessment["state"], lang)}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--theme-elevation-600)]">{t.score}</dt>
                <dd className="m-0 mt-1 text-sm font-bold text-[var(--theme-text)]">
                  {String(latestAssessment["overall"] ?? "—")}
                </dd>
              </div>
            </dl>
          )}
          <WorkspaceAction href="/admin/collections/quality-assessments">
            {t.openRecord}
          </WorkspaceAction>
        </article>

        <article className={`${cardClass} flex flex-col gap-4 p-5`}>
          <div className="flex items-center gap-3">
            <IconBadge tone={latestOperation?.["state"] === "failed" ? "danger" : "accent"}>
              <LayersIcon size={18} />
            </IconBadge>
            <div>
              <h2 className="m-0 text-base font-bold text-[var(--theme-text)]">{t.operation}</h2>
              <p className="m-0 mt-0.5 text-xs text-[var(--theme-elevation-600)]">
                {canReadOperations
                  ? stringOf(latestOperation?.["currentStage"], "—")
                  : t.operationRestricted}
              </p>
            </div>
          </div>
          {canReadOperations && latestOperation !== undefined && (
            <div className="flex items-center justify-between gap-3 border-t border-[var(--theme-elevation-100)] pt-3">
              <Badge tone={latestOperation["state"] === "failed" ? "danger" : "neutral"}>
                {operationStateLabel(latestOperation["state"], lang)}
              </Badge>
              <span className="text-xs text-[var(--theme-elevation-600)]">
                {formatDate(latestOperation["updatedAt"], lang)}
              </span>
            </div>
          )}
          {canReadOperations && latestOperation !== undefined && (
            <WorkspaceAction href={`/admin/work/operations/${idOf(latestOperation) ?? ""}`}>
              {t.openRecord}
            </WorkspaceAction>
          )}
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className={`${cardClass} flex flex-col gap-4 p-5`}>
          <h2 className="m-0 text-base font-bold text-[var(--theme-text)]">{t.publishing}</h2>
          {canReadReleases ? (
            <dl className="m-0 grid gap-3">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-sm text-[var(--theme-elevation-600)]">{t.release}</dt>
                <dd className="m-0 truncate font-mono text-sm text-[var(--theme-text)]">
                  {stringOf(release?.["releaseId"], compiledRelease || "—")}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-sm text-[var(--theme-elevation-600)]">{t.current}</dt>
                <dd className="m-0">
                  <Badge tone={release?.["state"] === "current" ? "success" : "neutral"}>
                    {releaseStateLabel(release?.["state"], lang)}
                  </Badge>
                </dd>
              </div>
            </dl>
          ) : (
            <p className="m-0 text-sm text-[var(--theme-elevation-600)]">{t.releaseRestricted}</p>
          )}
          {canReadReleases && (
            <WorkspaceAction href="/admin/collections/releases">{t.openRecord}</WorkspaceAction>
          )}
        </article>

        <article className={`${cardClass} flex flex-col gap-4 p-5`}>
          <div className="flex items-center gap-3">
            <IconBadge tone="neutral">
              <AlertTriangleIcon size={18} />
            </IconBadge>
            <h2 className="m-0 text-base font-bold text-[var(--theme-text)]">{t.audit}</h2>
          </div>
          <p className="m-0 text-sm text-[var(--theme-elevation-600)]">{t.diagnostics}</p>
          <WorkspaceAction href={`/admin/collections/content-editions/${editionId}`}>
            {t.openRecord}
          </WorkspaceAction>
        </article>
      </section>
    </WorkspaceShell>
  )
}
