import Link from "next/link"
import { notFound } from "next/navigation"

import { CMS_ROLE } from "@/access/roles"
import { Button } from "@/components/ui/button"
import ArticleAssignmentPanel from "@/console/components/ArticleAssignmentPanel"
import ArticleBody from "@/console/components/ArticleBody"
import ArticleWorkflowPanel from "@/console/components/ArticleWorkflowPanel"
import DeferredText from "@/console/components/DeferredText"
import DuplicateArticleButton from "@/console/components/DuplicateArticleButton"
import { requireConsoleContext } from "@/console/lib/console-context.server"
import { consoleRoute } from "@/console/lib/resources"
import { loadArticleDetail } from "@/server/repositories/console-detail"

/* 六泳道呈现：generating 归入草稿、compiled 归入通过待发布（内部管线状态）。 */
const WORKFLOW_LABELS: Readonly<Record<string, string>> = {
  archived: "已删除",
  compiled: "通过待发布",
  draft: "草稿",
  generating: "草稿",
  published: "已发布",
  review: "待审核",
  approved: "通过待发布",
}

const AUDIT_LABELS: Readonly<Record<string, string>> = {
  "content-edition.draft.generating": "开始生成",
  "content-edition.draft.review": "提交审核",
  "content-edition.generating.review": "提交审核",
  "content-edition.review.draft": "审核不通过",
  "content-edition.review.approved": "审核通过",
  "content-edition.approved.compiled": "编译完成",
  "content-edition.compiled.published": "发布上线",
  "content-edition.published.archived": "删除",
  "content-edition.published.draft": "恢复为草稿",
  "content-edition.archived.draft": "恢复为草稿",
}

const CREATION_ORIGIN_LABELS: Readonly<Record<string, string>> = {
  ai: "AI 生成",
  hybrid: "人机协作",
  human: "人工创作",
}

const relationText = (value: unknown, field: string): string | null => {
  if (typeof value !== "object" || value === null) return null
  const text = (value as Record<string, unknown>)[field]
  return typeof text === "string" && text.length > 0 ? text : null
}

const relationIdOf = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  }
  if (typeof value === "object" && value !== null)
    return relationIdOf((value as Record<string, unknown>)["id"])
  return null
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
        timeZone: "Asia/Shanghai",
      }).format(date)
}

type TimelineEntry = {
  readonly actorEmail: string | null
  readonly actorId: number | null
  readonly at: string
  readonly detail: string | null
  readonly title: string
}

