import Link from "next/link"
import { notFound } from "next/navigation"
import { CMS_ACTION, CMS_RESOURCE } from "@/access/policy"
import { CMS_ROLE } from "@/access/roles"
import { ChevronDownIcon, NAV_ICON_BY_SLUG } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { ConsoleCreateDialog } from "@/console/components/ConsoleCreateDialog"
import { CreateArticleLink } from "@/console/components/CreateArticleLink"
import EditionsWorkspace, { type FilterOption } from "@/console/components/EditionsWorkspace"
import { PageHeader } from "@/console/components/PageHeader"
import { PublicationPlansWorkspace } from "@/console/components/PublicationPlansWorkspace"
import SitesWorkspace, { type SiteRow } from "@/console/components/SitesWorkspace"
import { articleListWhere, parseArticleListQuery } from "@/console/lib/article-filters"
import { findConsoleDocuments, requireConsolePayloadContext } from "@/console/lib/payload.server"
import {
  CONSOLE_RESOURCES,
  type ConsoleResourceSlug,
  consoleRoute,
  isConsoleResourceSlug,
} from "@/console/lib/resources"
import { canConsole } from "@/console/lib/session.server"
import { combineWhere, siteScopeWhere, sitesIdScopeWhere } from "@/console/lib/site-scope"

const formatValue = (value: unknown, relationship = false): string => {
  if (relationship && (typeof value === "number" || typeof value === "string")) return "受限"
  if (value === null || value === undefined) return "—"
  if (typeof value === "boolean") return value ? "是" : "否"
  if (typeof value === "number") return new Intl.NumberFormat("zh-CN").format(value)
  if (typeof value === "string") {
    if (value.length === 0) return "—"
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      const date = new Date(value)
      if (!Number.isNaN(date.valueOf())) {
        return new Intl.DateTimeFormat("zh-CN", {
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          month: "short",
          year: "numeric",
        }).format(date)
      }
    }
    return value
  }
  if (Array.isArray(value)) return value.length === 0 ? "—" : `${value.length} 项`
  if (typeof value === "object") {
    const record = value as Record<string, unknown>
    const label = record["name"] ?? record["title"] ?? record["email"] ?? record["hostname"]
    return typeof label === "string" && label.length > 0 ? label : "受限"
  }
  return "—"
}

const columnLabel = (column: string): string => {
  const labels: Readonly<Record<string, string>> = {
    alt: "替代文本",
    createdBy: "创建来源",
    email: "邮箱",
    filename: "文件名",
    hostname: "主机名",
    intent: "意图",
    operationId: "操作 ID",
    operationType: "操作类型",
    overall: "综合评分",
    pathname: "路径",
    releaseId: "发布版本",
    role: "角色",
    site: "站点",
    state: "状态",
    status: "状态",
    tenant: "租户",
    title: "标题",
    topic: "主题",
    updatedAt: "最近更新",
    workflowStatus: "工作流",
  }
  return labels[column] ?? column
}

type CollectionPageProps = {
  readonly params: Promise<{ readonly slug: string }>
  readonly searchParams: Promise<{
    readonly page?: string
    readonly q?: string
    readonly site?: string
    readonly status?: string
    readonly tenant?: string
    readonly view?: string
  }>
}

const filterOptions = async (
  context: Awaited<ReturnType<typeof requireConsolePayloadContext>>,
  collection: "sites" | "tenants",
): Promise<readonly FilterOption[]> => {
  const resource = collection === "sites" ? CMS_RESOURCE.SITES : CMS_RESOURCE.TENANTS
  if (!canConsole(context.session, resource, CMS_ACTION.READ)) return []
  try {
    const result = await context.payload.find({
      collection,
      depth: 0,
      limit: 100,
      overrideAccess: false,
      sort: "name",
      user: context.user,
    })
    return (result.docs as unknown as readonly Record<string, unknown>[]).flatMap((doc) => {
      const id = doc["id"]
      const name = doc["name"]
      return typeof id === "number" && typeof name === "string" && name.length > 0
        ? [{ id, name }]
        : []
    })
  } catch {
    return []
  }
}

