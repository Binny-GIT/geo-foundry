import type { Payload } from "payload"

import { CMS_ROLE, type CmsRole } from "../../access/roles"
import { ActionLink } from "../ui/ActionLink"
import { Badge } from "../ui/Badge"
import { IconBadge } from "../ui/IconBadge"
import { AlertTriangleIcon, GlobeIcon, PackageIcon, SendIcon } from "../icons"
import {
  formatDate,
  groupBySite,
  recordsOf,
  idOf,
  stringOf,
  summarizeDomains,
  workflowCounts,
  type RecordLike,
} from "../dashboard/operations-model"

type SitesWorkspaceProps = {
  readonly payload: Payload
  readonly user?: {
    readonly role?: unknown
  }
}

const releaseRoles = new Set<CmsRole>([
  CMS_ROLE.PUBLISHER,
  CMS_ROLE.SUPER_ADMIN,
  CMS_ROLE.TENANT_ADMIN,
])

const SITE_STATUS_LABEL: Record<string, string> = {
  active: "启用",
  disabled: "停用",
}

const canEditSite = (role: unknown): boolean => role === CMS_ROLE.TENANT_ADMIN

const safeFind = async (
  payload: Payload,
  user: SitesWorkspaceProps["user"],
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

const cardClass =
  "rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] shadow-[var(--gf-shadow-surface)]"

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

/**
 * Read-only operational companion for the stock Payload Sites list. The table
 * below remains the editable registry; this workspace derives its facts from
 * related ledgers without duplicating them onto Site documents.
 */
export const SitesOperationsWorkspace = async ({ payload, user }: SitesWorkspaceProps) => {
  const role = user?.role as CmsRole | undefined
  const canReadReleases = role !== undefined && releaseRoles.has(role)
  const [sitesResult, domainsResult, editionsResult, releasesResult] = await Promise.all([
    safeFind(payload, user, "sites", { depth: 0, sort: "name" }),
    safeFind(payload, user, "domains", { depth: 0, sort: "hostname" }),
    safeFind(payload, user, "content-editions", {
      depth: 0,
      draft: true,
      sort: "-updatedAt",
    }),
    canReadReleases
      ? safeFind(payload, user, "releases", { depth: 0, sort: "-updatedAt" })
      : Promise.resolve({ docs: [] as unknown[] }),
  ])

  const sites = recordsOf(sitesResult.docs)
  const domainBySite = summarizeDomains(recordsOf(domainsResult.docs))
  const editionsBySite = groupBySite(recordsOf(editionsResult.docs))
  const releases = recordsOf(releasesResult.docs)
  const currentBySite = new Map(
    releases
      .filter((release) => release["state"] === "current")
      .map((release) => [idOf(release["site"]), release])
      .filter((entry): entry is [string, RecordLike] => entry[0] !== null),
  )
  const activeSites = sites.filter((site) => site["status"] === "active").length
  const missingCanonical = sites.filter((site) => {
    const summary = domainBySite.get(idOf(site) ?? "")
    return summary === undefined || summary.canonicalHostname === null
  }).length

  return (
    <section
      aria-label="Sites workspace"
      className="mx-auto mb-8 flex max-w-[1440px] flex-col gap-6 p-8 md:p-6"
    >
      <header className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="m-0 mb-1 text-xs font-extrabold uppercase tracking-[0.06em] text-[var(--gf-accent-700)]">
            站点运营
          </p>
          <h2 className="m-0 text-xl font-semibold tracking-tight text-[var(--theme-text)]">
            站点工作区
          </h2>
          <span className="mt-1 block text-sm text-[var(--theme-elevation-600)]">
            {sites.length} 个站点 · {activeSites} 个启用（在您的权限范围内）
          </span>
        </div>
        <strong className="shrink-0 whitespace-nowrap rounded-full bg-[var(--theme-elevation-100)] px-3 py-1.5 text-xs font-bold text-[var(--theme-elevation-700)]">
          {role === CMS_ROLE.SUPER_ADMIN ? "全部租户" : "当前租户"}
        </strong>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metric(sites.length, "站点", "您的角色可见范围")}
        {metric(activeSites, "启用中", "已启用的站点记录")}
        {metric(
          missingCanonical,
          "待配置域名",
          "无有效主域名",
          missingCanonical > 0 ? "warning" : "neutral",
        )}
        {metric(
          canReadReleases ? currentBySite.size : "Restricted",
          "当前发布版本",
          canReadReleases ? "发布台账记录" : "需要发布权限",
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {sites.map((site) => {
          const siteId = idOf(site) ?? ""
          const domains = domainBySite.get(siteId)
          const currentRelease = currentBySite.get(siteId)
          const counts = workflowCounts(editionsBySite.get(siteId) ?? [])
          const active = site["status"] === "active"
          const domainState =
            domains?.canonicalHostname ??
            (domains?.canonicalDisabled
              ? "主域名已停用"
              : domains?.configured
                ? "无有效主域名"
                : "尚未配置域名")
          return (
            <article className={`${cardClass} flex flex-col gap-4 p-5`} key={siteId}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${
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
                  <p className="m-0 mt-0.5 truncate text-xs text-[var(--theme-elevation-600)]">
                    {stringOf(site["locale"])} · {stringOf(site["timezone"])} · 更新于{" "}
                    {formatDate(site["updatedAt"])}
                  </p>
                </div>
                <IconBadge tone="accent">
                  <GlobeIcon size={20} strokeWidth={1.8} />
                </IconBadge>
              </div>

              <dl className="m-0 grid gap-2">
                <div className="grid grid-cols-[64px_1fr] items-baseline gap-2">
                  <dt className="text-xs text-[var(--theme-elevation-600)]">域名</dt>
                  <dd
                    className={`m-0 truncate text-sm ${
                      domains?.canonicalHostname === null || domains === undefined
                        ? "font-semibold text-[var(--theme-warning-700)]"
                        : "text-[var(--theme-text)]"
                    }`}
                  >
                    {domainState}
                    {domains !== undefined && domains.aliases > 0
                      ? ` · +${domains.aliases} 个别名`
                      : ""}
                  </dd>
                </div>
                <div className="grid grid-cols-[64px_1fr] items-baseline gap-2">
                  <dt className="text-xs text-[var(--theme-elevation-600)]">发布版本</dt>
                  <dd className="m-0 truncate font-mono text-sm text-[var(--theme-text)]">
                    {canReadReleases ? stringOf(currentRelease?.["releaseId"], "暂无") : "受限"}
                  </dd>
                </div>
                <div className="grid grid-cols-[64px_1fr] items-baseline gap-2">
                  <dt className="text-xs text-[var(--theme-elevation-600)]">工作流</dt>
                  <dd className="m-0 truncate text-sm text-[var(--theme-text)]">
                    {counts.draft} 草稿 · {counts.review} 待审核 · {counts.approved} 已批准 ·{" "}
                    {counts.compiled} 已编译 · {counts.published} 已发布
                  </dd>
                </div>
              </dl>

              <div className="flex flex-wrap gap-2">
                <ActionLink href={`/admin/collections/sites/${siteId}`} variant="primary">
                  打开站点 →
                </ActionLink>
                <ActionLink href="/admin/collections/domains">管理域名 →</ActionLink>
                <ActionLink href="/admin/collections/content-editions">查看版本 →</ActionLink>
                {canReadReleases && (
                  <ActionLink href="/admin/collections/releases">
                    <PackageIcon size={15} /> 发布历史
                  </ActionLink>
                )}
                {canEditSite(role) && (
                  <ActionLink href={`/admin/collections/sites/${siteId}`}>
                    编辑配置 →
                  </ActionLink>
                )}
              </div>
            </article>
          )
        })}
      </div>

      {sites.length === 0 && (
        <div
          className={`${cardClass} flex items-start gap-3 p-5 text-[var(--theme-warning-700)]`}
        >
          <AlertTriangleIcon size={20} strokeWidth={1.8} />
          <div className="grid gap-0.5">
            <strong className="text-sm text-[var(--theme-text)]">
              当前权限范围内没有可见站点。
            </strong>
            <span className="text-sm text-[var(--theme-elevation-600)]">
              请为该租户创建或选择一个已配置的站点记录以开始运营。
            </span>
          </div>
        </div>
      )}

      <footer className="flex flex-col items-start justify-between gap-2 border-t border-[var(--gf-border)] pt-4 text-sm text-[var(--theme-elevation-600)] sm:flex-row sm:items-center">
        <span>下方登记表仍可用于搜索、筛选、列偏好和批量管理。</span>
        <a
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[var(--gf-accent-700)] no-underline hover:underline"
          href="/admin/collections/content-editions?where[workflowStatus][equals]=compiled"
        >
          <SendIcon size={16} /> 已编译版本 →
        </a>
      </footer>
    </section>
  )
}
