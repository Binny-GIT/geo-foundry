import Link from "next/link"
import { notFound } from "next/navigation"

import { CMS_ROLE } from "@/access/roles"
import ArticleBody from "@/console/components/ArticleBody"
import { consoleRoute } from "@/console/lib/resources"
import { requireConsolePayloadContext } from "@/console/lib/payload.server"

const WORKFLOW_LABELS: Readonly<Record<string, string>> = {
  archived: "已删除",
  compiled: "已编译",
  draft: "草稿",
  generating: "生成中",
  published: "已发布",
  review: "待审核",
  approved: "已通过",
}

const AUDIT_LABELS: Readonly<Record<string, string>> = {
  "content-edition.draft.generating": "开始生成",
  "content-edition.generating.review": "提交审核",
  "content-edition.review.draft": "退回修改",
  "content-edition.review.approved": "审核通过",
  "content-edition.approved.compiled": "编译完成",
  "content-edition.compiled.published": "发布上线",
  "content-edition.published.archived": "归档下线",
}

const relationText = (value: unknown, field: string): string | null => {
  if (typeof value !== "object" || value === null) return null
  const text = (value as Record<string, unknown>)[field]
  return typeof text === "string" && text.length > 0 ? text : null
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

type TimelineEntry = {
  readonly at: string
  readonly detail: string | null
  readonly title: string
}

const ArticleDetail = async ({ id }: { readonly id: string }) => {
  const context = await requireConsolePayloadContext()
  const { payload, session, user } = context
  const numericId = Number.parseInt(id, 10)
  if (!Number.isSafeInteger(numericId) || numericId <= 0) notFound()

  let edition: Record<string, unknown>
  try {
    edition = (await payload.findByID({
      collection: "content-editions",
      depth: 1,
      draft: true,
      id: numericId,
      overrideAccess: false,
      user,
    })) as unknown as Record<string, unknown>
  } catch {
    notFound()
  }

  const siteId = typeof edition["site"] === "object" && edition["site"] !== null
    ? (edition["site"] as Record<string, unknown>)["id"]
    : null
  const contentId =
    typeof edition["content"] === "object" && edition["content"] !== null
      ? (edition["content"] as Record<string, unknown>)["id"]
      : edition["content"]
  const siteName = relationText(edition["site"], "name")
  const siteTimezone = relationText(edition["site"], "timezone")
  const tenantName = relationText(edition["tenant"], "name")
  const ownerEmail = relationText(edition["owner"], "email")
  const workflowStatus = typeof edition["workflowStatus"] === "string" ? edition["workflowStatus"] : ""
  const title = typeof edition["title"] === "string" && edition["title"].length > 0 ? edition["title"] : "未命名稿件"

  const [urlRecord, domain, comments] = await Promise.all([
    payload
      .find({
        collection: "url-records",
        depth: 0,
        limit: 1,
        overrideAccess: false,
        user,
        where: {
          and: [
            { content: { equals: contentId } },
            { state: { equals: "active" } },
          ],
        },
      })
      .then((result) => (result.docs[0] ?? null) as Record<string, unknown> | null)
      .catch(() => null),
    siteId === null
      ? Promise.resolve(null)
      : payload
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
          .catch(() => null),
    payload
      .find({
        collection: "review-comments",
        depth: 1,
        limit: 50,
        overrideAccess: false,
        sort: "-createdAt",
        user,
        where: { edition: { equals: numericId } },
      })
      .then((result) => result.docs as unknown as readonly Record<string, unknown>[])
      .catch(() => [] as readonly Record<string, unknown>[]),
  ])

  const pathname = urlRecord === null ? null : typeof urlRecord["pathname"] === "string" ? urlRecord["pathname"] : null
  const hostname = domain === null ? null : typeof domain["hostname"] === "string" ? domain["hostname"] : null
  const publicUrl = pathname !== null && hostname !== null ? `https://${hostname}${pathname}` : null

  const audit = Array.isArray(edition["auditLog"]) ? edition["auditLog"] : []
  const timeline: readonly TimelineEntry[] = [
    ...audit.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return []
      const row = entry as Record<string, unknown>
      const action = typeof row["action"] === "string" ? row["action"] : null
      const at = typeof row["at"] === "string" ? row["at"] : ""
      if (action === null || at.length === 0) return []
      const reason = typeof row["reason"] === "string" && row["reason"].length > 0 ? row["reason"] : null
      return [
        {
          at,
          detail: reason,
          title: AUDIT_LABELS[action] ?? action,
        },
      ]
    }),
    ...comments.flatMap((comment) => {
      const at = typeof comment["createdAt"] === "string" ? comment["createdAt"] : ""
      const body = typeof comment["body"] === "string" ? comment["body"] : ""
      if (at.length === 0) return []
      return [{ at, detail: body.length > 0 ? body : null, title: "评审评论" }]
    }),
  ].sort((left, right) => (left.at < right.at ? 1 : -1))

  const canEdit =
    session.role === CMS_ROLE.EDITOR ||
    session.role === CMS_ROLE.TENANT_ADMIN ||
    session.role === CMS_ROLE.SUPER_ADMIN

  return (
    <div className="grid gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Link
            className="gf-console-focus text-sm font-semibold text-indigo-700 no-underline hover:underline"
            href={consoleRoute.collection("content-editions")}
          >
            ← 返回文章列表
          </Link>
          <p className="m-0 pt-5 text-xs font-bold uppercase tracking-[0.12em] text-indigo-600">文章详情</p>
          <h1 className="m-0 max-w-3xl break-words pt-1 text-3xl font-semibold tracking-tight text-[var(--console-ink)]">
            {title}
          </h1>
          <div className="flex flex-wrap items-center gap-2 pt-3">
            <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
              {WORKFLOW_LABELS[workflowStatus] ?? workflowStatus}
            </span>
            {session.role === CMS_ROLE.SUPER_ADMIN && tenantName !== null && (
              <span className="rounded-full bg-[var(--console-surface-muted)] px-3 py-1 text-xs font-semibold text-[var(--console-ink-muted)]">
                租户：{tenantName}
              </span>
            )}
            <span className="text-xs text-[var(--console-ink-muted)]">
              更新于 {formatInstant(edition["updatedAt"])}（UTC）
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canEdit && (
            <Link
              className="gf-console-focus inline-flex h-10 items-center rounded-xl bg-[var(--console-accent)] px-3.5 text-sm font-semibold text-white no-underline hover:bg-[var(--console-accent-hover)]"
              href={`/admin/workspace/editions/${numericId}`}
            >
              去编辑
            </Link>
          )}
          {publicUrl !== null && (
            <a
              className="gf-console-focus inline-flex h-10 items-center rounded-xl border border-[var(--console-border)] bg-[var(--console-surface)] px-3.5 text-sm font-semibold text-[var(--console-ink)] no-underline hover:bg-[var(--console-surface-muted)]"
              href={publicUrl}
              rel="noreferrer"
              target="_blank"
            >
              打开线上页面
            </a>
          )}
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 gap-6">
          <section className="gf-console-card grid gap-4 p-5 sm:p-6">
            <h2 className="m-0 text-base font-semibold tracking-tight text-[var(--console-ink)]">基础信息</h2>
            <dl className="m-0 grid gap-4 border-t border-[var(--console-border)] pt-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--console-ink-muted)]">摘要</dt>
                <dd className="m-0 pt-1 text-sm leading-6 text-[var(--console-ink)]">
                  {typeof edition["summary"] === "string" && edition["summary"].length > 0
                    ? edition["summary"]
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--console-ink-muted)]">负责人</dt>
                <dd className="m-0 pt-1 text-sm text-[var(--console-ink)]">{ownerEmail ?? "未分配"}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--console-ink-muted)]">所属站点</dt>
                <dd className="m-0 pt-1 text-sm text-[var(--console-ink)]">
                  {siteId === null ? (
                    "受限站点"
                  ) : (
                    <Link
                      className="font-semibold text-indigo-700 no-underline hover:underline"
                      href={consoleRoute.document("sites", String(siteId))}
                    >
                      {siteName ?? `站点 #${String(siteId)}`}
                    </Link>
                  )}
                  {siteTimezone !== null && (
                    <span className="pl-2 text-xs text-[var(--console-ink-muted)]">{siteTimezone}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--console-ink-muted)]">来源</dt>
                <dd className="m-0 pt-1 text-sm text-[var(--console-ink)]">
                  {typeof edition["creationOrigin"] === "string" ? edition["creationOrigin"] : "—"}
                </dd>
              </div>
            </dl>
          </section>

          <section className="gf-console-card grid gap-5 p-5 sm:p-6">
            <h2 className="m-0 text-base font-semibold tracking-tight text-[var(--console-ink)]">正文</h2>
            <ArticleBody body={edition["body"]} />
          </section>
        </div>

        <div className="grid content-start gap-6">
          <section className="gf-console-card grid gap-3 p-5">
            <h2 className="m-0 text-base font-semibold tracking-tight text-[var(--console-ink)]">站点文章入口</h2>
            {publicUrl === null ? (
              <p className="m-0 text-sm leading-6 text-[var(--console-ink-muted)]">
                该文章尚未发布或缺少生效的站点 URL；发布后这里会显示线上入口。
              </p>
            ) : (
              <a
                className="gf-console-focus break-all text-sm font-semibold text-indigo-700 no-underline hover:underline"
                href={publicUrl}
                rel="noreferrer"
                target="_blank"
              >
                {publicUrl}
              </a>
            )}
            {siteId !== null && (
              <Link
                className="gf-console-focus text-sm font-semibold text-[var(--console-ink)] no-underline hover:text-indigo-600"
                href={consoleRoute.document("sites", String(siteId))}
              >
                查看站点发布历史与恢复 →
              </Link>
            )}
          </section>

          <section className="gf-console-card grid gap-3 p-5">
            <h2 className="m-0 text-base font-semibold tracking-tight text-[var(--console-ink)]">阅读分析</h2>
            <p className="m-0 text-sm leading-6 text-[var(--console-ink-muted)]">
              流量统计数据接入后，这里将展示今日阅读、近 30 天趋势与访问地区排行。
            </p>
          </section>

          <section className="gf-console-card grid gap-4 p-5">
            <h2 className="m-0 text-base font-semibold tracking-tight text-[var(--console-ink)]">
              历史日志
            </h2>
            {timeline.length === 0 ? (
              <p className="m-0 text-sm text-[var(--console-ink-muted)]">暂无历史事件。</p>
            ) : (
              <ol className="m-0 grid list-none gap-0 p-0">
                {timeline.map((entry, index) => (
                  <li className="grid gap-1 border-l-2 border-[var(--console-border)] py-2.5 pl-4" key={`${entry.at}-${index}`}>
                    <span className="text-xs text-[var(--console-ink-muted)]">
                      {formatInstant(entry.at)}（UTC）
                    </span>
                    <span className="text-sm font-semibold text-[var(--console-ink)]">{entry.title}</span>
                    {entry.detail !== null && (
                      <span className="text-sm leading-6 text-[var(--console-ink-muted)]">{entry.detail}</span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

export default ArticleDetail
