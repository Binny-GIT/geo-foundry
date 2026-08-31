import Link from "next/link"
import { notFound } from "next/navigation"

import { CMS_ACTION, CMS_RESOURCE } from "@/access/policy"
import { CMS_ROLE } from "@/access/roles"
import { ReleaseRestore } from "@/console/components/ReleaseRestore"
import { consoleRoute } from "@/console/lib/resources"
import { requireConsolePayloadContext } from "@/console/lib/payload.server"
import { canConsole } from "@/console/lib/session.server"

const WORKFLOW_STATES = [
  { key: "draft", label: "草稿" },
  { key: "review", label: "待审核" },
  { key: "approved", label: "已通过" },
  { key: "published", label: "已发布" },
  { key: "archived", label: "已删除" },
] as const

const WORKFLOW_LABELS: Readonly<Record<string, string>> = {
  archived: "已删除",
  compiled: "已编译",
  draft: "草稿",
  generating: "生成中",
  published: "已发布",
  review: "待审核",
  approved: "已通过",
}

const RELEASE_STATE_LABELS: Readonly<Record<string, string>> = {
  building: "构建中",
  current: "当前版本",
  rolled_back: "已回滚",
  superseded: "已被替换",
  uploaded: "已上传",
  validated: "已校验",
}

const formatInstant = (value: unknown): string => {
  if (typeof value !== "string") return "—"
  const date = new Date(value)
  return Number.isNaN(date.valueOf())
    ? "—"
    : new Intl.DateTimeFormat("zh-CN", {
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(date)
}

const relationText = (value: unknown, field: string): string | null => {
  if (typeof value !== "object" || value === null) return null
  const text = (value as Record<string, unknown>)[field]
  return typeof text === "string" && text.length > 0 ? text : null
}

const SiteDetail = async ({ id }: { readonly id: string }) => {
  const context = await requireConsolePayloadContext()
  const { payload, session, user } = context
  const siteId = Number.parseInt(id, 10)
  if (!Number.isSafeInteger(siteId) || siteId <= 0) notFound()

  let site: Record<string, unknown>
  try {
    site = (await payload.findByID({
      collection: "sites",
      depth: 1,
      id: siteId,
      overrideAccess: false,
      user,
    })) as unknown as Record<string, unknown>
  } catch {
    notFound()
  }

  const name = typeof site["name"] === "string" && site["name"].length > 0 ? site["name"] : `站点 #${String(siteId)}`
  const tenantName = relationText(site["tenant"], "name")
  const canReadEditions = canConsole(session, CMS_RESOURCE.EDITIONS, CMS_ACTION.READ)
  const canReadDomains = canConsole(session, CMS_RESOURCE.DOMAINS, CMS_ACTION.READ)
  const canReadReleases = canConsole(session, CMS_RESOURCE.RELEASES, CMS_ACTION.READ)
  const canReadOperations = canConsole(session, CMS_RESOURCE.OPERATIONS, CMS_ACTION.READ)
  const isPublisher = session.role === CMS_ROLE.PUBLISHER || session.role === CMS_ROLE.SUPER_ADMIN
  const canCreateDomain = canConsole(session, CMS_RESOURCE.DOMAINS, CMS_ACTION.CREATE)

  const [statusCounts, domains, canonicalDomain, recentEditions, releases, operations] = await Promise.all([
    canReadEditions
      ? Promise.all(
          WORKFLOW_STATES.map((state) =>
            payload
              .count({
                collection: "content-editions",
                overrideAccess: false,
                user,
                where: { and: [{ site: { equals: siteId } }, { workflowStatus: { equals: state.key } }] },
              })
              .then((result) => result.totalDocs ?? 0),
          ),
        )
      : null,
    canReadDomains
      ? payload
          .find({
            collection: "domains",
            depth: 0,
            limit: 50,
            overrideAccess: false,
            sort: "hostname",
            user,
            where: { site: { equals: siteId } },
          })
          .then((result) => result.docs as unknown as readonly Record<string, unknown>[])
          .catch(() => [] as readonly Record<string, unknown>[])
      : null,
    canReadDomains
      ? payload
          .find({
            collection: "domains",
            depth: 0,
            limit: 1,
            overrideAccess: false,
            user,
            where: {
              and: [
                { site: { equals: siteId } },
                { role: { equals: "canonical" } },
                { status: { equals: "active" } },
              ],
            },
          })
          .then((result) => (result.docs[0] ?? null) as Record<string, unknown> | null)
          .catch(() => null)
      : null,
    canReadEditions
      ? payload
          .find({
            collection: "content-editions",
            depth: 1,
            draft: true,
            limit: 10,
            overrideAccess: false,
            sort: "-updatedAt",
            user,
            where: { site: { equals: siteId } },
          })
          .then((result) => result.docs as unknown as readonly Record<string, unknown>[])
          .catch(() => [] as readonly Record<string, unknown>[])
      : null,
    canReadReleases
      ? payload
          .find({
            collection: "releases",
            depth: 0,
            limit: 20,
            overrideAccess: false,
            sort: "-createdAt",
            user,
            where: { site: { equals: siteId } },
          })
          .then((result) => result.docs as unknown as readonly Record<string, unknown>[])
          .catch(() => [] as readonly Record<string, unknown>[])
      : null,
    canReadOperations
      ? payload
          .find({
            collection: "operations",
            depth: 0,
            limit: 10,
            overrideAccess: false,
            sort: "-updatedAt",
            user,
            where: { site: { equals: siteId } },
          })
          .then((result) => result.docs as unknown as readonly Record<string, unknown>[])
          .catch(() => [] as readonly Record<string, unknown>[])
      : null,
  ])

  const hostname = canonicalDomain === null ? null : typeof canonicalDomain["hostname"] === "string" ? canonicalDomain["hostname"] : null
  const entryUrl = hostname === null ? null : `https://${hostname}`
  const currentRelease = (releases ?? []).find((release) => release["state"] === "current")
  const currentRestore = currentRelease === undefined ? null : {
    manifestSha256: String(currentRelease["manifestSha256"] ?? ""),
    releaseId: String(currentRelease["releaseId"] ?? ""),
  }

  return (
    <div className="grid gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Link
            className="gf-console-focus text-sm font-semibold text-indigo-700 no-underline hover:underline"
            href={consoleRoute.collection("sites")}
          >
            ← 返回站点列表
          </Link>
          <p className="m-0 pt-5 text-xs font-bold uppercase tracking-[0.12em] text-indigo-600">站点详情</p>
          <h1 className="m-0 break-words pt-1 text-3xl font-semibold tracking-tight text-[var(--console-ink)]">
            {name}
          </h1>
          <div className="flex flex-wrap items-center gap-2 pt-3 text-xs text-[var(--console-ink-muted)]">
            <span className="rounded-full bg-indigo-50 px-3 py-1 font-semibold text-indigo-700">
              {site["status"] === "active" ? "启用" : String(site["status"] ?? "—")}
            </span>
            {session.role === CMS_ROLE.SUPER_ADMIN && tenantName !== null && (
              <span className="rounded-full bg-[var(--console-surface-muted)] px-3 py-1 font-semibold">
                租户：{tenantName}
              </span>
            )}
            <span>{relationText(site, "locale") ?? "—"}</span>
            <span aria-hidden="true">·</span>
            <span>{relationText(site, "timezone") ?? "UTC"}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {entryUrl !== null && (
            <a
              className="gf-console-focus inline-flex h-10 items-center rounded-xl border border-[var(--console-border)] bg-[var(--console-surface)] px-3.5 text-sm font-semibold text-[var(--console-ink)] no-underline hover:bg-[var(--console-surface-muted)]"
              href={entryUrl}
              rel="noreferrer"
              target="_blank"
            >
              打开站点入口
            </a>
          )}
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {WORKFLOW_STATES.map((state, index) => (
          <div className="gf-console-card grid content-between gap-2 p-4" key={state.key}>
            <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--console-ink-muted)]">
              {state.label}
            </span>
            <strong className="text-2xl font-semibold tabular-nums text-[var(--console-ink)]">
              {statusCounts === null ? "受限" : (statusCounts[index] ?? 0)}
            </strong>
          </div>
        ))}
      </section>

      <section className="gf-console-card grid gap-3 p-5">
        <h2 className="m-0 text-base font-semibold tracking-tight text-[var(--console-ink)]">
          站点信息与文章入口
        </h2>
        <dl className="m-0 grid gap-4 border-t border-[var(--console-border)] pt-4 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--console-ink-muted)]">站点入口</dt>
            <dd className="m-0 break-all pt-1 text-sm text-[var(--console-ink)]">
              {entryUrl ?? "尚未配置启用的规范域名"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--console-ink-muted)]">文章入口前缀</dt>
            <dd className="m-0 break-all pt-1 text-sm text-[var(--console-ink)]">
              {entryUrl === null ? "—" : `${entryUrl}/articles/`}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--console-ink-muted)]">交付 API</dt>
            <dd className="m-0 break-all pt-1 font-mono text-xs leading-5 text-[var(--console-ink)]">
              {hostname === null ? "—" : `/api/delivery/sites/${hostname}/articles`}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--console-ink-muted)]">累计阅读</dt>
            <dd className="m-0 pt-1 text-sm text-[var(--console-ink-muted)]">流量统计数据接入后展示</dd>
          </div>
        </dl>
      </section>

      {domains !== null && (
        <section className="gf-console-card grid gap-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="m-0 text-base font-semibold tracking-tight text-[var(--console-ink)]">域名管理</h2>
            {canCreateDomain && (
              <Link
                className="gf-console-focus inline-flex h-9 items-center rounded-xl bg-[var(--console-accent)] px-3 text-xs font-semibold text-white no-underline hover:bg-[var(--console-accent-hover)]"
                href="/admin/collections/domains/create"
              >
                新增域名
              </Link>
            )}
          </div>
          {domains.length === 0 ? (
            <p className="m-0 rounded-xl border border-dashed border-[var(--console-border)] p-4 text-center text-sm text-[var(--console-ink-muted)]">
              该站点还没有域名；发布前需要至少一个启用的规范域名。
            </p>
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0">
              {domains.map((domain) => (
                <li
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-4 py-3"
                  key={String(domain["id"])}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-sm text-[var(--console-ink)]">
                    {String(domain["hostname"] ?? "")}
                  </span>
                  <span className="flex shrink-0 gap-2 text-xs">
                    <span className="rounded-full bg-[var(--console-surface)] px-2 py-1 font-semibold text-[var(--console-ink-muted)]">
                      {domain["role"] === "canonical" ? "规范域名" : "别名"}
                    </span>
                    <span
                      className={`rounded-full px-2 py-1 font-semibold ${
                        domain["status"] === "active"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-[var(--console-surface)] text-[var(--console-ink-muted)]"
                      }`}
                    >
                      {domain["status"] === "active" ? "启用" : "停用"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {recentEditions !== null && (
        <section className="gf-console-card grid gap-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="m-0 text-base font-semibold tracking-tight text-[var(--console-ink)]">该站文章</h2>
            <Link
              className="gf-console-focus text-sm font-semibold text-indigo-700 no-underline hover:underline"
              href={`/admin/collections/content-editions?site=${siteId}`}
            >
              查看全部（筛选此站点）→
            </Link>
          </div>
          {recentEditions.length === 0 ? (
            <p className="m-0 rounded-xl border border-dashed border-[var(--console-border)] p-4 text-center text-sm text-[var(--console-ink-muted)]">
              该站点还没有文章。
            </p>
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0">
              {recentEditions.map((edition) => {
                const status = typeof edition["workflowStatus"] === "string" ? edition["workflowStatus"] : ""
                return (
                  <li
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--console-border)] px-4 py-3"
                    key={String(edition["id"])}
                  >
                    <Link
                      className="gf-console-focus min-w-0 flex-1 truncate text-sm font-semibold text-[var(--console-ink)] no-underline hover:text-indigo-600"
                      href={consoleRoute.document("content-editions", String(edition["id"]))}
                    >
                      {typeof edition["title"] === "string" && edition["title"].length > 0
                        ? edition["title"]
                        : "未命名稿件"}
                    </Link>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-[var(--console-ink-muted)]">
                      <span className="rounded-full bg-indigo-50 px-2 py-1 font-semibold text-indigo-700">
                        {WORKFLOW_LABELS[status] ?? status}
                      </span>
                      {formatInstant(edition["updatedAt"])}（UTC）
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {releases !== null && (
        <section className="gf-console-card grid gap-4 p-5">
          <h2 className="m-0 text-base font-semibold tracking-tight text-[var(--console-ink)]">
            发布历史与恢复
          </h2>
          {releases.length === 0 ? (
            <p className="m-0 rounded-xl border border-dashed border-[var(--console-border)] p-4 text-center text-sm text-[var(--console-ink-muted)]">
              该站点还没有发布版本。
            </p>
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0">
              {releases.map((release) => {
                const state = typeof release["state"] === "string" ? release["state"] : ""
                const releaseId = String(release["releaseId"] ?? "")
                const manifestSha256 = String(release["manifestSha256"] ?? "")
                const restorable =
                  isPublisher &&
                  currentRestore !== null &&
                  state !== "current" &&
                  releaseId.length > 0 &&
                  manifestSha256.length > 0 &&
                  currentRestore.releaseId !== releaseId
                return (
                  <li
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--console-border)] px-4 py-3"
                    key={releaseId}
                  >
                    <span className="grid min-w-0 gap-0.5">
                      <span className="truncate font-mono text-xs text-[var(--console-ink)]">
                        {releaseId.slice(0, 28)}…
                      </span>
                      <span className="text-xs text-[var(--console-ink-muted)]">
                        {formatInstant(release["createdAt"])}（UTC） · manifest {manifestSha256.slice(0, 12)}…
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          state === "current"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-[var(--console-surface-muted)] text-[var(--console-ink-muted)]"
                        }`}
                      >
                        {RELEASE_STATE_LABELS[state] ?? state}
                      </span>
                      {restorable && currentRestore !== null && (
                        <ReleaseRestore
                          current={currentRestore}
                          reasonHint="回滚只切换发布指针，不重新编译"
                          siteId={siteId}
                          target={{ manifestSha256, releaseId }}
                        />
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {operations !== null && (
        <section className="gf-console-card grid gap-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="m-0 text-base font-semibold tracking-tight text-[var(--console-ink)]">该站操作日志</h2>
            <Link
              className="gf-console-focus text-sm font-semibold text-indigo-700 no-underline hover:underline"
              href={consoleRoute.collection("operations")}
            >
              全部操作日志 →
            </Link>
          </div>
          {operations.length === 0 ? (
            <p className="m-0 rounded-xl border border-dashed border-[var(--console-border)] p-4 text-center text-sm text-[var(--console-ink-muted)]">
              该站点暂无操作记录。
            </p>
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0">
              {operations.map((operation) => (
                <li
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--console-border)] px-4 py-3"
                  key={String(operation["operationId"] ?? operation["id"])}
                >
                  <Link
                    className="gf-console-focus text-sm font-semibold text-[var(--console-ink)] no-underline hover:text-indigo-600"
                    href={consoleRoute.document("operations", String(operation["id"]))}
                  >
                    {String(operation["operationType"] ?? "操作")}
                  </Link>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-[var(--console-ink-muted)]">
                    <span
                      className={`rounded-full px-2 py-1 font-semibold ${
                        operation["state"] === "succeeded"
                          ? "bg-emerald-50 text-emerald-700"
                          : operation["state"] === "failed"
                            ? "bg-rose-50 text-rose-700"
                            : "bg-[var(--console-surface-muted)]"
                      }`}
                    >
                      {String(operation["state"] ?? "—")}
                    </span>
                    {formatInstant(operation["updatedAt"])}（UTC）
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

export default SiteDetail
