import type { Payload } from "payload"

import { CMS_ROLE, type CmsRole } from "../../access/roles"
import {
  idOf,
  type RecordLike,
  recordsOf,
  stringOf,
  summarizeDomains,
} from "../dashboard/operations-model"
import { type HasLanguage, uiLangOf } from "../i18n/ui-lang"
import { GlobeIcon, UsersIcon } from "../icons"
import { IconBadge } from "../ui"
import { siteStatusLabel } from "../workspaces/workspace-labels"
import {
  type WorkspaceServerContext,
  workspaceUserOf,
} from "../workspaces/workspace-server-context"
import {
  cardClass,
  StatusBadge,
  WorkspaceAction,
  WorkspaceDenied,
  WorkspaceEmpty,
  WorkspaceShell,
} from "../workspaces/workspace-shared"

export type TenantWorkspaceProps = WorkspaceServerContext & {
  readonly i18n?: HasLanguage
  readonly payload: Payload
}

const readableRoles = new Set<CmsRole>([CMS_ROLE.SUPER_ADMIN, CMS_ROLE.TENANT_ADMIN])

const TEXT = {
  en: {
    domains: "Domains",
    needsDomain: "Needs canonical domain",
    people: "People",
    settings: "Open settings",
    sites: "Sites",
    tenant: "Tenant workspace",
    users: "Users",
  },
  zh: {
    domains: "域名",
    needsDomain: "待配置主域名",
    people: "成员",
    settings: "打开设置",
    sites: "站点",
    tenant: "租户工作区",
    users: "用户",
  },
} as const

export const TenantWorkspace = async ({
  i18n,
  initPageResult,
  payload,
  user,
}: TenantWorkspaceProps) => {
  const lang = uiLangOf(i18n?.language)
  const t = TEXT[lang]
  const currentUser = workspaceUserOf({ initPageResult, user })
  const role = currentUser?.role as CmsRole | undefined
  if (role === undefined || !readableRoles.has(role)) return <WorkspaceDenied i18n={i18n} />

  const [sitesResult, domainsResult, usersResult] = await Promise.all([
    payload.find({
      collection: "sites",
      depth: 0,
      limit: 100,
      overrideAccess: false,
      ...(currentUser === undefined ? {} : { user: currentUser }),
      sort: "name",
    }),
    payload.find({
      collection: "domains",
      depth: 0,
      limit: 100,
      overrideAccess: false,
      ...(currentUser === undefined ? {} : { user: currentUser }),
      sort: "hostname",
    }),
    payload.find({
      collection: "users",
      depth: 0,
      limit: 100,
      overrideAccess: false,
      ...(currentUser === undefined ? {} : { user: currentUser }),
      sort: "email",
    }),
  ])
  const sites = recordsOf(sitesResult.docs)
  const users = recordsOf(usersResult.docs)
  const domainsBySite = summarizeDomains(recordsOf(domainsResult.docs))
  const missingCanonical = sites.filter(
    (site) => domainsBySite.get(idOf(site) ?? "")?.canonicalHostname === null,
  ).length

  return (
    <WorkspaceShell i18n={i18n} kicker="Geo Foundry" title={t.tenant}>
      {sites.length === 0 ? (
        <WorkspaceEmpty i18n={i18n} />
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-3">
            {[
              [t.sites, sites.length],
              [t.domains, domainsResult.totalDocs],
              [t.users, users.length],
            ].map(([label, value]) => (
              <article className={`${cardClass} p-5`} key={String(label)}>
                <p className="m-0 text-xs text-[var(--theme-elevation-600)]">{label}</p>
                <strong className="mt-2 block text-2xl tabular-nums text-[var(--theme-text)]">
                  {value}
                </strong>
              </article>
            ))}
          </section>
          <section className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
            <article className={`${cardClass} flex min-w-0 flex-col gap-4 p-5`}>
              <div className="flex min-w-0 items-center gap-3">
                <IconBadge tone="accent">
                  <GlobeIcon size={18} />
                </IconBadge>
                <h2 className="m-0 text-base font-bold text-[var(--theme-text)]">{t.sites}</h2>
              </div>
              <ul className="m-0 flex min-w-0 list-none flex-col p-0">
                {sites.map((site) => {
                  const siteId = idOf(site) ?? ""
                  const domain = domainsBySite.get(siteId)
                  const missing = domain?.canonicalHostname === null || domain === undefined
                  return (
                    <li
                      className="flex min-w-0 items-center justify-between gap-3 border-t border-[var(--theme-elevation-100)] py-3 first:border-t-0 first:pt-0"
                      key={siteId}
                    >
                      <div className="min-w-0">
                        <a
                          className="block truncate text-sm font-semibold text-[var(--theme-text)] no-underline hover:text-[var(--gf-accent-700)]"
                          href={`/admin/collections/sites/${siteId}`}
                        >
                          {stringOf(site["name"], siteId)}
                        </a>
                        <span className="block truncate text-xs text-[var(--theme-elevation-600)]">
                          {domain?.canonicalHostname ?? t.needsDomain}
                        </span>
                      </div>
                      <StatusBadge
                        label={missing ? t.needsDomain : siteStatusLabel(site["status"], lang)}
                        state={missing ? "configure" : stringOf(site["status"])}
                      />
                    </li>
                  )
                })}
              </ul>
              <WorkspaceAction href="/admin/collections/sites" primary>
                {t.settings}
              </WorkspaceAction>
            </article>
            <article className={`${cardClass} flex min-w-0 flex-col gap-4 p-5`}>
              <div className="flex items-center gap-3">
                <IconBadge tone={missingCanonical > 0 ? "warning" : "success"}>
                  <UsersIcon size={18} />
                </IconBadge>
                <h2 className="m-0 text-base font-bold text-[var(--theme-text)]">{t.people}</h2>
              </div>
              <p className="m-0 text-sm text-[var(--theme-elevation-600)]">
                {t.users} · {users.length}
              </p>
              <p className="m-0 text-sm text-[var(--theme-elevation-600)]">
                {t.needsDomain} · {missingCanonical}
              </p>
              <WorkspaceAction href="/admin/collections/users">{t.settings}</WorkspaceAction>
              <WorkspaceAction href="/admin/collections/domains">{t.domains}</WorkspaceAction>
            </article>
          </section>
        </>
      )}
    </WorkspaceShell>
  )
}
