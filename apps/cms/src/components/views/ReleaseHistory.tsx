import type { Payload } from "payload"

import { CMS_ROLE, type CmsRole } from "../../access/roles"
import { recordsOf, stringOf, type RecordLike } from "../dashboard/operations-model"
import { PackageIcon, RotateCcwIcon } from "../icons"
import { uiLangOf, type HasLanguage } from "../i18n/ui-lang"
import { IconBadge } from "../ui"
import { releaseHistoryForSite, rollbackCandidatesForSite } from "../workspaces/lifecycle-workspace-model"
import { workspaceUserOf, type WorkspaceServerContext } from "../workspaces/workspace-server-context"
import { releaseStateLabel } from "../workspaces/workspace-labels"
import {
  cardClass,
  StatusBadge,
  WorkspaceAction,
  WorkspaceDenied,
  WorkspaceEmpty,
  WorkspaceShell,
} from "../workspaces/workspace-shared"

export type ReleaseHistoryProps = WorkspaceServerContext & {
  readonly i18n?: HasLanguage
  readonly payload: Payload
}

const readableRoles = new Set<CmsRole>([
  CMS_ROLE.PUBLISHER,
  CMS_ROLE.SUPER_ADMIN,
  CMS_ROLE.TENANT_ADMIN,
])

const TEXT = {
  en: {
    candidates: "Safe rollback candidates",
    candidatesHint: "Only prior stable releases are listed. Restoring one always requires current-pointer preconditions and publisher approval.",
    current: "Current release",
    history: "Release history",
    manifest: "Manifest",
    noCurrent: "No current release is visible for this site.",
    openLedger: "Open release ledger",
    release: "Release",
    rollback: "Open rollback records",
    site: "Site",
  },
  zh: {
    candidates: "安全回滚候选版本",
    candidatesHint: "仅显示稳定的历史发布版本。恢复仍必须满足当前指针前置条件并由发布者批准。",
    current: "当前发布版本",
    history: "发布历史",
    manifest: "清单",
    noCurrent: "此站点没有可见的当前发布版本。",
    openLedger: "打开发布台账",
    release: "发布版本",
    rollback: "打开回滚记录",
    site: "站点",
  },
} as const

const short = (value: string | null) => (value === null ? "—" : value.length > 16 ? `${value.slice(0, 16)}…` : value)

