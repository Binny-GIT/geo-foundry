import Link from "next/link"

import { CMS_ACTION } from "@/access/policy"
import {
  CheckCircleIcon,
  GlobeIcon,
  LayersIcon,
  PackageIcon,
} from "@/components/icons"
import {
  CONSOLE_RESOURCES,
  consoleRoute,
  type ConsoleResourceSlug,
} from "@/console/lib/resources"
import {
  countConsoleResource,
  requireConsolePayloadContext,
} from "@/console/lib/payload.server"
import { canConsole } from "@/console/lib/session.server"

export const metadata = {
  title: "Dashboard | Geo Foundry",
}

const DASHBOARD_METRICS: readonly {
  readonly Icon: typeof GlobeIcon
  readonly slug: ConsoleResourceSlug
}[] = [
  { Icon: GlobeIcon, slug: "sites" },
  { Icon: LayersIcon, slug: "content-editions" },
  { Icon: CheckCircleIcon, slug: "quality-assessments" },
  { Icon: PackageIcon, slug: "releases" },
]

const ConsoleDashboardPage = async () => {
  const context = await requireConsolePayloadContext()
  const metrics = await Promise.all(
    DASHBOARD_METRICS.map(async ({ Icon, slug }) => {
      const resource = CONSOLE_RESOURCES[slug]
      const value =
        resource.resource === null
          ? null
          : await countConsoleResource(context, resource.resource, resource.apiSlug)
      return { Icon, resource, value }
    }),
  )

  const quickLinks = Object.values(CONSOLE_RESOURCES).filter(
    (resource) => resource.resource !== null && canConsole(context.session, resource.resource, CMS_ACTION.READ),
  )

  return (
    <div className="grid gap-7">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-indigo-600">GF Studio</p>
          <h1 className="m-0 pt-1 text-3xl font-semibold tracking-tight text-[var(--console-ink)]">
            内容运营控制中心
          </h1>
          <p className="m-0 max-w-2xl pt-2 text-sm leading-6 text-[var(--console-ink-muted)]">
            所有数据均由当前会话的服务端权限范围读取；无访问权限的资源不会被伪装成空数据。
          </p>
        </div>
        <span className="w-fit rounded-full border border-[var(--console-border)] bg-[var(--console-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--console-ink-muted)]">
          当前角色：{context.session.role}
        </span>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ Icon, resource, value }) => (
          <Link
            className="gf-console-card gf-console-focus group grid min-h-[148px] content-between p-5 no-underline transition-transform hover:-translate-y-0.5"
            href={consoleRoute.collection(resource.apiSlug)}
            key={resource.apiSlug}
          >
            <span className="grid size-10 place-items-center rounded-xl bg-indigo-50 text-indigo-600 group-hover:bg-indigo-100 dark:bg-indigo-400/15 dark:text-indigo-300">
              <Icon size={20} />
            </span>
            <div>
              <strong className="block text-3xl font-semibold tracking-tight text-[var(--console-ink)]">
                {value === null ? "受限" : value}
              </strong>
              <span className="block pt-1 text-sm font-medium text-[var(--console-ink)]">
                {resource.label.zh}
              </span>
              <span className="block pt-1 text-xs text-[var(--console-ink-muted)]">
                {value === null ? "当前角色无权读取" : resource.subtitle.zh}
              </span>
            </div>
          </Link>
        ))}
      </section>

      <section className="gf-console-card p-5 sm:p-6">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-indigo-600">资源工作区</p>
            <h2 className="m-0 pt-1 text-xl font-semibold tracking-tight text-[var(--console-ink)]">
              在当前权限范围内继续工作
            </h2>
          </div>
          <span className="text-xs text-[var(--console-ink-muted)]">{quickLinks.length} 个可用资源</span>
        </div>
        <div className="grid gap-3 pt-5 sm:grid-cols-2 xl:grid-cols-3">
          {quickLinks.map((resource) => {
            const Icon = resource.icon
            return (
              <Link
                className="gf-console-focus flex min-h-20 items-center gap-3 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] p-4 no-underline transition-colors hover:border-indigo-300 hover:bg-indigo-50/60 dark:hover:bg-indigo-400/8"
                href={consoleRoute.collection(resource.apiSlug)}
                key={resource.apiSlug}
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--console-surface)] text-indigo-600 shadow-sm dark:text-indigo-300">
                  <Icon size={18} />
                </span>
                <span className="min-w-0">
                  <strong className="block truncate text-sm text-[var(--console-ink)]">{resource.label.zh}</strong>
                  <small className="block truncate pt-1 text-xs text-[var(--console-ink-muted)]">{resource.subtitle.zh}</small>
                </span>
              </Link>
            )
          })}
        </div>
      </section>
    </div>
  )
}

export default ConsoleDashboardPage
