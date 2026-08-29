import Link from "next/link"
import { notFound } from "next/navigation"

import { CMS_ACTION } from "@/access/policy"
import { CMS_ROLE } from "@/access/roles"
import { ConsoleUrlRename } from "@/console/components/ConsoleUrlRename"
import {
  CONSOLE_RESOURCES,
  consoleRoute,
  isConsoleResourceSlug,
  isFirstWaveMutableResource,
  type ConsoleResourceSlug,
} from "@/console/lib/resources"
import { findConsoleDocument, requireConsolePayloadContext } from "@/console/lib/payload.server"
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

type ConsoleDocumentPageProps = {
  readonly params: Promise<{ readonly id: string; readonly slug: string }>
}

const ConsoleDocumentPage = async ({ params }: ConsoleDocumentPageProps) => {
  const { id, slug } = await params
  if (!isConsoleResourceSlug(slug)) notFound()

  const resource = CONSOLE_RESOURCES[slug]
  const [document, context] = await Promise.all([
    findConsoleDocument({ id, slug }),
    requireConsolePayloadContext(),
  ])
  const canEdit =
    resource.resource !== null &&
    (isFirstWaveMutableResource(slug) || slug === "users") &&
    canConsole(context.session, resource.resource, CMS_ACTION.UPDATE) &&
    (slug !== "users" ||
      context.session.role === CMS_ROLE.SUPER_ADMIN ||
      context.session.role === CMS_ROLE.TENANT_ADMIN)
  const canRenameUrl =
    slug === "url-records" &&
    (context.session.role === CMS_ROLE.EDITOR || context.session.role === CMS_ROLE.PUBLISHER)
  const columns = resource.defaultColumns
  const titleColumn = columns[0]
  if (titleColumn === undefined) notFound()
  const title = formatValue(
    document[titleColumn],
    resource.relationshipColumns?.includes(titleColumn) ?? false,
  )

  return (
    <div className="grid max-w-4xl gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link
            className="gf-console-focus text-sm font-semibold text-indigo-700 no-underline hover:underline dark:text-indigo-300"
            href={consoleRoute.collection(slug as ConsoleResourceSlug)}
          >
            ← 返回{resource.label.zh}
          </Link>
          <p className="m-0 pt-5 text-xs font-bold uppercase tracking-[0.12em] text-indigo-600">
            记录详情
          </p>
          <h1 className="m-0 max-w-3xl pt-1 break-words text-3xl font-semibold tracking-tight text-[var(--console-ink)]">
            {title}
          </h1>
          <p className="m-0 pt-2 text-sm leading-6 text-[var(--console-ink-muted)]">
            当前为安全只读详情视图，仅显示此资源在 Console registry 中允许展示的字段。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="w-fit rounded-full border border-[var(--console-border)] bg-[var(--console-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--console-ink-muted)]">
            记录 {id}
          </span>
          {slug === "content-editions" && (
            <Link
              className="gf-console-focus inline-flex h-10 items-center rounded-xl bg-[var(--console-accent)] px-3.5 text-sm font-semibold text-white no-underline transition-colors hover:bg-[var(--console-accent-hover)]"
              href={`/admin/workspace/editions/${encodeURIComponent(id)}`}
            >
              打开内容工作台
            </Link>
          )}
          {canEdit && (
            <Link
              className="gf-console-focus inline-flex h-10 items-center rounded-xl bg-[var(--console-accent)] px-3.5 text-sm font-semibold text-white no-underline transition-colors hover:bg-[var(--console-accent-hover)]"
              href={`${consoleRoute.document(slug as ConsoleResourceSlug, id)}/edit`}
            >
              编辑{resource.label.zh}
            </Link>
          )}
        </div>
      </header>

      <section className="gf-console-card overflow-hidden">
        <dl className="m-0 divide-y divide-[var(--console-border)]">
          {columns.map((column) => (
            <div className="grid gap-1 px-5 py-4 sm:grid-cols-[180px_1fr] sm:gap-6" key={column}>
              <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--console-ink-muted)]">
                {columnLabel(column)}
              </dt>
              <dd className="m-0 break-words text-sm leading-6 text-[var(--console-ink)]">
                {formatValue(
                  document[column],
                  resource.relationshipColumns?.includes(column) ?? false,
                )}
              </dd>
            </div>
          ))}
          <div className="grid gap-1 px-5 py-4 sm:grid-cols-[180px_1fr] sm:gap-6">
            <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--console-ink-muted)]">
              创建时间
            </dt>
            <dd className="m-0 text-sm leading-6 text-[var(--console-ink)]">
              {formatValue(document["createdAt"])}
            </dd>
          </div>
          <div className="grid gap-1 px-5 py-4 sm:grid-cols-[180px_1fr] sm:gap-6">
            <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--console-ink-muted)]">
              最近更新
            </dt>
            <dd className="m-0 text-sm leading-6 text-[var(--console-ink)]">
              {formatValue(document["updatedAt"])}
            </dd>
          </div>
        </dl>
      </section>

      {canRenameUrl && (
        <section className="gf-console-card grid gap-4 p-5 sm:p-6">
          <div>
            <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-indigo-600">
              受控操作
            </p>
            <h2 className="m-0 pt-1 text-lg font-semibold text-[var(--console-ink)]">重命名 URL</h2>
            <p className="m-0 pt-2 text-sm leading-6 text-[var(--console-ink-muted)]">
              不会使用通用 PATCH。服务端会验证租户、保留路径、唯一性及 URL 图谱约束。
            </p>
          </div>
          <ConsoleUrlRename
            id={id}
            initialLocale={typeof document["locale"] === "string" ? document["locale"] : "zh-CN"}
            initialPathname={typeof document["pathname"] === "string" ? document["pathname"] : "/"}
          />
        </section>
      )}

      <p className="m-0 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] p-4 text-sm leading-6 text-[var(--console-ink-muted)]">
        编辑、工作流、上传、版本恢复和账本操作会使用各资源的专项安全界面；不会在这里通过通用表单绕过服务端领域规则。
      </p>
    </div>
  )
}

export default ConsoleDocumentPage