export const ReleaseHistory = async ({ i18n, initPageResult, payload, user }: ReleaseHistoryProps) => {
  const lang = uiLangOf(i18n?.language)
  const t = TEXT[lang]
  const currentUser = workspaceUserOf({ initPageResult, user })
  const role = currentUser?.role as CmsRole | undefined
  if (role === undefined || !readableRoles.has(role)) return <WorkspaceDenied i18n={i18n} />

  const [sitesResult, releasesResult] = await Promise.all([
    payload.find({ collection: "sites", depth: 0, limit: 100, overrideAccess: false, ...(currentUser === undefined ? {} : { user: currentUser }), sort: "name" }),
    payload.find({ collection: "releases", depth: 0, limit: 100, overrideAccess: false, ...(currentUser === undefined ? {} : { user: currentUser }), sort: "-updatedAt" }),
  ])
  const sites = recordsOf(sitesResult.docs)
  const releases = recordsOf(releasesResult.docs)

  return (
    <WorkspaceShell i18n={i18n} kicker="Geo Foundry" title={t.history}>
      {sites.length === 0 ? <WorkspaceEmpty i18n={i18n} /> : (
        <section className="grid gap-5">
          {sites.map((site) => {
            const siteId = String(site["id"])
            const tenantId = site["tenant"]
            const tenantKey =
              typeof tenantId === "number" || typeof tenantId === "string"
                ? tenantId
                : typeof tenantId === "object" && tenantId !== null && "id" in tenantId
                  ? (tenantId as { readonly id?: unknown }).id
                  : null
            const history =
              typeof tenantKey === "number" || typeof tenantKey === "string"
                ? releaseHistoryForSite(releases, siteId, tenantKey)
                : []
            const current = history.find((release) => release.state === "current")
            const candidates =
              typeof tenantKey === "number" || typeof tenantKey === "string"
                ? rollbackCandidatesForSite(releases, siteId, tenantKey)
                : []
            return (
              <article className={`${cardClass} flex min-w-0 flex-col gap-5 p-5`} key={siteId}>
                <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3"><IconBadge tone="accent"><PackageIcon size={18} /></IconBadge><div className="min-w-0"><p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">{t.site}</p><h2 className="m-0 mt-1 truncate text-lg font-bold text-[var(--theme-text)]">{stringOf(site["name"], siteId)}</h2></div></div>
                  <WorkspaceAction href={`/admin/collections/sites/${siteId}`}>{t.openLedger}</WorkspaceAction>
                </div>

                {current === undefined ? <p className="m-0 text-sm text-[var(--theme-elevation-600)]">{t.noCurrent}</p> : <div className="grid gap-3 rounded-xl border border-[var(--gf-accent-200)] bg-[var(--gf-tone-accent-bg)] p-4 sm:grid-cols-[minmax(0,1fr)_auto]"><div className="min-w-0"><span className="text-xs font-semibold text-[var(--gf-accent-700)]">{t.current}</span><strong className="mt-1 block truncate font-mono text-sm text-[var(--theme-text)]">{current.releaseId}</strong><span className="mt-1 block truncate text-xs text-[var(--theme-elevation-600)]">{t.manifest} · {short(current.manifestSha256)}</span></div><StatusBadge label={releaseStateLabel(current.state, lang)} state={current.state} /></div>}

                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <section><h3 className="m-0 text-sm font-bold text-[var(--theme-text)]">{t.release}</h3><ol className="m-0 mt-3 flex list-none flex-col p-0">{history.map((release) => <li className="flex items-center justify-between gap-3 border-t border-[var(--theme-elevation-100)] py-2.5 first:border-t-0 first:pt-0" key={release.releaseId}><div className="min-w-0"><a className="block truncate font-mono text-sm font-semibold text-[var(--theme-text)] no-underline hover:underline" href="/admin/collections/releases">{release.releaseId}</a><span className="block truncate text-xs text-[var(--theme-elevation-600)]">{t.manifest} · {short(release.manifestSha256)}</span></div><StatusBadge label={releaseStateLabel(release.state, lang)} state={release.state} /></li>)}</ol></section>
                  <section><div className="flex items-center gap-2"><RotateCcwIcon size={17} /><h3 className="m-0 text-sm font-bold text-[var(--theme-text)]">{t.candidates}</h3></div><p className="m-0 mt-2 text-xs leading-5 text-[var(--theme-elevation-600)]">{t.candidatesHint}</p>{candidates.length === 0 ? <p className="m-0 mt-3 text-sm text-[var(--theme-elevation-600)]">—</p> : <ul className="m-0 mt-3 flex list-none flex-col p-0">{candidates.map((candidate) => <li className="flex items-center justify-between gap-3 border-t border-[var(--theme-elevation-100)] py-2.5 first:border-t-0 first:pt-0" key={candidate.releaseId}><div className="min-w-0"><strong className="block truncate font-mono text-sm text-[var(--theme-text)]">{candidate.releaseId}</strong><span className="block truncate text-xs text-[var(--theme-elevation-600)]">{short(candidate.manifestSha256)}</span></div><StatusBadge label={releaseStateLabel(candidate.state, lang)} state={candidate.state} /></li>)}</ul>}<div className="mt-4"><WorkspaceAction href="/admin/collections/rollback-intents">{t.rollback}</WorkspaceAction></div></section>
                </div>
              </article>
            )
          })}
        </section>
      )}
    </WorkspaceShell>
  )
}
