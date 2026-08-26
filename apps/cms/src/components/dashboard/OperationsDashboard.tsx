import type { ComponentType, CSSProperties, ReactNode } from "react"
import type { Payload, Where } from "payload"

import { CMS_ROLE, type CmsRole } from "../../access/roles"
import { uiLangOf, type HasLanguage } from "../i18n/ui-lang"
import { ActionLink, Badge, IconBadge, type ActionLinkVariant, type Tone } from "../ui"
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
  groupBySite,
  idOf,
  operationHealth,
  OPERATION_STATES,
  OPERATION_TYPES,
  recordsOf,
  shortHash,
  siteReadiness,
  sortSiteWorkload,
  stringOf,
  summarizeDomains,
  WORKFLOW_STATES,
  workflowBottleneck,
  workflowCounts,
  type DashboardLanguage,
  type OperationState,
  type RecordLike,
  type SiteReadiness,
  type WorkflowState,
} from "./operations-model"

type DashboardProps = {
  readonly i18n?: HasLanguage
  readonly payload: Payload
  readonly user?: {
    readonly role?: unknown
  }
}

type ReadableRole = Exclude<CmsRole, "content-service">

type DashboardText = (typeof TEXT)["zh"]
type Icon = ComponentType<{ readonly size?: number; readonly strokeWidth?: number }>

type AttentionItem = {
  readonly href: string
  readonly meta: string
  readonly title: string
}

