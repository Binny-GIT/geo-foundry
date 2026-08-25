import type { Payload, Where } from "payload"

import { CMS_ROLE, type CmsRole } from "../../access/roles"
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

const roleLabel = (role: unknown): string => {
  switch (role) {
    case CMS_ROLE.EDITOR:
      return "内容生产队列"
    case CMS_ROLE.REVIEWER:
      return "审核与证据队列"
    case CMS_ROLE.PUBLISHER:
      return "发布控制面"
    case CMS_ROLE.TENANT_ADMIN:
      return "租户运营总览"
    case CMS_ROLE.SUPER_ADMIN:
      return "跨租户全局总览"
    default:
      return "受限运营视图"
  }
}

const WORKFLOW_STATE_LABEL: Record<string, string> = {
  approved: "已批准",
  archived: "已归档",
  compiled: "已编译",
  draft: "草稿",
  generating: "生成中",
  published: "已发布",
  review: "审核中",
}

const SITE_STATUS_LABEL: Record<string, string> = {
  active: "启用",
  disabled: "停用",
}

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

const siteNameFor = (site: unknown, sites: Map<string, RecordLike>): string => {
  const id = idOf(site)
  return id === null ? "未知站点" : stringOf(sites.get(id)?.["name"], "未知站点")
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
  tone: "neutral" | "warning" = "neutral",
) => (
  <article
    className={`${cardClass} flex flex-col gap-1 p-5 ${
      tone === "warning" ? "border-l-[3px] border-l-[var(--theme-warning-500)]" : ""
    }`}
  >
    {value === "Restricted" ? (
      <Badge>受限</Badge>
    ) : (
      <strong className="text-[28px] font-semibold leading-8 tracking-tight tabular-nums text-[var(--theme-text)]">
        {value}
      </strong>
    )}
    <span className="text-sm font-bold text-[var(--theme-text)]">{label}</span>
    <small className="text-xs text-[var(--theme-elevation-600)]">{note}</small>
  </article>
)

