import type { Payload, Where } from "payload"

import { CMS_ROLE, type CmsRole } from "../../access/roles"
import { uiLangOf, type HasLanguage } from "../i18n/ui-lang"
import { Badge } from "../ui/Badge"
import { IconBadge } from "../ui/IconBadge"
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  GlobeIcon,
  HelpCircleIcon,
  LayersIcon,
  PackageIcon,
  PencilIcon,
  SearchIcon,
  SendIcon,
  ShieldCheckIcon,
  UsersIcon,
} from "../icons"
import {
  formatDate,
  recordsOf,
  groupBySite,
  idOf,
  shortHash,
  stringOf,
  summarizeDomains,
  WORKFLOW_STATES,
  workflowCounts,
  type RecordLike,
} from "./operations-model"

type DashboardProps = {
  /** Passed by Payload's dashboard view (ServerProps slice); defaults to zh. */
  readonly i18n?: HasLanguage
  readonly payload: Payload
  readonly user?: {
    readonly role?: unknown
  }
}

type ReadableRole = Exclude<CmsRole, "content-service">

type Panel = {
  readonly count: number
  readonly href: string
  readonly Icon: typeof SearchIcon
  readonly items: readonly RecordLike[]
  readonly label: string
  readonly tone: "danger" | "neutral" | "warning"
}

const humanRoles = new Set<ReadableRole>([
  CMS_ROLE.EDITOR,
  CMS_ROLE.PUBLISHER,
  CMS_ROLE.REVIEWER,
  CMS_ROLE.SUPER_ADMIN,
  CMS_ROLE.TENANT_ADMIN,
])

const rolesWithOperations = new Set<CmsRole>([
  CMS_ROLE.EDITOR,
  CMS_ROLE.PUBLISHER,
  CMS_ROLE.SUPER_ADMIN,
  CMS_ROLE.TENANT_ADMIN,
])

const rolesWithReleases = new Set<CmsRole>([
  CMS_ROLE.PUBLISHER,
  CMS_ROLE.SUPER_ADMIN,
  CMS_ROLE.TENANT_ADMIN,
])

const ROLE_LABEL = {
  en: {
    editor: "Content production queue",
    publisher: "Publishing control plane",
    reviewer: "Review & evidence queue",
    "super-admin": "Cross-tenant global overview",
    "tenant-admin": "Tenant operations overview",
  } satisfies Record<ReadableRole, string>,
  zh: {
    editor: "内容生产队列",
    publisher: "发布控制面",
    reviewer: "审核与证据队列",
    "super-admin": "跨租户全局总览",
    "tenant-admin": "租户运营总览",
  } satisfies Record<ReadableRole, string>,
}

const WORKFLOW_STATE_LABEL = {
  en: {
    approved: "Approved",
    archived: "Archived",
    compiled: "Compiled",
    draft: "Draft",
    generating: "Generating",
    published: "Published",
    review: "In review",
  },
  zh: {
    approved: "已批准",
    archived: "已归档",
    compiled: "已编译",
    draft: "草稿",
    generating: "生成中",
    published: "已发布",
    review: "审核中",
  },
}

const SITE_STATUS_LABEL: Record<"en" | "zh", Record<string, string>> = {
  en: { active: "Active", disabled: "Disabled" },
  zh: { active: "启用", disabled: "停用" },
}