const ArticleDetail = async ({ id }: { readonly id: string }) => {
  const context = await requireConsoleContext()
  const { session } = context
  const numericId = Number.parseInt(id, 10)
  if (!Number.isSafeInteger(numericId) || numericId <= 0) notFound()

  const canEdit =
    session.role === CMS_ROLE.EDITOR ||
    session.role === CMS_ROLE.TENANT_ADMIN ||
    session.role === CMS_ROLE.SUPER_ADMIN
  const canAssign = canEdit

  const detail = await loadArticleDetail(context.db, context.scope, numericId, {
    assignmentOptions: canAssign,
  })
  if (detail === null) notFound()
  const { actorEmailById, comments, edition, hostname, pathname, siteOptions, userOptions } = detail

  const siteId = relationIdOf(edition["site"])
  const siteName = relationText(edition["site"], "name")
  const siteTimezone = relationText(edition["site"], "timezone")
  const tenantName = relationText(edition["tenant"], "name")
  const workflowStatus =
    typeof edition["workflowStatus"] === "string" ? edition["workflowStatus"] : ""
  const title =
    typeof edition["title"] === "string" && edition["title"].length > 0
      ? edition["title"]
      : "未命名稿件"
  const publicUrl = pathname !== null && hostname !== null ? `https://${hostname}${pathname}` : null

  const audit = Array.isArray(edition["auditLog"]) ? edition["auditLog"] : []
  const actorIdOfAudit = (entry: unknown): number | null => {
    if (typeof entry !== "object" || entry === null) return null
    const actor = (entry as Record<string, unknown>)["actor"]
    if (typeof actor !== "object" || actor === null) return null
    const actorRow = actor as Record<string, unknown>
    if (actorRow["kind"] !== "user") return null
    return relationIdOf(actorRow["userId"])
  }

  const ownerId = relationIdOf(edition["owner"])
  const assignedSiteIds: readonly number[] = Array.isArray(edition["sites"])
    ? (edition["sites"] as readonly unknown[]).flatMap((entry): number[] => {
        const id = relationIdOf(entry)
        return id === null ? [] : [id]
      })
    : typeof siteId === "number"
      ? [siteId]
      : []

  const actorEmailOf = (entry: { readonly actorId: number | null }): string | null =>
    entry.actorId === null ? null : (actorEmailById.get(entry.actorId) ?? null)

  const timeline: readonly TimelineEntry[] = [
    ...audit.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return []
      const row = entry as Record<string, unknown>
      const action = typeof row["action"] === "string" ? row["action"] : null
      const at = typeof row["at"] === "string" ? row["at"] : ""
      if (action === null || at.length === 0) return []
      const reason =
        typeof row["reason"] === "string" && row["reason"].length > 0 ? row["reason"] : null
      return [
        {
          actorEmail: null,
          actorId: actorIdOfAudit(entry),
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
      return [
        {
          actorEmail: null,
          actorId: relationIdOf(comment["author"]),
          at,
          detail: body.length > 0 ? body : null,
          title: "评审评论",
        },
      ]
    }),
  ]
    .map((entry) => ({ ...entry, actorEmail: actorEmailOf(entry) }))
    .sort((left, right) => (left.at < right.at ? 1 : -1))
  const latestActivity = timeline[0]
  const updatedByEmail = latestActivity === undefined ? null : latestActivity.actorEmail

  return (
    <div className="grid gap-6 [&>*]:min-w-0">
      <header className="grid gap-3">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <h1 className="m-0 max-w-3xl break-words text-2xl font-bold tracking-tight text-[var(--console-ink)]">
              {title}
            </h1>
            <div className="flex flex-wrap items-center gap-2 pt-2.5">
              <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
                {WORKFLOW_LABELS[workflowStatus] ?? workflowStatus}
              </span>
              {siteId !== null && (
                <Link
                  className="gf-console-focus rounded-full border border-[var(--console-border)] bg-[var(--console-surface)] px-3 py-1 text-xs font-semibold text-[var(--console-ink)] no-underline hover:text-[var(--console-accent)]"
                  href={consoleRoute.document("sites", String(siteId))}
                >
                  {siteName ?? `站点 #${String(siteId)}`}
                </Link>
              )}
              <span className="rounded-full border border-[var(--console-border)] bg-[var(--console-surface)] px-3 py-1 text-xs font-semibold text-[var(--console-ink-muted)]">
                创作方式：
                {typeof edition["creationOrigin"] === "string"
                  ? (CREATION_ORIGIN_LABELS[edition["creationOrigin"]] ?? edition["creationOrigin"])
                  : "—"}
              </span>
              {session.role === CMS_ROLE.SUPER_ADMIN && tenantName !== null && (
                <span className="rounded-full bg-[var(--console-surface-muted)] px-3 py-1 text-xs font-semibold text-[var(--console-ink-muted)]">
                  租户：{tenantName}
                </span>
              )}
              <span className="text-xs text-[var(--console-ink-muted)]">
                更新于 {formatInstant(edition["updatedAt"])}
                {updatedByEmail !== null && (
                  <>
                    {" · 更新人 "}
                    <DeferredText>{updatedByEmail}</DeferredText>
                  </>
                )}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {canEdit && (
              <Button asChild size="sm" type="button">
                <Link href={`/admin/workspace/editions/${numericId}`}>去编辑</Link>
              </Button>
            )}
            {canEdit && <DuplicateArticleButton editionId={numericId} />}
            {publicUrl !== null && (
              <Button asChild size="sm" type="button" variant="secondary">
                <a href={publicUrl} rel="noreferrer" target="_blank">
                  打开线上页面
                </a>
              </Button>
            )}
          </div>
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/*
         * self-start keeps the reading column at its content height: grid
         * cells stretch by default, so a tall operations rail used to inflate
         * these two cards into hundreds of pixels of empty space on short
         * articles. The summary card carries only the description text
         * (user direction: description only — no card heading, no chrome).
         */}
        <div className="grid min-w-0 gap-6 self-start">
          <section className="gf-console-card p-5 sm:p-6">
            <p className="m-0 text-sm leading-7 text-[var(--console-ink)]">
              {typeof edition["summary"] === "string" && edition["summary"].length > 0
                ? edition["summary"]
                : "暂无摘要；可在编辑页补充。"}
            </p>
          </section>

          <section className="gf-console-card grid gap-5 p-5 sm:p-6">
            <h2 className="m-0 text-base font-semibold tracking-tight text-[var(--console-ink)]">
              正文
            </h2>
            <ArticleBody body={edition["body"]} />
          </section>
        </div>

        <div className="grid content-start gap-6">
          <ArticleWorkflowPanel
            editionId={numericId}
            role={session.role}
            siteTimezone={siteTimezone}
            title={title}
            workflowStatus={workflowStatus}
          />

          <ArticleAssignmentPanel
            canAssign={canAssign}
            editionId={numericId}
            owner={ownerId === null ? "" : String(ownerId)}
            siteIds={assignedSiteIds}
            sites={siteOptions}
            users={userOptions}
          />

          <section className="gf-console-card grid gap-3 p-5">
            <h2 className="m-0 text-base font-semibold tracking-tight text-[var(--console-ink)]">
              站点文章入口
            </h2>
            {publicUrl === null ? (
              <p className="m-0 text-sm leading-6 text-[var(--console-ink-muted)]">
                该文章尚未发布或缺少生效的站点 URL；发布后这里会显示线上入口。
              </p>
            ) : (
              <a
                className="gf-console-focus break-all text-sm font-semibold text-[var(--console-ink)] no-underline hover:text-[var(--console-accent)]"
                href={publicUrl}
                rel="noreferrer"
                target="_blank"
              >
                {publicUrl}
              </a>
            )}
            {siteId !== null && (
              <Button
                asChild
                className="gf-console-focus"
                size="sm"
                type="button"
                variant="secondary"
              >
                <Link href={consoleRoute.document("sites", String(siteId))}>
                  查看站点发布历史与恢复 →
                </Link>
              </Button>
            )}
          </section>

          <section className="gf-console-card grid gap-4 p-5">
            <h2 className="m-0 text-base font-semibold tracking-tight text-[var(--console-ink)]">
              历史日志
            </h2>
            {timeline.length === 0 ? (
              <p className="m-0 text-sm text-[var(--console-ink-muted)]">暂无历史事件。</p>
            ) : (
              <ol className="m-0 grid min-w-0 list-none gap-0 p-0">
                {timeline.map((entry, index) => (
                  <li
                    className="grid gap-1 border-l-2 border-[var(--console-border)] py-2.5 pl-4"
                    key={`${entry.at}-${index}`}
                  >
                    <span className="text-xs text-[var(--console-ink-muted)]">
                      {formatInstant(entry.at)}
                    </span>
                    <span className="text-sm font-semibold text-[var(--console-ink)]">
                      {entry.title}
                    </span>
                    {entry.actorEmail !== null && (
                      <span className="text-xs text-[var(--console-ink-muted)]">
                        操作人：<DeferredText>{entry.actorEmail}</DeferredText>
                      </span>
                    )}
                    {entry.detail !== null && (
                      <span className="text-sm leading-6 text-[var(--console-ink-muted)]">
                        {entry.detail}
                      </span>
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