const queuePanel = (panel: Panel, sites: Map<string, RecordLike>) => (
  <article className={`${cardClass} flex flex-col gap-4 p-5`}>
    <div className="flex items-center gap-3">
      <IconBadge tone={panel.count > 0 ? panel.tone : "neutral"}>
        <panel.Icon size={18} strokeWidth={1.9} />
      </IconBadge>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-bold text-[var(--theme-elevation-900)]">{panel.label}</h3>
        <p className="text-xs text-[var(--theme-elevation-600)]">
          在您的权限范围内 · {panel.count} 条
        </p>
      </div>
      <a
        className="shrink-0 whitespace-nowrap text-xs font-bold text-[var(--gf-accent-700)] no-underline hover:underline"
        href={panel.href}
      >
        查看队列 →
      </a>
    </div>
    {/*
     * No empty-state copy: the header's "在您的权限范围内 · 0 条" already
     * says there's nothing to act on (user direction 2026-08-24).
     */}
    {panel.items.length > 0 && (
      <ul className="m-0 flex list-none flex-col p-0">
        {panel.items.map((item) => {
          const id = idOf(item)
          const site = siteNameFor(item["site"], sites)
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
export const OperationsDashboard = async ({ payload, user }: DashboardProps) => {
  const role = user?.role
  if (!humanRoles.has(role as ReadableRole)) {
    return (
      <main className="mx-auto max-w-[1440px] p-8 md:p-6">
        <section className={`${cardClass} grid gap-2 p-10`}>
          <p className="m-0 text-xs font-extrabold uppercase tracking-[0.06em] text-[var(--gf-accent-700)]">
            Geo Foundry
          </p>
          <h1 className="m-0 text-2xl font-semibold text-[var(--theme-text)]">
            此身份不可使用运营控制台
          </h1>
          <span className="text-sm text-[var(--theme-elevation-600)]">
            服务身份请使用内部集成接口，而非人工控制台。
          </span>
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
      label: "审核队列",
      tone: "warning",
    },
    {
      Icon: SendIcon,
      count: editionCounts.compiled,
      href: "/admin/collections/content-editions?where[workflowStatus][equals]=compiled",
      items: editions.filter((edition) => edition["workflowStatus"] === "compiled").slice(0, 3),
      label: "待发布",
      tone: "neutral",
    },
    {
      Icon: ShieldCheckIcon,
      count: assessments.length,
      href: "/admin/collections/quality-assessments",
      items: assessments.slice(0, 3),
      label: "质量证据待处理",
      tone: "warning",
    },
    ...(canReadOperations
      ? [
          {
            Icon: AlertTriangleIcon,
            count: failedOperations.length,
            href: "/admin/collections/operations?where[state][equals]=failed",
            items: failedOperations.slice(0, 3),
            label: "失败的操作",
            tone: "danger" as const,
          },
        ]
      : []),
  ]

  return (
    <main className="mx-auto flex max-w-[1440px] flex-col gap-10 p-8 md:gap-8 md:p-6">
      <header className="flex flex-col items-start justify-between gap-3 border-b border-[var(--gf-border)] pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="m-0 mb-1 text-xs font-extrabold uppercase tracking-[0.06em] text-[var(--gf-accent-700)]">
            Geo Foundry
          </p>
          <h1 className="m-0 text-[28px] font-bold leading-9 tracking-tight text-[var(--theme-elevation-900)] md:text-2xl">
            运营控制台
          </h1>
          <span className="mt-1 block text-sm text-[var(--theme-elevation-600)]">
            {roleLabel(role)}
          </span>
        </div>
        <strong className="shrink-0 whitespace-nowrap rounded-full bg-[var(--theme-elevation-100)] px-3 py-1.5 text-xs font-bold text-[var(--theme-elevation-700)]">
          {role === CMS_ROLE.SUPER_ADMIN ? "全部租户" : "当前租户"}
        </strong>
      </header>

      <section aria-label="Operational attention" className="flex flex-col gap-4">
        <div className="flex items-end justify-between gap-3">
          <SectionHeading hint="需要决策或跟进的工作" title="待处理事项" />
          <span className="hidden shrink-0 text-xs text-[var(--theme-elevation-600)] sm:block">
            实时 · 按权限范围
          </span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {panels.map((panel) => (
            <div key={panel.label}>{queuePanel(panel, sitesById)}</div>
          ))}
        </div>
      </section>

      <section aria-label="Workflow pipeline" className="flex flex-col gap-4">
        <div className="flex items-end justify-between gap-3">
          <SectionHeading
            title="工作流管线"
            tooltip="内容从草稿到发布的七个流转状态，点击任意状态查看对应的内容版本列表。"
          />
          <a
            className="shrink-0 whitespace-nowrap text-xs font-bold text-[var(--gf-accent-700)] no-underline hover:underline"
            href="/admin/collections/content-editions"
          >
            查看全部版本 →
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
                  {WORKFLOW_STATE_LABEL[state] ?? state}
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
          <SectionHeading hint="配置与发布状态" title="站点概览" />
          <a
            className="shrink-0 whitespace-nowrap text-xs font-bold text-[var(--gf-accent-700)] no-underline hover:underline"
            href="/admin/collections/sites"
          >
            打开站点工作区 →
          </a>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {metric(sites.length, "站点", `${activeSites} 个启用`, "neutral")}
          {metric(
            domainSetupNeeded,
            "待配置域名",
            "无有效主域名",
            domainSetupNeeded > 0 ? "warning" : "neutral",
          )}
          {metric(
            canReadReleases ? currentReleases.length : "Restricted",
            "当前发布版本",
            canReadReleases ? "已验证发布台账" : "需要发布权限",
            "neutral",
          )}
          {metric(
            editionCounts.compiled,
            "待发布",
            "已编译版本",
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
                    {SITE_STATUS_LABEL[stringOf(site["status"])] ?? stringOf(site["status"])}
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
                    <dt className="text-xs text-[var(--theme-elevation-600)]">域名</dt>
                    <dd className="m-0 truncate text-sm text-[var(--theme-text)]">
                      {domain?.canonicalHostname ?? "待配置"}
                    </dd>
                  </div>
                  <div className="grid grid-cols-[64px_1fr] items-baseline gap-2">
                    <dt className="text-xs text-[var(--theme-elevation-600)]">发布版本</dt>
                    <dd className="m-0 truncate font-mono text-sm text-[var(--theme-text)]">
                      {canReadReleases ? stringOf(currentRelease?.["releaseId"], "暂无") : "受限"}
                    </dd>
                  </div>
                  <div className="grid grid-cols-[64px_1fr] items-baseline gap-2">
                    <dt className="text-xs text-[var(--theme-elevation-600)]">工作量</dt>
                    <dd className="m-0 text-sm text-[var(--theme-text)]">
                      {counts.review} 待审核 · {counts.compiled} 已编译
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
                  当前发布版本
                </h2>
                <a
                  className="shrink-0 whitespace-nowrap text-xs font-bold text-[var(--gf-accent-700)] no-underline hover:underline"
                  href="/admin/collections/releases"
                >
                  发布台账 →
                </a>
              </div>
              {currentReleases.length === 0 ? (
                <p className="m-0 text-sm text-[var(--theme-elevation-600)]">
                  您的权限范围内暂无当前发布版本。
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
                          {siteNameFor(release["site"], sitesById)} ·{" "}
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
                <h2 className="flex-1 text-sm font-bold text-[var(--theme-elevation-900)]">最近操作</h2>
                <a
                  className="shrink-0 whitespace-nowrap text-xs font-bold text-[var(--gf-accent-700)] no-underline hover:underline"
                  href="/admin/collections/operations"
                >
                  操作台账 →
                </a>
              </div>
              {operations.length === 0 ? (
                <p className="m-0 text-sm text-[var(--theme-elevation-600)]">
                  您的权限范围内暂无操作记录。
                </p>
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
                          {siteNameFor(operation["site"], sitesById)} ·{" "}
                          {formatDate(operation["updatedAt"])} · 第{" "}
                          {stringOf(operation["attempt"], "1")} 次尝试
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
                  待处理回滚
                </h2>
                <a
                  className="shrink-0 whitespace-nowrap text-xs font-bold text-[var(--gf-accent-700)] no-underline hover:underline"
                  href="/admin/collections/rollback-intents"
                >
                  回滚意图 →
                </a>
              </div>
              {pendingRollback.length === 0 ? (
                <p className="m-0 text-sm text-[var(--theme-elevation-600)]">
                  没有待处理的已批准回滚意图。
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
                        {siteNameFor(intent["site"], sitesById)} · 目标{" "}
                        {shortHash(intent["targetReleaseId"])}
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
              <PencilIcon size={17} /> 创建内容
            </a>
            <a
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--theme-elevation-100)] px-3 py-2 text-xs font-bold text-[var(--theme-text)] no-underline hover:bg-[var(--gf-tone-accent-bg)]"
              href="/admin/collections/media/create"
            >
              <GlobeIcon size={17} /> 上传媒体
            </a>
          </>
        )}
        {role === CMS_ROLE.REVIEWER && (
          <>
            <a
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--theme-elevation-100)] px-3 py-2 text-xs font-bold text-[var(--theme-text)] no-underline hover:bg-[var(--gf-tone-accent-bg)]"
              href="/admin/collections/content-editions?where[workflowStatus][equals]=review"
            >
              <SearchIcon size={17} /> 打开审核队列
            </a>
            <a
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--theme-elevation-100)] px-3 py-2 text-xs font-bold text-[var(--theme-text)] no-underline hover:bg-[var(--gf-tone-accent-bg)]"
              href="/admin/collections/quality-assessments"
            >
              <ShieldCheckIcon size={17} /> 质量证据
            </a>
          </>
        )}
        {role === CMS_ROLE.PUBLISHER && (
          <>
            <a
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--theme-elevation-100)] px-3 py-2 text-xs font-bold text-[var(--theme-text)] no-underline hover:bg-[var(--gf-tone-accent-bg)]"
              href="/admin/collections/content-editions?where[workflowStatus][equals]=compiled"
            >
              <SendIcon size={17} /> 待发布
            </a>
            <a
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--theme-elevation-100)] px-3 py-2 text-xs font-bold text-[var(--theme-text)] no-underline hover:bg-[var(--gf-tone-accent-bg)]"
              href="/admin/collections/releases"
            >
              <PackageIcon size={17} /> 发布台账
            </a>
          </>
        )}
        {role === CMS_ROLE.TENANT_ADMIN && (
          <>
            <a
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--theme-elevation-100)] px-3 py-2 text-xs font-bold text-[var(--theme-text)] no-underline hover:bg-[var(--gf-tone-accent-bg)]"
              href="/admin/collections/sites"
            >
              <GlobeIcon size={17} /> 站点与域名
            </a>
            <a
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--theme-elevation-100)] px-3 py-2 text-xs font-bold text-[var(--theme-text)] no-underline hover:bg-[var(--gf-tone-accent-bg)]"
              href="/admin/collections/users"
            >
              <UsersIcon size={17} /> 租户用户
            </a>
          </>
        )}
        {role === CMS_ROLE.SUPER_ADMIN && (
          <>
            <a
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--theme-elevation-100)] px-3 py-2 text-xs font-bold text-[var(--theme-text)] no-underline hover:bg-[var(--gf-tone-accent-bg)]"
              href="/admin/collections/sites"
            >
              <GlobeIcon size={17} /> 全部站点
            </a>
            <a
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--theme-elevation-100)] px-3 py-2 text-xs font-bold text-[var(--theme-text)] no-underline hover:bg-[var(--gf-tone-accent-bg)]"
              href="/admin/collections/operations"
            >
              <LayersIcon size={17} /> 全部操作
            </a>
          </>
        )}
        <a
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--theme-elevation-100)] px-3 py-2 text-xs font-bold text-[var(--theme-text)] no-underline hover:bg-[var(--gf-tone-accent-bg)]"
          href="/admin/collections/content-editions"
        >
          <CheckCircleIcon size={17} /> 内容版本
        </a>
      </section>
    </main>
  )
}
