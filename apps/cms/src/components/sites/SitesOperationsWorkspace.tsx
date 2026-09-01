import type { Payload } from "payload"

import { CMS_ROLE, type CmsRole } from "../../access/roles"
import { uiLangOf, type HasLanguage } from "../i18n/ui-lang"
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
  /** Passed by Payload's beforeList hook (ServerProps slice); defaults to zh. */
  readonly i18n?: HasLanguage
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

const SITE_STATUS_LABEL: Record<"en" | "zh", Record<string, string>> = {
  en: { active: "Active", disabled: "Disabled" },
  zh: { active: "启用", disabled: "停用" },
}

const TEXT = {
  en: {
    allTenants: "All tenants",
    aliases: (count: number) => ` · +${count} alias${count > 1 ? "es" : ""}`,
    canonicalDisabled: "Canonical domain disabled",
    compiledLink: "Compiled editions →",
    currentTenant: "Current tenant",
    currentReleases: "Current releases",
    currentReleasesLedger: "Verified release ledger",
    currentReleasesRestricted: "Requires publisher role",
    domainLabel: "Domain",
    domainsToConfigure: "Domains to configure",
    domainsToConfigureNote: "No canonical hostname",
    editConfig: "Edit configuration →",
    emptyHeadline: "No sites visible in your current scope.",
    emptyBody: "Create or select a configured site record for this tenant to begin operations.",
    footerNote: "The registry table below still handles search, filters, column prefs, and bulk actions.",
    headline: "Sites workspace",
    manageDomains: "Manage domains →",
    missingCanonical: "No canonical hostname",
    notConfigured: "No domain configured yet",
    openSite: "Open site →",
    publisherRestricted: "Restricted",
    releaseLabel: "Release",
    releaseNone: "None",
    releaseHistory: "Release history",
    sites: "Sites",
    sitesActive: "Active",
    sitesActiveNote: "Enabled site records",
    sitesNote: "Visible to your role",
    kicker: "Site operations",
    scopeLine: (sites: number, active: number) =>
      `${sites} site${sites === 1 ? "" : "s"} · ${active} active · in your scope`,
    updatedAt: "Updated",
    viewEditions: "View editions →",
    workload: "Workload",
    workloadLine: (c: { approved: number; compiled: number; draft: number; published: number; review: number }) =>
      `${c.draft} draft · ${c.review} in review · ${c.approved} approved · ${c.compiled} compiled · ${c.published} published`,
  },
  zh: {
    allTenants: "全部租户",
    aliases: (count: number) => ` · +${count} 个别名`,
    canonicalDisabled: "主域名已停用",
    compiledLink: "已编译版本 →",
    currentTenant: "当前租户",
    currentReleases: "当前发布版本",
    currentReleasesLedger: "发布台账记录",
    currentReleasesRestricted: "需要发布权限",
    domainLabel: "域名",
    domainsToConfigure: "待配置域名",
    domainsToConfigureNote: "无有效主域名",
    editConfig: "编辑配置 →",
    emptyHeadline: "当前权限范围内没有可见站点。",
    emptyBody: "请为该租户创建或选择一个已配置的站点记录以开始运营。",
    footerNote: "下方登记表仍可用于搜索、筛选、列偏好和批量管理。",
    headline: "站点工作区",
    manageDomains: "管理域名 →",
    missingCanonical: "无有效主域名",
    notConfigured: "尚未配置域名",
    openSite: "打开站点 →",
    publisherRestricted: "受限",
    releaseLabel: "发布版本",
    releaseNone: "暂无",
    releaseHistory: "发布历史",
    sites: "站点",
    sitesActive: "启用中",
    sitesActiveNote: "已启用的站点记录",
    sitesNote: "您的角色可见范围",
    kicker: "站点运营",
    scopeLine: (sites: number, active: number) =>
      `${sites} 个站点 · ${active} 个启用（在您的权限范围内）`,
    updatedAt: "更新于",
    viewEditions: "查看版本 →",
    workload: "工作流",
    workloadLine: (c: { approved: number; compiled: number; draft: number; published: number; review: number }) =>
      `${c.draft} 草稿 · ${c.review} 待审核 · ${c.approved} 已批准 · ${c.compiled} 已编译 · ${c.published} 已发布`,
  },
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

type WorkspaceText = (typeof TEXT)["zh"]

const metric = (
  value: number | "Restricted",
  label: string,
  note: string,
  t: WorkspaceText,
  tone: "neutral" | "warning" = "neutral",
) => (
  <article
    className={`${cardClass} flex flex-col gap-1 p-5 ${
      tone === "warning" ? "border-l-[3px] border-l-[var(--theme-warning-500)]" : ""
    }`}
  >
    {value === "Restricted" ? (
      <Badge>{t.publisherRestricted}</Badge>
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
export const SitesOperationsWorkspace = async ({ i18n, payload, user }: SitesWorkspaceProps) => {
  const role = user?.role as CmsRole | undefined
  const canReadReleases = role !== undefined && releaseRoles.has(role)
  const t = TEXT[uiLangOf(i18n?.language)]
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
      aria-label={t.headline}
      className="mx-auto mb-8 flex max-w-[1440px] flex-col gap-6 p-8 md:p-6"
    >
      <header className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="m-0 mb-1 text-xs font-extrabold uppercase tracking-[0.06em] text-[var(--gf-accent-700)]">
            {t.kicker}
          </p>
          <h2 className="m-0 text-xl font-semibold tracking-tight text-[var(--theme-text)]">
            {t.headline}
          </h2>
          <span className="mt-1 block text-sm text-[var(--theme-elevation-600)]">
            {t.scopeLine(sites.length, activeSites)}
          </span>
        </div>
        <strong className="shrink-0 whitespace-nowrap rounded-full bg-[var(--theme-elevation-100)] px-3 py-1.5 text-xs font-bold text-[var(--theme-elevation-700)]">
          {role === CMS_ROLE.SUPER_ADMIN ? t.allTenants : t.currentTenant}
        </strong>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metric(sites.length, t.sites, t.sitesNote, t)}
        {metric(activeSites, t.sitesActive, t.sitesActiveNote, t)}
        {metric(
          missingCanonical,
          t.domainsToConfigure,
          t.domainsToConfigureNote,
          t,
          missingCanonical > 0 ? "warning" : "neutral",
        )}
        {metric(
          canReadReleases ? currentBySite.size : "Restricted",
          t.currentReleases,
          canReadReleases ? t.currentReleasesLedger : t.currentReleasesRestricted,
          t,
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
              ? t.canonicalDisabled
              : domains?.configured
                ? t.missingCanonical
                : t.notConfigured)
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
                    {SITE_STATUS_LABEL[uiLangOf(i18n?.language)][stringOf(site["status"])] ??
                      stringOf(site["status"])}
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
                    {stringOf(site["locale"])} · {stringOf(site["timezone"])} · {t.updatedAt}{" "}
                    {formatDate(site["updatedAt"])}
                  </p>
                </div>
                <IconBadge tone="accent">
                  <GlobeIcon size={20} strokeWidth={1.65} />
                </IconBadge>
              </div>

              <dl className="m-0 grid gap-2">
                <div className="grid grid-cols-[64px_1fr] items-baseline gap-2">
                  <dt className="text-xs text-[var(--theme-elevation-600)]">{t.domainLabel}</dt>
                  <dd
                    className={`m-0 truncate text-sm ${
                      domains?.canonicalHostname === null || domains === undefined
                        ? "font-semibold text-[var(--theme-warning-700)]"
                        : "text-[var(--theme-text)]"
                    }`}
                  >
                    {domainState}
                    {domains !== undefined && domains.aliases > 0 ? t.aliases(domains.aliases) : ""}
                  </dd>
                </div>
                <div className="grid grid-cols-[64px_1fr] items-baseline gap-2">
                  <dt className="text-xs text-[var(--theme-elevation-600)]">{t.releaseLabel}</dt>
                  <dd className="m-0 truncate font-mono text-sm text-[var(--theme-text)]">
                    {canReadReleases
                      ? stringOf(currentRelease?.["releaseId"], t.releaseNone)
                      : t.publisherRestricted}
                  </dd>
                </div>
                <div className="grid grid-cols-[64px_1fr] items-baseline gap-2">
                  <dt className="text-xs text-[var(--theme-elevation-600)]">{t.workload}</dt>
                  <dd className="m-0 truncate text-sm text-[var(--theme-text)]">
                    {t.workloadLine(counts)}
                  </dd>
                </div>
              </dl>

              <div className="flex flex-wrap gap-2">
                <ActionLink href={`/admin/collections/sites/${siteId}`} variant="primary">
                  {t.openSite}
                </ActionLink>
                <ActionLink href="/admin/collections/domains">{t.manageDomains}</ActionLink>
                <ActionLink href="/admin/collections/content-editions">{t.viewEditions}</ActionLink>
                {canReadReleases && (
                  <ActionLink href="/admin/collections/releases">
                    <PackageIcon size={15} /> {t.releaseHistory}
                  </ActionLink>
                )}
                {canEditSite(role) && (
                  <ActionLink href={`/admin/collections/sites/${siteId}`}>{t.editConfig}</ActionLink>
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
          <AlertTriangleIcon size={20} strokeWidth={1.65} />
          <div className="grid gap-0.5">
            <strong className="text-sm text-[var(--theme-text)]">{t.emptyHeadline}</strong>
            <span className="text-sm text-[var(--theme-elevation-600)]">{t.emptyBody}</span>
          </div>
        </div>
      )}

      <footer className="flex flex-col items-start justify-between gap-2 border-t border-[var(--gf-border)] pt-4 text-sm text-[var(--theme-elevation-600)] sm:flex-row sm:items-center">
        <span>{t.footerNote}</span>
        <a
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[var(--gf-accent-700)] no-underline hover:underline"
          href="/admin/collections/content-editions?where[workflowStatus][equals]=compiled"
        >
          <SendIcon size={16} /> {t.compiledLink}
        </a>
      </footer>
    </section>
  )
}