const TEXT = {
  en: {
    allTenants: "All tenants",
    currentReleases: "Current releases",
    currentTenant: "Current tenant",
    denialHeadline: "This identity cannot use the operations console",
    denialBody:
      "Service identities should use the internal integration API instead of the human console.",
    domainLabel: "Domain",
    domainsToConfigure: "Domains to configure",
    domainsToConfigureNote: "No canonical hostname",
    domainsUnset: "Not configured",
    failedOperations: "Failed operations",
    kicker: "Geo Foundry",
    liveScope: "Live · access-scoped",
    needsAttention: "Needs attention",
    needsAttentionHint: "work awaiting a decision or follow-up",
    noCurrentReleases: "No current releases in your scope.",
    noOperations: "No operations in your scope.",
    noPendingRollbacks: "No approved rollback intents pending.",
    openSitesWorkspace: "Open sites workspace →",
    pageHeading: "Operations console",
    publisherRequired: "Requires publisher role",
    qualityEvidence: "Quality evidence",
    readyToPublish: "Ready to publish",
    readyToPublishNote: "Compiled editions",
    recentOperations: "Recent operations",
    releaseLabel: "Release",
    releaseLedgerNote: "Verified release ledger",
    releaseHistoryLink: "Release ledger →",
    releaseNone: "None",
    releasesCard: "Current releases",
    restricted: "Restricted",
    restrictedRoleView: "Restricted view",
    reviewQueue: "Review queue",
    rollbackCard: "Pending rollbacks",
    rollbackIntentsLink: "Rollback intents →",
    rollbackTarget: "target",
    scopeCount: (count: number) => `In your scope · ${count} item${count === 1 ? "" : "s"}`,
    seeAllEditions: "View all editions →",
    seeOperations: "Operations ledger →",
    seeQueue: "View queue →",
    siteFleet: "Site fleet",
    siteFleetHint: "configuration & release status",
    sitesActive: (count: number) => `${count} active`,
    sitesCount: "Sites",
    sitesNote: "Visible to your role",
    unknownSite: "Unknown site",
    workflowPipeline: "Workflow pipeline",
    workflowTooltip:
      "Seven states from draft to published; click any state to see the matching content editions.",
    workload: "Workload",
    workloadLine: (c: { compiled: number; review: number }) =>
      `${c.review} in review · ${c.compiled} compiled`,
    attempt: (n: string) => `attempt ${n}`,
    quickCreateContent: "Create content",
    quickUploadMedia: "Upload media",
    quickOpenReviewQueue: "Open review queue",
    quickQualityEvidence: "Quality evidence",
    quickReadyToPublish: "Ready to publish",
    quickReleaseLedger: "Release ledger",
    quickSitesDomains: "Sites & domains",
    quickTenantUsers: "Tenant users",
    quickAllSites: "All sites",
    quickAllOperations: "All operations",
    quickEditions: "Editions",
  },
  zh: {
    allTenants: "全部租户",
    currentReleases: "当前发布版本",
    currentTenant: "当前租户",
    denialHeadline: "此身份不可使用运营控制台",
    denialBody: "服务身份请使用内部集成接口，而非人工控制台。",
    domainLabel: "域名",
    domainsToConfigure: "待配置域名",
    domainsToConfigureNote: "无有效主域名",
    domainsUnset: "待配置",
    failedOperations: "失败的操作",
    kicker: "Geo Foundry",
    liveScope: "实时 · 按权限范围",
    needsAttention: "待处理事项",
    needsAttentionHint: "需要决策或跟进的工作",
    noCurrentReleases: "您的权限范围内暂无当前发布版本。",
    noOperations: "您的权限范围内暂无操作记录。",
    noPendingRollbacks: "没有待处理的已批准回滚意图。",
    openSitesWorkspace: "打开站点工作区 →",
    pageHeading: "运营控制台",
    publisherRequired: "需要发布权限",
    qualityEvidence: "质量证据待处理",
    readyToPublish: "待发布",
    readyToPublishNote: "已编译版本",
    recentOperations: "最近操作",
    releaseLabel: "发布版本",
    releaseLedgerNote: "已验证发布台账",
    releaseHistoryLink: "发布台账 →",
    releaseNone: "暂无",
    releasesCard: "当前发布版本",
    restricted: "受限",
    restrictedRoleView: "受限运营视图",
    reviewQueue: "审核队列",
    rollbackCard: "待处理回滚",
    rollbackIntentsLink: "回滚意图 →",
    rollbackTarget: "目标",
    scopeCount: (count: number) => `在您的权限范围内 · ${count} 条`,
    seeAllEditions: "查看全部版本 →",
    seeOperations: "操作台账 →",
    seeQueue: "查看队列 →",
    siteFleet: "站点概览",
    siteFleetHint: "配置与发布状态",
    sitesActive: (count: number) => `${count} 个启用`,
    sitesCount: "站点",
    sitesNote: "您的角色可见范围",
    unknownSite: "未知站点",
    workflowPipeline: "工作流管线",
    workflowTooltip: "内容从草稿到发布的七个流转状态，点击任意状态查看对应的内容版本列表。",
    workload: "工作量",
    workloadLine: (c: { compiled: number; review: number }) =>
      `${c.review} 待审核 · ${c.compiled} 已编译`,
    attempt: (n: string) => `第 ${n} 次尝试`,
    quickCreateContent: "创建内容",
    quickUploadMedia: "上传媒体",
    quickOpenReviewQueue: "打开审核队列",
    quickQualityEvidence: "质量证据",
    quickReadyToPublish: "待发布",
    quickReleaseLedger: "发布台账",
    quickSitesDomains: "站点与域名",
    quickTenantUsers: "租户用户",
    quickAllSites: "全部站点",
    quickAllOperations: "全部操作",
    quickEditions: "内容版本",
  },
}

