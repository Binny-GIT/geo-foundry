import Link from "next/link"
import { notFound } from "next/navigation"

import { ChevronDownIcon } from "@/components/icons"
import { CMS_ACTION } from "@/access/policy"
import { CMS_ROLE } from "@/access/roles"
import {
  CONSOLE_RESOURCES,
  consoleRoute,
  isConsoleResourceSlug,
  type ConsoleResourceSlug,
} from "@/console/lib/resources"
import { findConsoleDocuments, requireConsolePayloadContext } from "@/console/lib/payload.server"
import { canConsole } from "@/console/lib/session.server"

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
  readonly searchParams: Promise<{ readonly page?: string }>
}

const ConsoleCollectionPage = async ({ params, searchParams }: CollectionPageProps) => {
  const { slug } = await params
  if (!isConsoleResourceSlug(slug)) notFound()
  const query = await searchParams
  const requestedPage = Number.parseInt(query.page ?? "1", 10)
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
  const [result, context] = await Promise.all([
    findConsoleDocuments({ page, slug }),
    requireConsolePayloadContext(),
  ])
  const resource = CONSOLE_RESOURCES[slug]
  const columns = resource.defaultColumns
  const canCreate =
    resource.resource !== null && canConsole(context.session, resource.resource, CMS_ACTION.CREATE)
  const createSupported = ["contents", "content-editions", "domains", "sites", "tenants", "users"].includes(slug)
  const canUploadMedia =
    slug === "media" &&
    resource.resource !== null &&
    canConsole(context.session, resource.resource, CMS_ACTION.CREATE)
  const canCreateRollbackIntent =
    slug === "rollback-intents" && context.session.role === CMS_ROLE.PUBLISHER

  return (
    <div className="grid gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-indigo-600">
            {resource.group}
          </p>
          <h1 className="m-0 pt-1 text-3xl font-semibold tracking-tight text-[var(--console-ink)]">
            {resource.label.zh}
          </h1>
          <p className="m-0 max-w-2xl pt-2 text-sm leading-6 text-[var(--console-ink-muted)]">
            {resource.subtitle.zh}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full border border-[var(--console-border)] bg-[var(--console-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--console-ink-muted)]">
            {result.totalDocs} 条可见记录
          </span>
          {canCreate && createSupported && (
            <Link
              className="gf-console-focus inline-flex h-10 items-center rounded-xl bg-[var(--console-accent)] px-3.5 text-sm font-semibold text-white no-underline transition-colors hover:bg-[var(--console-accent-hover)]"
              href={
                slug === "content-editions"
                  ? "/admin/editions/new"
                  : `${consoleRoute.collection(slug as ConsoleResourceSlug)}/create`
              }
            >
              新建{resource.label.zh}
            </Link>
          )}
          {canUploadMedia && (
            <Link
              className="gf-console-focus inline-flex h-10 items-center rounded-xl bg-[var(--console-accent)] px-3.5 text-sm font-semibold text-white no-underline transition-colors hover:bg-[var(--console-accent-hover)]"
              href="/admin/collections/media/upload"
            >
              上传媒体
            </Link>
          )}
          {canCreateRollbackIntent && (
            <Link
              className="gf-console-focus inline-flex h-10 items-center rounded-xl bg-rose-600 px-3.5 text-sm font-semibold text-white no-underline transition-colors hover:bg-rose-700"
              href="/admin/collections/rollback-intents/create"
            >
              创建回滚意图
            </Link>
          )}
        </div>
      </header>

      <section className="gf-console-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[var(--console-border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="m-0 text-sm font-semibold text-[var(--console-ink)]">记录列表</h2>
            <p className="m-0 pt-1 text-xs text-[var(--console-ink-muted)]">
              此预览页已启用服务端权限范围读取；筛选、列偏好和写入功能将在下一批迁移中接入。
            </p>
          </div>
          <button
            className="gf-console-focus h-10 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3 text-xs font-semibold text-[var(--console-ink-muted)]"
            disabled
            type="button"
          >
            筛选即将接入
          </button>
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
                    className="transition-colors hover:bg-indigo-50/45 dark:hover:bg-indigo-400/6"
                    key={String(doc["id"] ?? index)}
                  >
                    {columns.map((column) => (
                      <td
                        className="max-w-[280px] border-b border-[var(--console-border)] px-5 py-4 text-sm text-[var(--console-ink)]"
                        key={column}
                      >
                        {column === columns[0] && doc["id"] !== undefined && doc["id"] !== null ? (
                          <Link
                            className="gf-console-focus block truncate font-semibold text-indigo-700 no-underline hover:underline dark:text-indigo-300"
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
            <Link
              aria-disabled={result.page <= 1}
              className="gf-console-focus inline-flex h-9 items-center rounded-lg border border-[var(--console-border)] px-3 text-xs font-semibold text-[var(--console-ink)] no-underline aria-disabled:pointer-events-none aria-disabled:opacity-40"
              href={`${consoleRoute.collection(slug as ConsoleResourceSlug)}?page=${Math.max(result.page - 1, 1)}`}
            >
              上一页
            </Link>
            <Link
              aria-disabled={result.page >= result.totalPages}
              className="gf-console-focus inline-flex h-9 items-center gap-1 rounded-lg border border-[var(--console-border)] px-3 text-xs font-semibold text-[var(--console-ink)] no-underline aria-disabled:pointer-events-none aria-disabled:opacity-40"
              href={`${consoleRoute.collection(slug as ConsoleResourceSlug)}?page=${Math.min(result.page + 1, Math.max(result.totalPages, 1))}`}
            >
              下一页 <ChevronDownIcon size={13} />
            </Link>
          </div>
        </footer>
      </section>
    </div>
  )
}

export default ConsoleCollectionPage