const ConsoleCollectionPage = async ({ params, searchParams }: CollectionPageProps) => {
  const { slug } = await params
  if (!isConsoleResourceSlug(slug)) notFound()
  const query = await searchParams
  const requestedPage = Number.parseInt(query.page ?? "1", 10)
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1

  if (slug === "content-editions") {
    const context = await requireConsolePayloadContext()
    const articleQuery = parseArticleListQuery(query)
    const [result, siteOptions, tenantOptions] = await Promise.all([
      findConsoleDocuments({
        page,
        slug,
        where: combineWhere(articleListWhere(articleQuery), siteScopeWhere(context.session)),
      }),
      filterOptions(context, "sites"),
      context.session.role === CMS_ROLE.SUPER_ADMIN
        ? filterOptions(context, "tenants")
        : Promise.resolve([] as readonly FilterOption[]),
    ])
    return (
      <div className="grid gap-6 [&>*]:min-w-0">
        <PageHeader
          actions={
            canConsole(context.session, CMS_RESOURCE.EDITIONS, CMS_ACTION.CREATE) ? (
              <CreateArticleLink />
            ) : null
          }
          icon={NAV_ICON_BY_SLUG["content-editions"]}
          meta={
            <span className="rounded-full border border-[var(--console-border)] bg-[var(--console-surface)] px-3 py-1 text-xs font-semibold text-[var(--console-ink-muted)]">
              {result.totalDocs} 篇
            </span>
          }
          title="文章列表"
        />
        <EditionsWorkspace
          docs={result.docs}
          isSuperAdmin={context.session.role === CMS_ROLE.SUPER_ADMIN}
          page={result.page}
          query={articleQuery}
          siteOptions={siteOptions}
          tenantOptions={tenantOptions}
          totalDocs={result.totalDocs}
          totalPages={result.totalPages}
        />
      </div>
    )
  }

  if (slug === "sites") {
    const context = await requireConsolePayloadContext()
    const result = await findConsoleDocuments({
      page,
      slug,
      where: sitesIdScopeWhere(context.session),
    })
    const canReadEditions = canConsole(context.session, CMS_RESOURCE.EDITIONS, CMS_ACTION.READ)
    const canReadReleases = canConsole(context.session, CMS_RESOURCE.RELEASES, CMS_ACTION.READ)
    const rows = await Promise.all(
      result.docs.map(async (site): Promise<SiteRow> => {
        const siteId = site["id"] as number
        const [articleCount, latestRelease] = await Promise.all([
          canReadEditions
            ? context.payload
                .count({
                  collection: "content-editions",
                  overrideAccess: false,
                  user: context.user,
                  where: { site: { equals: siteId } },
                })
                .then((counted) => counted.totalDocs ?? 0)
                .catch(() => 0)
            : 0,
          canReadReleases
            ? context.payload
                .find({
                  collection: "releases",
                  depth: 0,
                  limit: 1,
                  overrideAccess: false,
                  sort: "-createdAt",
                  user: context.user,
                  where: { site: { equals: siteId } },
                })
                .then(
                  (found) =>
                    ((found.docs[0] ?? null) as Record<string, unknown> | null)?.["createdAt"] ??
                    null,
                )
                .catch(() => null)
            : null,
        ])
        const tenantRecord = site["tenant"]
        return {
          articleCount,
          id: siteId,
          lastPublishedAt: typeof latestRelease === "string" ? latestRelease : null,
          locale: typeof site["locale"] === "string" ? site["locale"] : null,
          name:
            typeof site["name"] === "string" && site["name"].length > 0
              ? site["name"]
              : `站点 #${String(siteId)}`,
          status: typeof site["status"] === "string" ? site["status"] : null,
          tenantName:
            typeof tenantRecord === "object" &&
            tenantRecord !== null &&
            typeof (tenantRecord as Record<string, unknown>)["name"] === "string"
              ? String((tenantRecord as Record<string, unknown>)["name"])
              : null,
        }
      }),
    )
    return (
      <div className="grid gap-6 [&>*]:min-w-0">
        <PageHeader
          icon={NAV_ICON_BY_SLUG["sites"]}
          meta={
            <span className="rounded-full border border-[var(--console-border)] bg-[var(--console-surface)] px-3 py-1 text-xs font-semibold text-[var(--console-ink-muted)]">
              {result.totalDocs} 个站点
            </span>
          }
          title="站点列表"
        />
        <SitesWorkspace
          isSuperAdmin={context.session.role === CMS_ROLE.SUPER_ADMIN}
          page={result.page}
          rows={rows}
          totalPages={result.totalPages}
        />
      </div>
    )
  }

  const context = await requireConsolePayloadContext()
  const result = await findConsoleDocuments({ page, slug })
  const resource = CONSOLE_RESOURCES[slug]
  const columns = resource.defaultColumns
  const canCreate =
    resource.resource !== null && canConsole(context.session, resource.resource, CMS_ACTION.CREATE)
  const createSupported = [
    "contents",
    "content-editions",
    "domains",
    "sites",
    "tenants",
    "users",
  ].includes(slug)
  const canUploadMedia =
    slug === "media" &&
    resource.resource !== null &&
    canConsole(context.session, resource.resource, CMS_ACTION.CREATE)
  const canCreateRollbackIntent =
    slug === "rollback-intents" && context.session.role === CMS_ROLE.PUBLISHER

  return (
    <div className="gf-stagger grid gap-6 [&>*]:min-w-0">
      <PageHeader
        icon={NAV_ICON_BY_SLUG[slug]}
        actions={
          <>
            {canCreate &&
            slug === "users" &&
            (context.session.role === CMS_ROLE.SUPER_ADMIN ||
              context.session.role === CMS_ROLE.TENANT_ADMIN) ? (
              <ConsoleCreateDialog
                actorRole={
                  context.session.role === CMS_ROLE.SUPER_ADMIN
                    ? CMS_ROLE.SUPER_ADMIN
                    : CMS_ROLE.TENANT_ADMIN
                }
                createLabel="用户"
              />
            ) : canCreate && createSupported && slug !== "users" ? (
              <Button asChild size="sm" type="button">
                <Link href={`${consoleRoute.collection(slug as ConsoleResourceSlug)}/create`}>
                  新建{resource.label.zh}
                </Link>
              </Button>
            ) : null}
            {canUploadMedia && (
              <Button asChild size="sm" type="button">
                <Link href="/admin/collections/media/upload">上传媒体</Link>
              </Button>
            )}
            {canCreateRollbackIntent && (
              <Button asChild size="sm" type="button" variant="destructive">
                <Link href="/admin/collections/rollback-intents/create">创建回滚意图</Link>
              </Button>
            )}
          </>
        }
        meta={
          <span className="rounded-full border border-[var(--console-border)] bg-[var(--console-surface)] px-3 py-1 text-xs font-semibold text-[var(--console-ink-muted)]">
            {result.totalDocs} 条可见记录
          </span>
        }
        title={resource.label.zh}
      />

      {slug === "publication-plans" ? (
        <PublicationPlansWorkspace
          context={context}
          view={query.view === "week" ? "week" : "day"}
        />
      ) : (
        <section className="gf-console-card overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-[var(--console-border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="m-0 text-sm font-semibold text-[var(--console-ink)]">记录列表</h2>
              <p className="m-0 pt-1 text-xs text-[var(--console-ink-muted)]">
                此预览页已启用服务端权限范围读取；筛选、列偏好和写入功能将在下一批迁移中接入。
              </p>
            </div>
            <Button disabled size="md" type="button" variant="secondary">
              筛选即将接入
            </Button>
          </div>

          {result.docs.length === 0 ? (
            <div className="grid min-h-64 place-items-center px-5 text-center">
              <div className="grid max-w-sm gap-2">
                <strong className="text-sm text-[var(--console-ink)]">当前范围内没有记录</strong>
                <span className="text-sm leading-6 text-[var(--console-ink-muted)]">
                  这表示服务端在当前会话范围内没有返回数据，不代表其他租户或受限资源为空。
                </span>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left">
                <thead className="bg-[var(--console-surface-muted)]">
                  <tr>
                    {columns.map((column) => (
                      <th
                        className="whitespace-nowrap border-b border-[var(--console-border)] px-5 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--console-ink-muted)]"
                        key={column}
                        scope="col"
                      >
                        {columnLabel(column)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.docs.map((doc, index) => (
                    <tr
                      className="gf-row transition-colors hover:bg-[var(--console-surface-muted)]"
                      key={String(doc["id"] ?? index)}
                      style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
                    >
                      {columns.map((column) => (
                        <td
                          className="max-w-[280px] border-b border-[var(--console-border)] px-5 py-4 text-sm text-[var(--console-ink)]"
                          key={column}
                        >
                          {column === columns[0] &&
                          doc["id"] !== undefined &&
                          doc["id"] !== null ? (
                            <Link
                              className="gf-console-focus block truncate font-semibold text-[var(--console-ink)] no-underline hover:text-[var(--console-accent)]"
                              href={consoleRoute.document(
                                slug as ConsoleResourceSlug,
                                String(doc["id"]),
                              )}
                            >
                              {formatValue(
                                doc[column],
                                resource.relationshipColumns?.includes(column) ?? false,
                              )}
                            </Link>
                          ) : (
                            <span className="block truncate">
                              {formatValue(
                                doc[column],
                                resource.relationshipColumns?.includes(column) ?? false,
                              )}
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <footer className="flex items-center justify-between gap-3 px-5 py-4">
            <span className="text-xs text-[var(--console-ink-muted)]">
              第 {result.page} / {Math.max(result.totalPages, 1)} 页
            </span>
            <div className="flex gap-2">
              {result.page <= 1 ? (
                <Button disabled size="sm" type="button" variant="secondary">
                  上一页
                </Button>
              ) : (
                <Button asChild size="sm" type="button" variant="secondary">
                  <Link
                    href={`${consoleRoute.collection(slug as ConsoleResourceSlug)}?page=${result.page - 1}`}
                  >
                    上一页
                  </Link>
                </Button>
              )}
              {result.page >= result.totalPages ? (
                <Button disabled size="sm" type="button" variant="secondary">
                  下一页 <ChevronDownIcon size={13} />
                </Button>
              ) : (
                <Button asChild size="sm" type="button" variant="secondary">
                  <Link
                    href={`${consoleRoute.collection(slug as ConsoleResourceSlug)}?page=${result.page + 1}`}
                  >
                    下一页 <ChevronDownIcon size={13} />
                  </Link>
                </Button>
              )}
            </div>
          </footer>
        </section>
      )}
    </div>
  )
}

export default ConsoleCollectionPage