type AttentionPanel = {
  readonly count: number
  readonly href: string
  readonly Icon: Icon
  readonly items: readonly AttentionItem[]
  readonly label: string
  readonly tone: Tone
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

const WORKFLOW_STATE_LABEL: Record<DashboardLanguage, Record<WorkflowState, string>> = {
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

const OPERATION_TYPE_LABEL: Record<DashboardLanguage, Record<string, string>> = {
  en: { evaluate: "Evaluate", generate: "Generate", publish: "Publish", rollback: "Rollback" },
  zh: { evaluate: "质量评估", generate: "内容生成", publish: "发布", rollback: "回滚" },
}

const OPERATION_STATE_LABEL: Record<DashboardLanguage, Record<OperationState, string>> = {
  en: {
    cancelled: "Cancelled",
    failed: "Failed",
    queued: "Queued",
    running: "Running",
    succeeded: "Succeeded",
  },
  zh: {
    cancelled: "已取消",
    failed: "失败",
    queued: "排队中",
    running: "进行中",
    succeeded: "成功",
  },
}

const READINESS_LABEL: Record<DashboardLanguage, Record<SiteReadiness, string>> = {
  en: {
    configure: "Needs domain setup",
    disabled: "Disabled",
    publish: "Needs first release",
    ready: "Configuration ready",
    restricted: "Release state restricted",
  },
  zh: {
    configure: "待配置主域名",
    disabled: "已停用",
    publish: "待首次发布",
    ready: "配置就绪",
    restricted: "发布状态受限",
  },
}

const ROLE_LABEL: Record<DashboardLanguage, Record<ReadableRole, string>> = {
  en: {
    editor: "Content production queue",
    publisher: "Publishing control plane",
    reviewer: "Review & evidence queue",
    "super-admin": "Cross-tenant global overview",
    "tenant-admin": "Tenant operations overview",
  },
  zh: {
    editor: "内容生产队列",
    publisher: "发布控制面",
    reviewer: "审核与证据队列",
    "super-admin": "跨租户全局总览",
    "tenant-admin": "租户运营总览",
  },
}

const TEXT = {
  en: {
    activity: "Recent records",
    activityHint: "Latest records in your visible scope",
    allTenants: "All tenants",
    attentionCount: (count: number) => `${count} items need attention`,
    attentionHint: "Ordered by operational impact",
    bottleneck: (label: string, count: number) => `Current bottleneck: ${label} · ${count}`,
    configurationReadiness: "Configuration readiness",
    configurationReadinessHint: "Domain and current-release proxy; not uptime monitoring",
    configuredSites: (ready: number, total: number) => `${ready} / ${total} ready`,
    currentReleases: "Current releases",
    currentTenant: "Current tenant",
    denialBody:
      "Service identities should use the internal integration API instead of the human console.",
    denialHeadline: "This identity cannot use the operations console",
    domain: "Domain",
    domainRisk: "Domain configuration",
    domainsUnset: "No active canonical domain",
    failedOperations: "Failed operations",
    kicker: "Geo Foundry",
    latestRecords: "Recent records",
    liveScope: "Live · access-scoped",
    needsAttention: "Needs attention",
    noCurrentReleases: "No current releases in your scope.",
    noOperations: "No operations in your scope.",
    noPendingRollbacks: "No approved rollback intents pending.",
    noSites: "No sites are visible in your scope.",
    openSites: "Open sites",
    operationsHealth: "Operations health",
    operationsHealthHint: "Visible-record snapshot, not a time-window success rate",
    pageHeading: "Operations command center",
    publisherRequired: "Requires publisher role",
    qualityEvidence: "Quality evidence",
    readyToPublish: "Ready to publish",
    readinessCoverage: (shown: number, total: number) =>
      `Showing ${shown} of ${total} visible sites`,
    release: "Release",
    releaseLedger: "Release ledger",
    releaseNone: "None",
    restricted: "Restricted",
    reviewQueue: "Review queue",
    rollback: "Pending rollbacks",
    rollbackTarget: "target",
    scopeCount: (count: number) => `In your scope · ${count} item${count === 1 ? "" : "s"}`,
    seeAllEditions: "View all editions",
    seeAllSites: "View all sites",
    seeOperations: "Operations ledger",
    seeQueue: "Open queue",
    siteFleet: "Site workload",
    siteFleetHint: "Prioritized by configuration risk and actionable work",
    sites: "Sites",
    sitesActive: (count: number) => `${count} active`,
    summaryActive: "Active sites",
    summaryAttention: "At risk",
    summaryCompiled: "Ready to publish",
    summaryReview: "In review",
    takeAction: "Take action",
    unknownSite: "Unknown site",
    workload: "Workload",
    workloadStates: "Review · Approved · Compiled · Published",
    workflowPipeline: "Workflow pipeline",
    workflowTooltip:
      "Click a state to open the matching content editions. The highlighted bottleneck is the largest actionable queue.",
  },
  zh: {
    activity: "最近记录",
    activityHint: "您可见范围内的最新记录",
    allTenants: "全部租户",
    attentionCount: (count: number) => `${count} 项需要处理`,
    attentionHint: "按运营影响程度排序",
    bottleneck: (label: string, count: number) => `当前瓶颈：${label} · ${count}`,
    configurationReadiness: "配置就绪度",
    configurationReadinessHint: "主域名与当前发布版本的代理指标，不代表真实可用性监控",
    configuredSites: (ready: number, total: number) => `${ready} / ${total} 已就绪`,
    currentReleases: "当前发布版本",
    currentTenant: "当前租户",
    denialBody: "服务身份请使用内部集成接口，而非人工控制台。",
    denialHeadline: "此身份不可使用运营控制台",
    domain: "域名",
    domainRisk: "域名配置",
    domainsUnset: "无有效主域名",
    failedOperations: "失败的操作",
    kicker: "Geo Foundry",
    latestRecords: "最近记录",
    liveScope: "实时 · 按权限范围",
    needsAttention: "待处理事项",
    noCurrentReleases: "您的权限范围内暂无当前发布版本。",
    noOperations: "您的权限范围内暂无操作记录。",
    noPendingRollbacks: "没有待处理的已批准回滚意图。",
    noSites: "您的权限范围内暂无站点。",
    openSites: "查看站点",
    operationsHealth: "操作健康度",
    operationsHealthHint: "可见记录快照，不代表固定时间窗口的成功率",
    pageHeading: "运营指挥台",
    publisherRequired: "需要发布权限",
    qualityEvidence: "质量证据待处理",
    readyToPublish: "待发布",
    readinessCoverage: (shown: number, total: number) => `显示 ${shown} / ${total} 个可见站点`,
    release: "发布版本",
    releaseLedger: "发布台账",
    releaseNone: "暂无",
    restricted: "受限",
    reviewQueue: "审核队列",
    rollback: "待处理回滚",
    rollbackTarget: "目标",
    scopeCount: (count: number) => `在您的权限范围内 · ${count} 条`,
    seeAllEditions: "查看全部版本",
    seeAllSites: "查看全部站点",
    seeOperations: "操作台账",
    seeQueue: "打开队列",
    siteFleet: "站点工作负载",
    siteFleetHint: "按配置风险和可处理工作优先排序",
    sites: "站点",
    sitesActive: (count: number) => `${count} 个启用`,
    summaryActive: "启用站点",
    summaryAttention: "风险事项",
    summaryCompiled: "待发布",
    summaryReview: "待审核",
    takeAction: "立即处理",
    unknownSite: "未知站点",
    workload: "工作量",
    workloadStates: "审核中 · 已批准 · 已编译 · 已发布",
    workflowPipeline: "工作流管线",
    workflowTooltip: "点击任一状态可打开对应的内容版本。高亮瓶颈代表当前数量最多的可处理队列。",
  },
}

const cardClass =
  "rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] shadow-[var(--gf-shadow-surface)]"

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

const siteNameFor = (
  site: unknown,
  sites: ReadonlyMap<string, RecordLike>,
  fallback: string,
): string => {
  const id = idOf(site)
  return id === null ? fallback : stringOf(sites.get(id)?.["name"], fallback)
}

const itemLabel = (row: RecordLike, fallback: string): string =>
  stringOf(row["title"], stringOf(row["operationType"], stringOf(row["inputHash"], fallback)))

const statusTone = (value: unknown): Tone => {
  if (value === "failed" || value === "error") return "danger"
  if (value === "queued" || value === "running" || value === "review" || value === "compiled")
    return "warning"
  if (value === "succeeded" || value === "current" || value === "published") return "success"
  return "neutral"
}

const SectionHeading = ({
  action,
  hint,
  title,
  tooltip,
}: {
  readonly action?: ReactNode
  readonly hint?: string
  readonly title: string
  readonly tooltip?: string
}) => (
  <div className="flex items-end justify-between gap-3">
    <div className="min-w-0">
      <h2 className="m-0 flex flex-wrap items-baseline gap-x-2 text-xl font-bold tracking-tight text-[var(--theme-elevation-900)]">
        {title}
        {tooltip !== undefined && (
          <span className="group relative inline-flex cursor-help py-0.5 text-[var(--theme-elevation-400)]">
            <HelpCircleIcon size={15} strokeWidth={1.9} />
            <span className="pointer-events-none absolute top-full left-1/2 z-30 mt-2 w-64 -translate-x-1/2 rounded-lg bg-[var(--theme-elevation-900)] px-3 py-2 text-left text-xs font-normal leading-relaxed text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
              {tooltip}
            </span>
          </span>
        )}
      </h2>
      {hint !== undefined && (
        <p className="m-0 mt-1 text-sm text-[var(--theme-elevation-600)]">{hint}</p>
      )}
    </div>
    {action}
  </div>
)

const InlineAction = ({
  href,
  children,
  variant = "secondary",
}: {
  readonly children: ReactNode
  readonly href: string
  readonly variant?: ActionLinkVariant
}) => (
  <ActionLink href={href} variant={variant}>
    {children}
  </ActionLink>
)

const AttentionCard = ({ panel }: { readonly panel: AttentionPanel }) => (
  <article className={`${cardClass} flex min-h-[188px] flex-col gap-4 p-5`}>
    <div className="flex items-start gap-3">
      <IconBadge tone={panel.count > 0 ? panel.tone : "neutral"}>
        <panel.Icon size={18} strokeWidth={1.9} />
      </IconBadge>
      <div className="min-w-0 flex-1">
        <h3 className="m-0 text-sm font-bold text-[var(--theme-elevation-900)]">{panel.label}</h3>
        <p className="m-0 mt-0.5 text-xs text-[var(--theme-elevation-600)]">{panel.count}</p>
      </div>
      <a
        className="shrink-0 text-xs font-bold text-[var(--gf-accent-700)] no-underline hover:underline"
        href={panel.href}
      >
        {"→"}
      </a>
    </div>
    {panel.items.length > 0 && (
      <ul className="m-0 flex list-none flex-col p-0">
        {panel.items.map((item) => (
          <li
            className="border-t border-[var(--theme-elevation-100)] py-2 first:border-t-0 first:pt-0"
            key={`${item.href}-${item.title}`}
          >
            <a
              className="block truncate text-sm font-semibold text-[var(--theme-text)] no-underline hover:underline"
              href={item.href}
            >
              {item.title}
            </a>
            <span className="block truncate text-xs text-[var(--theme-elevation-600)]">
              {item.meta}
            </span>
          </li>
        ))}
      </ul>
    )}
  </article>
)

const WorkflowNode = ({
  count,
  label,
  state,
}: {
  readonly count: number
  readonly label: string
  readonly state: WorkflowState
}) => {
  const actionable = state === "review" || state === "compiled"
  const complete = state === "published" || state === "archived"
  return (
    <a
      className={`group relative flex min-h-[104px] min-w-0 flex-1 flex-col justify-between rounded-xl border p-3.5 no-underline transition-transform hover:-translate-y-0.5 ${
        actionable
          ? "border-[var(--gf-accent-300)] bg-[var(--gf-tone-accent-bg)]"
          : complete
            ? "border-[var(--theme-elevation-150)] bg-[var(--theme-elevation-50)]"
            : "border-[var(--gf-border)] bg-[var(--gf-surface)]"
      }`}
      href={`/admin/collections/content-editions?where[workflowStatus][equals]=${state}`}
    >
      <span className="text-xs font-semibold text-[var(--theme-elevation-600)]">{label}</span>
      <strong className="mt-3 text-[30px] font-bold leading-none tracking-tight tabular-nums text-[var(--theme-text)]">
        {count}
      </strong>
    </a>
  )
}

const Donut = ({ ready, total }: { readonly ready: number; readonly total: number }) => {
  const radius = 42
  const circumference = 2 * Math.PI * radius
  const dash = total === 0 ? 0 : (ready / total) * circumference
  return (
    <svg
      aria-label={`${ready} of ${total}`}
      className="h-36 w-36 shrink-0"
      role="img"
      viewBox="0 0 112 112"
    >
      <title>{`${ready} / ${total}`}</title>
      <circle
        cx="56"
        cy="56"
        fill="none"
        r={radius}
        stroke="var(--theme-elevation-150)"
        strokeWidth="12"
      />
      <circle
        cx="56"
        cy="56"
        fill="none"
        r={radius}
        stroke="var(--gf-tone-success-fg)"
        strokeDasharray={`${dash} ${circumference - dash}`}
        strokeLinecap="round"
        strokeWidth="12"
        transform="rotate(-90 56 56)"
      />
      <text
        fill="var(--theme-text)"
        fontSize="22"
        fontWeight="700"
        textAnchor="middle"
        x="56"
        y="54"
      >
        {ready}
      </text>
      <text fill="var(--theme-elevation-600)" fontSize="10" textAnchor="middle" x="56" y="70">
        / {total}
      </text>
    </svg>
  )
}

const segmentStyle = (value: number, total: number, color: string): CSSProperties => ({
  background: color,
  width: total === 0 ? "0%" : `${(value / total) * 100}%`,
})

const readinessTone: Record<SiteReadiness, Tone> = {
  configure: "warning",
  disabled: "neutral",
  publish: "accent",
  ready: "success",
  restricted: "neutral",
}

const roleAction = (
  role: ReadableRole,
  t: DashboardText,
): { href: string; Icon: Icon; label: string } => {
  switch (role) {
    case CMS_ROLE.EDITOR:
      return { href: "/admin/collections/contents/create", Icon: PencilIcon, label: t.takeAction }
    case CMS_ROLE.REVIEWER:
      return {
        href: "/admin/collections/content-editions?where[workflowStatus][equals]=review",
        Icon: SearchIcon,
        label: t.takeAction,
      }
    case CMS_ROLE.PUBLISHER:
      return {
        href: "/admin/collections/content-editions?where[workflowStatus][equals]=compiled",
        Icon: SendIcon,
        label: t.takeAction,
      }
    case CMS_ROLE.TENANT_ADMIN:
    case CMS_ROLE.SUPER_ADMIN:
      return { href: "/admin/collections/sites", Icon: GlobeIcon, label: t.takeAction }
  }
}

export const OperationsDashboard = async ({ i18n, payload, user }: DashboardProps) => {
  const lang = uiLangOf(i18n?.language)
  const t = TEXT[lang]
  const role = user?.role
  if (!humanRoles.has(role as ReadableRole)) {
    return (
      <main className="gf-operations-dashboard mx-auto max-w-[1440px] p-8 md:p-6">
        <section className={`${cardClass} grid gap-2 p-10`}>
          <p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">
            {t.kicker}
          </p>
          <h1 className="m-0 text-2xl font-bold tracking-tight text-[var(--theme-text)]">
            {t.denialHeadline}
          </h1>
          <span className="text-sm text-[var(--theme-elevation-600)]">{t.denialBody}</span>
        </section>
      </main>
    )
  }

  const readableRole = role as ReadableRole
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
    safeFind(payload, user, "content-editions", { depth: 0, draft: true, sort: "-updatedAt" }),
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
    sites.flatMap((site) => {
      const id = idOf(site)
      return id === null ? [] : [[id, site] as const]
    }),
  )
  const domainsBySite = summarizeDomains(recordsOf(domainsResult.docs))
  const editionCounts = workflowCounts(editions)
  const editionsBySite = groupBySite(editions)
  const currentReleases = releases.filter((release) => release["state"] === "current")
  const currentReleaseSiteIds = new Set(
    currentReleases.flatMap((release) => {
      const id = idOf(release["site"])
      return id === null ? [] : [id]
    }),
  )
  const failedOperations = operations.filter((operation) => operation["state"] === "failed")
  const pendingRollback = rollbackIntents.filter(
    (intent) => intent["consumedAt"] === null || intent["consumedAt"] === undefined,
  )
  const readinessRows = sortSiteWorkload(
    siteReadiness({
      canReadReleases,
      currentReleaseSiteIds,
      domains: domainsBySite,
      editionsBySite,
      sites,
    }),
  )
  const readinessCounts = readinessRows.reduce<Record<SiteReadiness, number>>(
    (counts, row) => ({ ...counts, [row.readiness]: counts[row.readiness] + 1 }),
    { configure: 0, disabled: 0, publish: 0, ready: 0, restricted: 0 },
  )
  const bottleneck = workflowBottleneck(editionCounts)
  const health = operationHealth(operations)
  const activeSites = sites.filter((site) => site["status"] === "active").length
  const riskCount =
    failedOperations.length +
    pendingRollback.length +
    assessments.length +
    readinessCounts.configure +
    editionCounts.review +
    editionCounts.compiled
  const action = roleAction(readableRole, t)

  const recordItem = (row: RecordLike, href: string, fallback: string): AttentionItem => ({
    href: `${href}/${idOf(row) ?? ""}`,
    meta: `${siteNameFor(row["site"], sitesById, t.unknownSite)} · ${formatDate(row["updatedAt"] ?? row["createdAt"] ?? row["lastStageAt"], lang)}`,
    title: itemLabel(row, fallback),
  })
  const domainRiskSites = readinessRows.filter((row) => row.readiness === "configure").slice(0, 3)
  const panels: readonly AttentionPanel[] = [
    ...(canReadReleases
      ? [
          {
            Icon: AlertTriangleIcon,
            count: pendingRollback.length,
            href: "/admin/collections/rollback-intents",
            items: pendingRollback.slice(0, 3).map((row) => ({
              href: `/admin/collections/rollback-intents/${idOf(row) ?? ""}`,
              meta: `${siteNameFor(row["site"], sitesById, t.unknownSite)} · ${t.rollbackTarget} ${shortHash(row["targetReleaseId"])}`,
              title: stringOf(row["intentId"]),
            })),
            label: t.rollback,
            tone: "danger" as Tone,
          },
        ]
      : []),
    ...(canReadOperations
      ? [
          {
            Icon: AlertTriangleIcon,
            count: failedOperations.length,
            href: "/admin/collections/operations?where[state][equals]=failed",
            items: failedOperations
              .slice(0, 3)
              .map((row) => recordItem(row, "/admin/collections/operations", t.failedOperations)),
            label: t.failedOperations,
            tone: "danger" as Tone,
          },
        ]
      : []),
    {
      Icon: ShieldCheckIcon,
      count: assessments.length,
      href: "/admin/collections/quality-assessments",
      items: assessments
        .slice(0, 3)
        .map((row) => recordItem(row, "/admin/collections/quality-assessments", t.qualityEvidence)),
      label: t.qualityEvidence,
      tone: "warning",
    },
    {
      Icon: GlobeIcon,
      count: readinessCounts.configure,
      href: "/admin/collections/sites",
      items: domainRiskSites.map((row) => ({
        href: `/admin/collections/sites/${row.id}`,
        meta: t.domainsUnset,
        title: stringOf(sitesById.get(row.id)?.["name"], t.unknownSite),
      })),
      label: t.domainRisk,
      tone: "warning",
    },
    {
      Icon: SearchIcon,
      count: editionCounts.review,
      href: "/admin/collections/content-editions?where[workflowStatus][equals]=review",
      items: editions
        .filter((edition) => edition["workflowStatus"] === "review")
        .slice(0, 3)
        .map((row) => recordItem(row, "/admin/collections/content-editions", t.reviewQueue)),
      label: t.reviewQueue,
      tone: "warning",
    },
    {
      Icon: SendIcon,
      count: editionCounts.compiled,
      href: "/admin/collections/content-editions?where[workflowStatus][equals]=compiled",
      items: editions
        .filter((edition) => edition["workflowStatus"] === "compiled")
        .slice(0, 3)
        .map((row) => recordItem(row, "/admin/collections/content-editions", t.readyToPublish)),
      label: t.readyToPublish,
      tone: "accent",
    },
  ]

  const visiblePanels = panels.filter(
    (panel) => panel.count > 0 || panel.label === t.reviewQueue || panel.label === t.readyToPublish,
  )
  const workloadRows = readinessRows.slice(0, 6)

  return (
    <main className="gf-command-dashboard mx-auto flex max-w-[1440px] flex-col gap-10 p-8 md:gap-8 md:p-6">
      <header className={`${cardClass} relative overflow-hidden p-6 sm:p-7`}>
        <div
          aria-hidden="true"
          className="absolute -top-28 -right-20 hidden h-64 w-64 rounded-full bg-[var(--gf-accent-100)] blur-3xl sm:block"
        />
        <div className="relative flex flex-col gap-6">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div className="max-w-2xl">
              <p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">
                {t.kicker}
              </p>
              <h1 className="m-0 mt-1 text-[32px] font-bold leading-10 tracking-tight text-[var(--theme-elevation-900)] sm:text-[36px]">
                {t.pageHeading}
              </h1>
              <p className="m-0 mt-2 text-sm text-[var(--theme-elevation-600)]">
                {ROLE_LABEL[lang][readableRole]}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <strong className="rounded-full bg-[var(--theme-elevation-100)] px-3 py-1.5 text-xs font-bold text-[var(--theme-elevation-700)]">
                {role === CMS_ROLE.SUPER_ADMIN ? t.allTenants : t.currentTenant}
              </strong>
              <InlineAction href={action.href} variant="primary">
                <action.Icon size={16} strokeWidth={2} /> {action.label}
              </InlineAction>
            </div>
          </div>
          <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-[var(--theme-elevation-150)] pt-5 sm:grid-cols-5">
            {[
              [activeSites, t.summaryActive],
              [editionCounts.review, t.summaryReview],
              [editionCounts.compiled, t.summaryCompiled],
              [riskCount, t.summaryAttention],
              [canReadReleases ? currentReleases.length : t.restricted, t.currentReleases],
            ].map(([value, label]) => (
              <div key={String(label)}>
                <dt className="text-xs font-semibold text-[var(--theme-elevation-600)]">{label}</dt>
                <dd className="m-0 mt-1 text-2xl font-bold leading-none tracking-tight tabular-nums text-[var(--theme-text)]">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </header>

      <section aria-label="Operational attention" className="flex flex-col gap-4">
        <SectionHeading
          hint={t.attentionHint}
          title={t.needsAttention}
          action={
            <span className="hidden text-sm font-bold text-[var(--theme-elevation-700)] sm:block">
              {t.attentionCount(riskCount)}
            </span>
          }
        />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visiblePanels.map((panel) => (
            <AttentionCard key={panel.label} panel={panel} />
          ))}
        </div>
      </section>

      <section
        aria-label="Workflow pipeline"
        className={`${cardClass} flex flex-col gap-5 p-5 sm:p-6`}
      >
        <SectionHeading
          {...(bottleneck === null
            ? {}
            : {
                hint: t.bottleneck(WORKFLOW_STATE_LABEL[lang][bottleneck.state], bottleneck.count),
              })}
          title={t.workflowPipeline}
          tooltip={t.workflowTooltip}
          action={
            <InlineAction href="/admin/collections/content-editions">
              {t.seeAllEditions}
            </InlineAction>
          }
        />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_minmax(0,2fr)]">
          <div className="grid grid-cols-2 gap-2">
            {(["draft", "generating"] as const).map((state) => (
              <WorkflowNode
                count={editionCounts[state]}
                key={state}
                label={WORKFLOW_STATE_LABEL[lang][state]}
                state={state}
              />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(["review", "approved", "compiled"] as const).map((state) => (
              <WorkflowNode
                count={editionCounts[state]}
                key={state}
                label={WORKFLOW_STATE_LABEL[lang][state]}
                state={state}
              />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(["published", "archived"] as const).map((state) => (
              <WorkflowNode
                count={editionCounts[state]}
                key={state}
                label={WORKFLOW_STATE_LABEL[lang][state]}
                state={state}
              />
            ))}
          </div>
        </div>
      </section>

      <section
        aria-label="Site readiness and workload"
        className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(340px,2fr)_minmax(0,3fr)]"
      >
        <article className={`${cardClass} flex flex-col gap-5 p-5 sm:p-6`}>
          <SectionHeading hint={t.configurationReadinessHint} title={t.configurationReadiness} />
          {sites.length === 0 ? (
            <p className="m-0 text-sm text-[var(--theme-elevation-600)]">{t.noSites}</p>
          ) : (
            <>
              <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
                <Donut ready={readinessCounts.ready} total={sites.length} />
                <div className="grid flex-1 gap-2.5">
                  <strong className="text-base text-[var(--theme-text)]">
                    {t.configuredSites(readinessCounts.ready, sites.length)}
                  </strong>
                  {(["ready", "publish", "configure", "disabled", "restricted"] as const).map(
                    (state) => (
                      <div className="flex items-center justify-between gap-3" key={state}>
                        <span className="flex min-w-0 items-center gap-2 text-sm text-[var(--theme-elevation-700)]">
                          <Badge tone={readinessTone[state]}>{READINESS_LABEL[lang][state]}</Badge>
                        </span>
                        <strong className="text-sm tabular-nums text-[var(--theme-text)]">
                          {readinessCounts[state]}
                        </strong>
                      </div>
                    ),
                  )}
                </div>
              </div>
              <ul className="m-0 flex list-none flex-col p-0">
                {readinessRows
                  .filter((row) => row.readiness !== "ready")
                  .slice(0, 3)
                  .map((row) => (
                    <li
                      className="flex items-center justify-between gap-3 border-t border-[var(--theme-elevation-100)] py-2.5"
                      key={row.id}
                    >
                      <a
                        className="truncate text-sm font-semibold text-[var(--theme-text)] no-underline hover:underline"
                        href={`/admin/collections/sites/${row.id}`}
                      >
                        {stringOf(sitesById.get(row.id)?.["name"], t.unknownSite)}
                      </a>
                      <Badge tone={readinessTone[row.readiness]}>
                        {READINESS_LABEL[lang][row.readiness]}
                      </Badge>
                    </li>
                  ))}
              </ul>
            </>
          )}
        </article>

        <article className={`${cardClass} flex flex-col gap-5 p-5 sm:p-6`}>
          <SectionHeading
            hint={t.siteFleetHint}
            title={t.siteFleet}
            action={<InlineAction href="/admin/collections/sites">{t.seeAllSites}</InlineAction>}
          />
          <p className="m-0 text-xs text-[var(--theme-elevation-600)]">
            {t.workloadStates} · {t.readinessCoverage(workloadRows.length, sites.length)}
          </p>
          <div className="grid min-w-0 gap-4">
            {workloadRows.map((row) => {
              const site = sitesById.get(row.id)
              const counts = row.counts
              const total = counts.review + counts.approved + counts.compiled + counts.published
              return (
                <div className="grid min-w-0 gap-2" key={row.id}>
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <a
                      className="min-w-0 truncate text-sm font-bold text-[var(--theme-text)] no-underline hover:underline"
                      href={`/admin/collections/sites/${row.id}`}
                    >
                      {stringOf(site?.["name"], t.unknownSite)}
                    </a>
                    <Badge tone={readinessTone[row.readiness]}>
                      {READINESS_LABEL[lang][row.readiness]}
                    </Badge>
                  </div>
                  <div
                    aria-label={`${stringOf(site?.["name"], t.unknownSite)} ${total}`}
                    className="flex h-3 overflow-hidden rounded-full bg-[var(--theme-elevation-100)]"
                    role="img"
                  >
                    <span
                      style={segmentStyle(counts.review, total, "var(--gf-tone-warning-fg)")}
                      title={`${WORKFLOW_STATE_LABEL[lang].review}: ${counts.review}`}
                    />
                    <span
                      style={segmentStyle(counts.approved, total, "var(--gf-accent-400)")}
                      title={`${WORKFLOW_STATE_LABEL[lang].approved}: ${counts.approved}`}
                    />
                    <span
                      style={segmentStyle(counts.compiled, total, "var(--gf-accent-650)")}
                      title={`${WORKFLOW_STATE_LABEL[lang].compiled}: ${counts.compiled}`}
                    />
                    <span
                      style={segmentStyle(counts.published, total, "var(--gf-tone-success-fg)")}
                      title={`${WORKFLOW_STATE_LABEL[lang].published}: ${counts.published}`}
                    />
                  </div>
                  <span className="text-xs text-[var(--theme-elevation-600)]">
                    {WORKFLOW_STATE_LABEL[lang].review} {counts.review} ·{" "}
                    {WORKFLOW_STATE_LABEL[lang].approved} {counts.approved} ·{" "}
                    {WORKFLOW_STATE_LABEL[lang].compiled} {counts.compiled} ·{" "}
                    {WORKFLOW_STATE_LABEL[lang].published} {counts.published}
                  </span>
                </div>
              )
            })}
          </div>
        </article>
      </section>

      {canReadOperations && (
        <section
          aria-label="Operations health"
          className={`${cardClass} flex flex-col gap-5 p-5 sm:p-6`}
        >
          <SectionHeading
            hint={t.operationsHealthHint}
            title={t.operationsHealth}
            action={
              <InlineAction href="/admin/collections/operations">{t.seeOperations}</InlineAction>
            }
          />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {OPERATION_TYPES.map((type) => {
              const stateCounts = health[type]
              const total = OPERATION_STATES.reduce((sum, state) => sum + stateCounts[state], 0)
              return (
                <a
                  className="rounded-xl border border-[var(--theme-elevation-150)] bg-[var(--theme-elevation-50)] p-4 no-underline hover:border-[var(--gf-accent-300)]"
                  href={`/admin/collections/operations?where[operationType][equals]=${type}`}
                  key={type}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-bold text-[var(--theme-text)]">
                      {OPERATION_TYPE_LABEL[lang][type]}
                    </span>
                    <strong className="text-lg tabular-nums text-[var(--theme-text)]">
                      {total}
                    </strong>
                  </div>
                  <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-[var(--theme-elevation-150)]">
                    <span
                      style={segmentStyle(
                        stateCounts.succeeded,
                        total,
                        "var(--gf-tone-success-fg)",
                      )}
                    />
                    <span
                      style={segmentStyle(stateCounts.running, total, "var(--gf-accent-500)")}
                    />
                    <span
                      style={segmentStyle(stateCounts.queued, total, "var(--gf-tone-warning-fg)")}
                    />
                    <span
                      style={segmentStyle(stateCounts.failed, total, "var(--gf-tone-danger-fg)")}
                    />
                    <span
                      style={segmentStyle(
                        stateCounts.cancelled,
                        total,
                        "var(--theme-elevation-400)",
                      )}
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-2 gap-y-1 text-xs text-[var(--theme-elevation-600)]">
                    {OPERATION_STATES.filter((state) => stateCounts[state] > 0).map((state) => (
                      <span key={state}>
                        {OPERATION_STATE_LABEL[lang][state]} {stateCounts[state]}
                      </span>
                    ))}
                  </div>
                </a>
              )
            })}
          </div>
        </section>
      )}

      {(canReadOperations || canReadReleases) && (
        <section aria-label="Recent records" className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {canReadReleases && (
            <article className={`${cardClass} flex flex-col gap-4 p-5`}>
              <SectionHeading
                title={t.currentReleases}
                action={
                  <InlineAction href="/admin/collections/releases">{t.releaseLedger}</InlineAction>
                }
              />
              {currentReleases.length === 0 ? (
                <p className="m-0 text-sm text-[var(--theme-elevation-600)]">
                  {t.noCurrentReleases}
                </p>
              ) : (
                <ul className="m-0 flex list-none flex-col p-0">
                  {currentReleases.slice(0, 5).map((release) => {
                    const id = idOf(release) ?? ""
                    return (
                      <li
                        className="flex gap-3 border-t border-[var(--theme-elevation-100)] py-2.5 first:border-t-0 first:pt-0"
                        key={id}
                      >
                        <IconBadge tone="success">
                          <PackageIcon size={16} />
                        </IconBadge>
                        <div className="min-w-0">
                          <a
                            className="block truncate font-mono text-sm font-bold text-[var(--theme-text)] no-underline hover:underline"
                            href={`/admin/collections/releases/${id}`}
                          >
                            {stringOf(release["releaseId"])}
                          </a>
                          <span className="text-xs text-[var(--theme-elevation-600)]">
                            {siteNameFor(release["site"], sitesById, t.unknownSite)} ·{" "}
                            {formatDate(release["updatedAt"], lang)}
                          </span>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </article>
          )}
          {canReadOperations && (
            <article className={`${cardClass} flex flex-col gap-4 p-5`}>
              <SectionHeading
                title={t.latestRecords}
                action={
                  <InlineAction href="/admin/collections/operations">
                    {t.seeOperations}
                  </InlineAction>
                }
              />
              {operations.length === 0 ? (
                <p className="m-0 text-sm text-[var(--theme-elevation-600)]">{t.noOperations}</p>
              ) : (
                <ul className="m-0 flex list-none flex-col p-0">
                  {operations.slice(0, 5).map((operation) => {
                    const id = idOf(operation) ?? ""
                    const state = stringOf(operation["state"], "queued")
                    return (
                      <li
                        className="flex gap-3 border-t border-[var(--theme-elevation-100)] py-2.5 first:border-t-0 first:pt-0"
                        key={id}
                      >
                        <IconBadge tone={statusTone(state)}>
                          <LayersIcon size={16} />
                        </IconBadge>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <a
                              className="truncate text-sm font-bold text-[var(--theme-text)] no-underline hover:underline"
                              href={`/admin/collections/operations/${id}`}
                            >
                              {OPERATION_TYPE_LABEL[lang][
                                stringOf(operation["operationType"], "generate")
                              ] ?? stringOf(operation["operationType"])}
                            </a>
                            <Badge tone={statusTone(state)}>
                              {OPERATION_STATE_LABEL[lang][state as OperationState] ?? state}
                            </Badge>
                          </div>
                          <span className="block truncate text-xs text-[var(--theme-elevation-600)]">
                            {siteNameFor(operation["site"], sitesById, t.unknownSite)} ·{" "}
                            {formatDate(operation["updatedAt"], lang)}
                          </span>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </article>
          )}
          {canReadReleases && (
            <article className={`${cardClass} flex flex-col gap-4 p-5`}>
              <SectionHeading
                title={t.rollback}
                action={
                  <InlineAction href="/admin/collections/rollback-intents">
                    {t.seeQueue}
                  </InlineAction>
                }
              />
              {pendingRollback.length === 0 ? (
                <p className="m-0 text-sm text-[var(--theme-elevation-600)]">
                  {t.noPendingRollbacks}
                </p>
              ) : (
                <ul className="m-0 flex list-none flex-col p-0">
                  {pendingRollback.slice(0, 5).map((intent) => {
                    const id = idOf(intent) ?? ""
                    return (
                      <li
                        className="flex gap-3 border-t border-[var(--theme-elevation-100)] py-2.5 first:border-t-0 first:pt-0"
                        key={id}
                      >
                        <IconBadge tone="danger">
                          <AlertTriangleIcon size={16} />
                        </IconBadge>
                        <div className="min-w-0">
                          <a
                            className="block truncate font-mono text-sm font-bold text-[var(--theme-text)] no-underline hover:underline"
                            href={`/admin/collections/rollback-intents/${id}`}
                          >
                            {stringOf(intent["intentId"])}
                          </a>
                          <span className="block truncate text-xs text-[var(--theme-elevation-600)]">
                            {siteNameFor(intent["site"], sitesById, t.unknownSite)} ·{" "}
                            {t.rollbackTarget} {shortHash(intent["targetReleaseId"])}
                          </span>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </article>
          )}
        </section>
      )}

      <section
        aria-label="Dashboard actions"
        className={`${cardClass} flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between`}
      >
        <div>
          <h2 className="m-0 text-base font-bold text-[var(--theme-text)]">{t.takeAction}</h2>
          <p className="m-0 mt-1 text-sm text-[var(--theme-elevation-600)]">{t.liveScope}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <InlineAction href={action.href} variant="primary">
            <action.Icon size={16} /> {action.label}
          </InlineAction>
          <InlineAction href="/admin/collections/content-editions">{t.seeAllEditions}</InlineAction>
          <InlineAction href="/admin/collections/sites">{t.openSites}</InlineAction>
          {canReadReleases && (
            <InlineAction href="/admin/collections/releases">{t.releaseLedger}</InlineAction>
          )}
        </div>
      </section>
    </main>
  )
}