type DashboardText = (typeof TEXT)["zh"]

const safeFind = async (
  payload: Payload,
  user: DashboardProps["user"],
  collection: Parameters<Payload["find"]>[0]["collection"],
  options: Omit<Parameters<Payload["find"]>[0], "collection" | "overrideAccess" | "user"> = {},
) =>
  payload.find({
    collection,
    limit: 100,
    overrideAccess: false,
    ...(user === undefined ? {} : { user }),
    ...options,
  })

const itemLabel = (row: RecordLike, fallback: string): string =>
  stringOf(row["title"], stringOf(row["operationType"], stringOf(row["inputHash"], fallback)))

const siteNameFor = (
  site: unknown,
  sites: Map<string, RecordLike>,
  unknownSite: string,
): string => {
  const id = idOf(site)
  return id === null ? unknownSite : stringOf(sites.get(id)?.["name"], unknownSite)
}

const cardClass =
  "rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] shadow-[var(--gf-shadow-surface)]"

/**
 * Section heading: prominent title (big/bold/dark) with the explanatory
 * intro demoted to quiet gray — inline after the title when short, or
 * behind a help-icon tooltip when it would clutter the row.
 */
const SectionHeading = ({
  title,
  hint,
  tooltip,
}: {
  readonly title: string
  readonly hint?: string
  readonly tooltip?: string
}) => (
  <div className="min-w-0">
    <h2 className="m-0 flex flex-wrap items-baseline gap-x-2 text-lg font-bold tracking-tight text-[var(--theme-elevation-900)]">
      {title}
      {tooltip !== undefined && (
        <span className="group relative inline-flex cursor-help py-0.5 align-baseline text-[var(--theme-elevation-400)]">
          <HelpCircleIcon size={14} strokeWidth={1.9} />
          <span className="pointer-events-none absolute top-full left-1/2 z-30 mt-1.5 w-56 -translate-x-1/2 rounded-lg bg-[var(--theme-elevation-900)] px-2.5 py-2 text-left text-xs font-normal leading-relaxed text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
            {tooltip}
          </span>
        </span>
      )}
      {hint !== undefined && (
        <span className="text-xs font-normal text-[var(--theme-elevation-500)]">{hint}</span>
      )}
    </h2>
  </div>
)

const metric = (
  value: number | "Restricted",
  label: string,
  note: string,
  t: DashboardText,
  tone: "neutral" | "warning" = "neutral",
) => (
  <article
    className={`${cardClass} flex flex-col gap-1 p-5 ${
      tone === "warning" ? "border-l-[3px] border-l-[var(--theme-warning-500)]" : ""
    }`}
  >
    {value === "Restricted" ? (
      <Badge>{t.restricted}</Badge>
    ) : (
      <strong className="text-[28px] font-semibold leading-8 tracking-tight tabular-nums text-[var(--theme-text)]">
        {value}
      </strong>
    )}
    <span className="text-sm font-bold text-[var(--theme-text)]">{label}</span>
    <small className="text-xs text-[var(--theme-elevation-600)]">{note}</small>
  </article>
)

const queuePanel = (panel: Panel, sites: Map<string, RecordLike>, t: DashboardText) => (
  <article className={`${cardClass} flex flex-col gap-4 p-5`}>
    <div className="flex items-center gap-3">
      <IconBadge tone={panel.count > 0 ? panel.tone : "neutral"}>
        <panel.Icon size={18} strokeWidth={1.9} />
      </IconBadge>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-bold text-[var(--theme-elevation-900)]">{panel.label}</h3>
        <p className="text-xs text-[var(--theme-elevation-600)]">{t.scopeCount(panel.count)}</p>
      </div>
      <a
        className="shrink-0 whitespace-nowrap text-xs font-bold text-[var(--gf-accent-700)] no-underline hover:underline"
        href={panel.href}
      >
        {t.seeQueue}
      </a>
    </div>
    {/*
     * No empty-state copy: the header count already says there's nothing to
     * act on (user direction 2026-08-24).
     */}
    {panel.items.length > 0 && (
      <ul className="m-0 flex list-none flex-col p-0">
        {panel.items.map((item) => {
          const id = idOf(item)
          const site = siteNameFor(item["site"], sites, t.unknownSite)
          return (
            <li
              className="grid gap-0.5 border-t border-[var(--theme-elevation-100)] py-2.5 first:border-t-0 first:pt-0"
              key={id ?? itemLabel(item, panel.label)}
            >
              <a
                className="truncate text-sm font-semibold text-[var(--theme-text)] no-underline hover:underline"
                href={id === null ? panel.href : `${panel.href}/${id}`}
              >
                {itemLabel(item, panel.label)}
              </a>
              <span className="text-xs text-[var(--theme-elevation-600)]">
                {site} · {formatDate(item["updatedAt"] ?? item["createdAt"] ?? item["lastStageAt"])}
              </span>
            </li>
          )
        })}
      </ul>
    )}
  </article>
)

/**
 * Human operations dashboard. Every query deliberately runs through Payload
 * access control, so role permissions and tenant scope stay authoritative.
 */
export const OperationsDashboard = async ({ i18n, payload, user }: DashboardProps) => {
  const lang = uiLangOf(i18n?.language)
  const t = TEXT[lang]
  const role = user?.role
  if (!humanRoles.has(role as ReadableRole)) {
    return (
      <main className="mx-auto max-w-[1440px] p-8 md:p-6">
        <section className={`${cardClass} grid gap-2 p-10`}>
          <p className="m-0 text-xs font-extrabold uppercase tracking-[0.06em] text-[var(--gf-accent-700)]">
            {t.kicker}
          </p>
          <h1 className="m-0 text-2xl font-semibold text-[var(--theme-text)]">
            {t.denialHeadline}
          </h1>
          <span className="text-sm text-[var(--theme-elevation-600)]">{t.denialBody}</span>
        </section>
      </main>
    )
  }

  const canReadOperations = rolesWithOperations.has(role as CmsRole)
  const canReadReleases = rolesWithReleases.has(role as CmsRole)
  const [
    sitesResult,
    domainsResult,
    editionsResult,
    assessmentsResult,
    operationsResult,
    releasesResult,
    rollbackResult,
  ] = await Promise.all([
    safeFind(payload, user, "sites", { depth: 0, sort: "name" }),
    safeFind(payload, user, "domains", { depth: 0, sort: "hostname" }),
    safeFind(payload, user, "content-editions", {
      depth: 0,
      draft: true,
      sort: "-updatedAt",
    }),
    safeFind(payload, user, "quality-assessments", {
      depth: 0,
      sort: "-createdAt",
      where: { state: { in: ["failed", "error"] } } as Where,
    }),
    canReadOperations
      ? safeFind(payload, user, "operations", { depth: 0, sort: "-updatedAt" })
      : Promise.resolve({ docs: [] as unknown[] }),
    canReadReleases
      ? safeFind(payload, user, "releases", { depth: 0, sort: "-updatedAt" })
      : Promise.resolve({ docs: [] as unknown[] }),
    canReadReleases
      ? safeFind(payload, user, "rollback-intents", { depth: 0, sort: "-createdAt" })
      : Promise.resolve({ docs: [] as unknown[] }),
  ])

  const sites = recordsOf(sitesResult.docs)
  const editions = recordsOf(editionsResult.docs)
  const assessments = recordsOf(assessmentsResult.docs)
  const operations = recordsOf(operationsResult.docs)
  const releases = recordsOf(releasesResult.docs)
  const rollbackIntents = recordsOf(rollbackResult.docs)
  const sitesById = new Map(
    sites
      .map((site) => [idOf(site), site])
      .filter((entry): entry is [string, RecordLike] => entry[0] !== null),
  )
  const domainBySite = summarizeDomains(recordsOf(domainsResult.docs))
  const editionCounts = workflowCounts(editions)
  const editionsBySite = groupBySite(editions)
  const currentReleases = releases.filter((release) => release["state"] === "current")
  const failedOperations = operations.filter((operation) => operation["state"] === "failed")
  const pendingRollback = rollbackIntents.filter(
    (intent) => intent["consumedAt"] === null || intent["consumedAt"] === undefined,
  )
  const domainSetupNeeded = sites.filter((site) => {
    const summary = domainBySite.get(idOf(site) ?? "")
    return summary?.canonicalHostname === null || summary === undefined
  }).length
  const activeSites = sites.filter((site) => site["status"] === "active").length

  const panels: readonly Panel[] = [
    {
      Icon: SearchIcon,
      count: editionCounts.review,
      href: "/admin/collections/content-editions?where[workflowStatus][equals]=review",
      items: editions.filter((edition) => edition["workflowStatus"] === "review").slice(0, 3),
      label: t.reviewQueue,
      tone: "warning",
    },
    {
      Icon: SendIcon,
      count: editionCounts.compiled,
      href: "/admin/collections/content-editions?where[workflowStatus][equals]=compiled",
      items: editions.filter((edition) => edition["workflowStatus"] === "compiled").slice(0, 3),
      label: t.readyToPublish,
      tone: "neutral",
    },
    {
      Icon: ShieldCheckIcon,
      count: assessments.length,
      href: "/admin/collections/quality-assessments",
      items: assessments.slice(0, 3),
      label: t.qualityEvidence,
      tone: "warning",
    },
    ...(canReadOperations
      ? [
          {
            Icon: AlertTriangleIcon,
            count: failedOperations.length,
            href: "/admin/collections/operations?where[state][equals]=failed",
            items: failedOperations.slice(0, 3),
            label: t.failedOperations,
            tone: "danger" as const,
          },
        ]
      : []),
  ]

  const roleLabel = ROLE_LABEL[lang][role as ReadableRole] ?? t.restrictedRoleView

  return (
    <main className="mx-auto flex max-w-[1440px] flex-col gap-10 p-8 md:gap-8 md:p-6">
      <header className="flex flex-col items-start justify-between gap-3 border-b border-[var(--gf-border)] pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="m-0 mb-1 text-xs font-extrabold uppercase tracking-[0.06em] text-[var(--gf-accent-700)]">
            {t.kicker}
          </p>
          <h1 className="m-0 text-[28px] font-bold leading-9 tracking-tight text-[var(--theme-elevation-900)] md:text-2xl">
            {t.pageHeading}
          </h1>
          <span className="mt-1 block text-sm text-[var(--theme-elevation-600)]">{roleLabel}</span>
        </div>
        <strong className="shrink-0 whitespace-nowrap rounded-full bg-[var(--theme-elevation-100)] px-3 py-1.5 text-xs font-bold text-[var(--theme-elevation-700)]">
          {role === CMS_ROLE.SUPER_ADMIN ? t.allTenants : t.currentTenant}
        </strong>
      </header>

      <section aria-label="Operational attention" className="flex flex-col gap-4">
        <div className="flex items-end justify-between gap-3">
          <SectionHeading hint={t.needsAttentionHint} title={t.needsAttention} />
          <span className="hidden shrink-0 text-xs text-[var(--theme-elevation-600)] sm:block">
            {t.liveScope}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {panels.map((panel) => (
            <div key={panel.label}>{queuePanel(panel, sitesById, t)}</div>
          ))}
        </div>
      </section>

      <section aria-label="Workflow pipeline" className="flex flex-col gap-4">
        <div className="flex items-end justify-between gap-3">
          <SectionHeading title={t.workflowPipeline} tooltip={t.workflowTooltip} />
          <a
            className="shrink-0 whitespace-nowrap text-xs font-bold text-[var(--gf-accent-700)] no-underline hover:underline"
            href="/admin/collections/content-editions"
          >
            {t.seeAllEditions}
          </a>
        </div>
        <ol className="grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-4 xl:grid-cols-7">
          {WORKFLOW_STATES.map((state) => (
            <li
              className={`rounded-xl border bg-[var(--theme-elevation-50)] ${
                editionCounts[state] > 0
                  ? "border-[var(--gf-accent-300)]"
                  : "border-[var(--gf-border)]"
              }`}
              key={state}
            >
              <a
                className="grid min-h-[84px] gap-1 p-3.5 no-underline"
                href={`/admin/collections/content-editions?where[workflowStatus][equals]=${state}`}
              >
                <span className="text-xs text-[var(--theme-elevation-600)]">
                  {WORKFLOW_STATE_LABEL[lang][state] ?? state}
                </span>
                <strong className="text-2xl font-semibold leading-7 tracking-tight tabular-nums text-[var(--theme-text)]">
                  {editionCounts[state]}
                </strong>
              </a>
            </li>
          ))}
        </ol>
      </section>

      <section aria-label="Site fleet" className="flex flex-col gap-4">
        <div className="flex items-end justify-between gap-3">
          <SectionHeading hint={t.siteFleetHint} title={t.siteFleet} />
          <a
            className="shrink-0 whitespace-nowrap text-xs font-bold text-[var(--gf-accent-700)] no-underline hover:underline"
            href="/admin/collections/sites"
          >
            {t.openSitesWorkspace}
          </a>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {metric(sites.length, t.sitesCount, t.sitesActive(activeSites), t)}
          {metric(
            domainSetupNeeded,
            t.domainsToConfigure,
            t.domainsToConfigureNote,
            t,
            domainSetupNeeded > 0 ? "warning" : "neutral",
          )}
          {metric(
            canReadReleases ? currentReleases.length : "Restricted",
            t.currentReleases,
            canReadReleases ? t.releaseLedgerNote : t.publisherRequired,
            t,
          )}
          {metric(
            editionCounts.compiled,
            t.readyToPublish,
            t.readyToPublishNote,
            t,
            editionCounts.compiled > 0 ? "warning" : "neutral",
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {sites.slice(0, 4).map((site) => {
            const siteId = idOf(site) ?? ""
            const domain = domainBySite.get(siteId)
            const currentRelease = currentReleases.find(
              (release) => idOf(release["site"]) === siteId,
            )
            const counts = workflowCounts(editionsBySite.get(siteId) ?? [])
            const active = site["status"] === "active"
            return (
              <article className={`${cardClass} flex flex-col gap-4 p-5`} key={siteId}>
                <div>
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold capitalize ${
                      active
                        ? "bg-[var(--gf-tone-success-bg)] text-[var(--gf-tone-success-fg)]"
                        : "bg-[var(--theme-elevation-150)] text-[var(--theme-elevation-700)]"
                    }`}
                  >
                    {SITE_STATUS_LABEL[lang][stringOf(site["status"])] ?? stringOf(site["status"])}
                  </span>
                  <h3 className="mt-1.5 text-base font-semibold tracking-tight">
                    <a
                      className="text-[var(--theme-text)] no-underline hover:underline"
                      href={`/admin/collections/sites/${siteId}`}
                    >
                      {stringOf(site["name"])}
                    </a>
                  </h3>
                  <p className="m-0 mt-0.5 text-xs text-[var(--theme-elevation-600)]">
                    {stringOf(site["locale"])} · {stringOf(site["timezone"])}
                  </p>
                </div>
                <dl className="m-0 grid gap-2">
                  <div className="grid grid-cols-[64px_1fr] items-baseline gap-2">
                    <dt className="text-xs text-[var(--theme-elevation-600)]">{t.domainLabel}</dt>
                    <dd className="m-0 truncate text-sm text-[var(--theme-text)]">
                      {domain?.canonicalHostname ?? t.domainsUnset}
                    </dd>
                  </div>
                  <div className="grid grid-cols-[64px_1fr] items-baseline gap-2">
                    <dt className="text-xs text-[var(--theme-elevation-600)]">{t.releaseLabel}</dt>
                    <dd className="m-0 truncate font-mono text-sm text-[var(--theme-text)]">
                      {canReadReleases
                        ? stringOf(currentRelease?.["releaseId"], t.releaseNone)
                        : t.restricted}
                    </dd>
                  </div>
                  <div className="grid grid-cols-[64px_1fr] items-baseline gap-2">
                    <dt className="text-xs text-[var(--theme-elevation-600)]">{t.workload}</dt>
                    <dd className="m-0 text-sm text-[var(--theme-text)]">
                      {t.workloadLine(counts)}
                    </dd>
                  </div>
                </dl>
              </article>
            )
          })}
        </div>
      </section>

      {(canReadOperations || canReadReleases) && (
        <section
          aria-label="Release and activity"
          className="grid grid-cols-1 gap-4 lg:grid-cols-3"
        >
          {canReadReleases && (
            <article className={`${cardClass} flex flex-col gap-4 p-5`}>
              <div className="flex items-center gap-3">
                <IconBadge tone="accent">
                  <PackageIcon size={18} strokeWidth={1.9} />
                </IconBadge>
                <h2 className="flex-1 text-sm font-bold text-[var(--theme-elevation-900)]">
                  {t.releasesCard}
                </h2>
                <a
                  className="shrink-0 whitespace-nowrap text-xs font-bold text-[var(--gf-accent-700)] no-underline hover:underline"
                  href="/admin/collections/releases"
                >
                  {t.releaseHistoryLink}
                </a>
              </div>
              {currentReleases.length === 0 ? (
                <p className="m-0 text-sm text-[var(--theme-elevation-600)]">
                  {t.noCurrentReleases}
                </p>
              ) : (
                <ul className="m-0 flex list-none flex-col p-0">
                  {currentReleases.slice(0, 5).map((release) => {
                    const releaseId = idOf(release) ?? ""
                    return (
                      <li
                        className="grid gap-0.5 border-t border-[var(--theme-elevation-100)] py-2.5 first:border-t-0 first:pt-0"
                        key={releaseId}
                      >
                        <a
                          className="truncate font-mono text-sm font-semibold text-[var(--theme-text)] no-underline hover:underline"
                          href={`/admin/collections/releases/${releaseId}`}
                        >
                          {stringOf(release["releaseId"])}
                        </a>
                        <span className="text-xs text-[var(--theme-elevation-600)]">
                          {siteNameFor(release["site"], sitesById, t.unknownSite)} ·{" "}
                          {formatDate(release["updatedAt"])}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </article>
          )}
          {canReadOperations && (
            <article className={`${cardClass} flex flex-col gap-4 p-5`}>
              <div className="flex items-center gap-3">
                <IconBadge tone="neutral">
                  <LayersIcon size={18} strokeWidth={1.9} />
                </IconBadge>
                <h2 className="flex-1 text-sm font-bold text-[var(--theme-elevation-900)]">
                  {t.recentOperations}
                </h2>
                <a
                  className="shrink-0 whitespace-nowrap text-xs font-bold text-[var(--gf-accent-700)] no-underline hover:underline"
                  href="/admin/collections/operations"
                >
                  {t.seeOperations}
                </a>
              </div>
              {operations.length === 0 ? (
                <p className="m-0 text-sm text-[var(--theme-elevation-600)]">{t.noOperations}</p>
              ) : (
                <ul className="m-0 flex list-none flex-col p-0">
                  {operations.slice(0, 5).map((operation) => {
                    const operationId = idOf(operation) ?? ""
                    return (
                      <li
                        className="grid gap-0.5 border-t border-[var(--theme-elevation-100)] py-2.5 first:border-t-0 first:pt-0"
                        key={operationId}
                      >
                        <a
                          className="truncate text-sm font-semibold text-[var(--theme-text)] no-underline hover:underline"
                          href={`/admin/collections/operations/${operationId}`}
                        >
                          {stringOf(operation["operationType"])} · {stringOf(operation["state"])}
                        </a>
                        <span className="text-xs text-[var(--theme-elevation-600)]">
                          {siteNameFor(operation["site"], sitesById, t.unknownSite)} ·{" "}
                          {formatDate(operation["updatedAt"])} ·{" "}
                          {t.attempt(stringOf(operation["attempt"], "1"))}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </article>
          )}
          {canReadReleases && (
            <article className={`${cardClass} flex flex-col gap-4 p-5`}>
              <div className="flex items-center gap-3">
                <IconBadge tone={pendingRollback.length > 0 ? "danger" : "neutral"}>
                  <AlertTriangleIcon size={18} strokeWidth={1.9} />
                </IconBadge>
                <h2 className="flex-1 text-sm font-bold text-[var(--theme-elevation-900)]">
                  {t.rollbackCard}
                </h2>
                <a
                  className="shrink-0 whitespace-nowrap text-xs font-bold text-[var(--gf-accent-700)] no-underline hover:underline"
                  href="/admin/collections/rollback-intents"
                >
                  {t.rollbackIntentsLink}
                </a>
              </div>
              {pendingRollback.length === 0 ? (
                <p className="m-0 text-sm text-[var(--theme-elevation-600)]">
                  {t.noPendingRollbacks}
                </p>
              ) : (
                <ul className="m-0 flex list-none flex-col p-0">
                  {pendingRollback.slice(0, 5).map((intent) => (
                    <li
                      className="grid gap-0.5 border-t border-[var(--theme-elevation-100)] py-2.5 first:border-t-0 first:pt-0"
                      key={idOf(intent) ?? stringOf(intent["intentId"])}
                    >
                      <a
                        className="truncate font-mono text-sm font-semibold text-[var(--theme-text)] no-underline hover:underline"
                        href={`/admin/collections/rollback-intents/${idOf(intent)}`}
                      >
                        {stringOf(intent["intentId"])}
                      </a>
                      <span className="text-xs text-[var(--theme-elevation-600)]">
                        {siteNameFor(intent["site"], sitesById, t.unknownSite)} ·{" "}
                        {t.rollbackTarget} {shortHash(intent["targetReleaseId"])}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          )}
        </section>
      )}

      <section aria-label="Quick links" className="flex flex-wrap gap-2">
        {role === CMS_ROLE.EDITOR && (
          <>
            <a
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--theme-elevation-100)] px-3 py-2 text-xs font-bold text-[var(--theme-text)] no-underline hover:bg-[var(--gf-tone-accent-bg)]"
              href="/admin/collections/contents/create"
            >
              <PencilIcon size={17} /> {t.quickCreateContent}
            </a>
            <a
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--theme-elevation-100)] px-3 py-2 text-xs font-bold text-[var(--theme-text)] no-underline hover:bg-[var(--gf-tone-accent-bg)]"
              href="/admin/collections/media/create"
            >
              <GlobeIcon size={17} /> {t.quickUploadMedia}
            </a>
          </>
        )}
        {role === CMS_ROLE.REVIEWER && (
          <>
            <a
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--theme-elevation-100)] px-3 py-2 text-xs font-bold text-[var(--theme-text)] no-underline hover:bg-[var(--gf-tone-accent-bg)]"
              href="/admin/collections/content-editions?where[workflowStatus][equals]=review"
            >
              <SearchIcon size={17} /> {t.quickOpenReviewQueue}
            </a>
            <a
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--theme-elevation-100)] px-3 py-2 text-xs font-bold text-[var(--theme-text)] no-underline hover:bg-[var(--gf-tone-accent-bg)]"
              href="/admin/collections/quality-assessments"
            >
              <ShieldCheckIcon size={17} /> {t.quickQualityEvidence}
            </a>
          </>
        )}
        {role === CMS_ROLE.PUBLISHER && (
          <>
            <a
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--theme-elevation-100)] px-3 py-2 text-xs font-bold text-[var(--theme-text)] no-underline hover:bg-[var(--gf-tone-accent-bg)]"
              href="/admin/collections/content-editions?where[workflowStatus][equals]=compiled"
            >
              <SendIcon size={17} /> {t.quickReadyToPublish}
            </a>
            <a
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--theme-elevation-100)] px-3 py-2 text-xs font-bold text-[var(--theme-text)] no-underline hover:bg-[var(--gf-tone-accent-bg)]"
              href="/admin/collections/releases"
            >
              <PackageIcon size={17} /> {t.quickReleaseLedger}
            </a>
          </>
        )}
        {role === CMS_ROLE.TENANT_ADMIN && (
          <>
            <a
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--theme-elevation-100)] px-3 py-2 text-xs font-bold text-[var(--theme-text)] no-underline hover:bg-[var(--gf-tone-accent-bg)]"
              href="/admin/collections/sites"
            >
              <GlobeIcon size={17} /> {t.quickSitesDomains}
            </a>
            <a
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--theme-elevation-100)] px-3 py-2 text-xs font-bold text-[var(--theme-text)] no-underline hover:bg-[var(--gf-tone-accent-bg)]"
              href="/admin/collections/users"
            >
              <UsersIcon size={17} /> {t.quickTenantUsers}
            </a>
          </>
        )}
        {role === CMS_ROLE.SUPER_ADMIN && (
          <>
            <a
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--theme-elevation-100)] px-3 py-2 text-xs font-bold text-[var(--theme-text)] no-underline hover:bg-[var(--gf-tone-accent-bg)]"
              href="/admin/collections/sites"
            >
              <GlobeIcon size={17} /> {t.quickAllSites}
            </a>
            <a
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--theme-elevation-100)] px-3 py-2 text-xs font-bold text-[var(--theme-text)] no-underline hover:bg-[var(--gf-tone-accent-bg)]"
              href="/admin/collections/operations"
            >
              <LayersIcon size={17} /> {t.quickAllOperations}
            </a>
          </>
        )}
        <a
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--theme-elevation-100)] px-3 py-2 text-xs font-bold text-[var(--theme-text)] no-underline hover:bg-[var(--gf-tone-accent-bg)]"
          href="/admin/collections/content-editions"
        >
          <CheckCircleIcon size={17} /> {t.quickEditions}
        </a>
      </section>
    </main>
  )
}
