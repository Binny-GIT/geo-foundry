import Link from "next/link"
import { notFound } from "next/navigation"

import { CMS_ACTION, CMS_RESOURCE } from "@/access/policy"
import { CMS_ROLE } from "@/access/roles"
import { ArrowLeftIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"
import ArticleAssignmentPanel from "@/console/components/ArticleAssignmentPanel"
import ArticleBody from "@/console/components/ArticleBody"
import ArticleWorkflowPanel from "@/console/components/ArticleWorkflowPanel"
import { RankedBars, TrendBars, type TrendPoint } from "@/console/components/charts"
import DeferredText from "@/console/components/DeferredText"
import { requireConsolePayloadContext } from "@/console/lib/payload.server"
import { consoleRoute } from "@/console/lib/resources"
import { canConsole } from "@/console/lib/session.server"

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
  "content-edition.review.draft": "审核不通过",
  "content-edition.review.approved": "审核通过",
  "content-edition.approved.compiled": "编译完成",
  "content-edition.compiled.published": "发布上线",
  "content-edition.published.archived": "归档下线",
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

  const siteId =
    typeof edition["site"] === "object" && edition["site"] !== null
      ? (edition["site"] as Record<string, unknown>)["id"]
      : null
  const contentId =
    typeof edition["content"] === "object" && edition["content"] !== null
      ? (edition["content"] as Record<string, unknown>)["id"]
      : edition["content"]
  const siteName = relationText(edition["site"], "name")
  const siteTimezone = relationText(edition["site"], "timezone")
  const tenantName = relationText(edition["tenant"], "name")
  const workflowStatus =
    typeof edition["workflowStatus"] === "string" ? edition["workflowStatus"] : ""
  const title =
    typeof edition["title"] === "string" && edition["title"].length > 0
      ? edition["title"]
      : "未命名稿件"

  const [urlRecord, domain, comments, snapshots] = await Promise.all([
    payload
      .find({
        collection: "url-records",
        depth: 0,
        limit: 1,
        overrideAccess: false,
        user,
        where: {
          and: [{ content: { equals: contentId } }, { state: { equals: "active" } }],
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
        depth: 0,
        limit: 50,
        overrideAccess: false,
        sort: "-createdAt",
        user,
        where: { edition: { equals: numericId } },
      })
      .then((result) => result.docs as unknown as readonly Record<string, unknown>[])
      .catch(() => [] as readonly Record<string, unknown>[]),
    canConsole(session, CMS_RESOURCE.PERFORMANCE_SNAPSHOTS, CMS_ACTION.READ)
      ? payload
          .find({
            collection: "performance-snapshots",
            depth: 0,
            limit: 500,
            overrideAccess: false,
            select: { city: true, observedAt: true, visits: true },
            sort: "-observedAt",
            user,
            where: { edition: { equals: numericId } },
          })
          .then((result) => result.docs as unknown as readonly Record<string, unknown>[])
          .catch(() => [] as readonly Record<string, unknown>[])
      : null,
  ])

  const pathname =
    urlRecord === null
      ? null
      : typeof urlRecord["pathname"] === "string"
        ? urlRecord["pathname"]
        : null
  const hostname =
    domain === null ? null : typeof domain["hostname"] === "string" ? domain["hostname"] : null
  const publicUrl = pathname !== null && hostname !== null ? `https://${hostname}${pathname}` : null

  const audit = Array.isArray(edition["auditLog"]) ? edition["auditLog"] : []
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

  const canAssign = canEdit
  const siteLocked = !["draft", "generating", "review", "approved"].includes(workflowStatus)
  const ownerId = relationIdOf(edition["owner"])
  const editionTenantId = relationIdOf(edition["tenant"])

  const [userOptions, siteOptions, coveredSiteIds, updatedByEmail] = await Promise.all([
    canAssign && editionTenantId !== null
      ? payload
          .find({
            collection: "users",
            depth: 0,
            limit: 100,
            overrideAccess: true,
            select: { email: true },
            sort: "email",
            where: {
              and: [
                { tenant: { equals: editionTenantId } },
                { role: { not_equals: "content-service" } },
              ],
            },
          })
          .then((result) =>
            result.docs.flatMap((doc) => {
              const userId = relationIdOf(doc.id)
              if (userId === null) return []
              return [
                {
                  id: userId,
                  label:
                    typeof doc.email === "string" && doc.email.length > 0
                      ? doc.email
                      : `用户 #${String(userId)}`,
                },
              ]
            }),
          )
          .catch(() => [] as readonly { readonly id: number; readonly label: string }[])
      : Promise.resolve([] as readonly { readonly id: number; readonly label: string }[]),
    editionTenantId !== null
      ? payload
          .find({
            collection: "sites",
            depth: 0,
            limit: 100,
            overrideAccess: false,
            select: { name: true },
            sort: "name",
            user,
            where: { tenant: { equals: editionTenantId } },
          })
          .then((result) =>
            result.docs.flatMap((doc) => {
              const siteOptionId = relationIdOf(doc.id)
              if (siteOptionId === null) return []
              return [
                {
                  id: siteOptionId,
                  label: relationText(doc, "name") ?? `站点 #${String(siteOptionId)}`,
                },
              ]
            }),
          )
          .catch(() => [] as readonly { readonly id: number; readonly label: string }[])
      : Promise.resolve([] as readonly { readonly id: number; readonly label: string }[]),
    payload
      .find({
        collection: "content-editions",
        depth: 0,
        limit: 100,
        overrideAccess: false,
        select: { site: true },
        user,
        where: { content: { equals: contentId } },
      })
      .then((result) =>
        result.docs.flatMap((doc) => {
          const editionSiteId = relationIdOf(doc.site)
          return editionSiteId === null ? [] : [editionSiteId]
        }),
      )
      .catch(() => [] as readonly number[]),
    /*
     * 更新人：审计与评审评论里最近一位真实用户。审计 actor 由工作流服务
     * 串行写入，评论按 createdAt 倒序，两者按时间取最新。
     */
    (async (): Promise<string | null> => {
      const activities: readonly { readonly at: string; readonly userId: number }[] = [
        ...audit.flatMap((entry) => {
          if (typeof entry !== "object" || entry === null) return []
          const row = entry as Record<string, unknown>
          const actor = row["actor"]
          if (typeof actor !== "object" || actor === null) return []
          const actorRow = actor as Record<string, unknown>
          if (actorRow["kind"] !== "user") return []
          const actorUserId = relationIdOf(actorRow["userId"])
          const at = typeof row["at"] === "string" ? row["at"] : ""
          return actorUserId === null || at.length === 0 ? [] : [{ at, userId: actorUserId }]
        }),
        ...comments.flatMap((comment) => {
          const authorId = relationIdOf(comment["author"])
          const at = typeof comment["createdAt"] === "string" ? comment["createdAt"] : ""
          return authorId === null || at.length === 0 ? [] : [{ at, userId: authorId }]
        }),
      ].sort((left, right) => (left.at < right.at ? 1 : -1))
      const latest = activities[0]
      if (latest === undefined) return null
      const actorDoc = await payload
        .find({
          collection: "users",
          depth: 0,
          limit: 1,
          overrideAccess: true,
          select: { email: true },
          where: { id: { equals: latest.userId } },
        })
        .then((result) => result.docs[0] ?? null)
        .catch(() => null)
      return actorDoc !== null && typeof actorDoc.email === "string" ? actorDoc.email : null
    })(),
  ])

  const todayKey = new Date().toISOString().slice(0, 10)
  const readingDays = new Map<string, number>()
  const readingCities = new Map<string, number>()
  let todayVisits = 0
  let totalVisits = 0
  for (let offset = 29; offset >= 0; offset -= 1) {
    readingDays.set(new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10), 0)
  }
  for (const snapshot of snapshots ?? []) {
    const visits = typeof snapshot["visits"] === "number" ? snapshot["visits"] : 0
    const observedAt = typeof snapshot["observedAt"] === "string" ? snapshot["observedAt"] : null
    totalVisits += visits
    if (observedAt !== null) {
      const day = observedAt.slice(0, 10)
      if (day === todayKey) todayVisits += visits
      if (readingDays.has(day)) readingDays.set(day, (readingDays.get(day) ?? 0) + visits)
    }
    const city =
      typeof snapshot["city"] === "string" && snapshot["city"].length > 0 ? snapshot["city"] : null
    if (city !== null) readingCities.set(city, (readingCities.get(city) ?? 0) + visits)
  }
  const readingTrend: readonly TrendPoint[] = [...readingDays.entries()].map(([date, value]) => ({
    date,
    value,
  }))
  const cityItems = [...readingCities.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 6)

  return (
    <div className="grid gap-6 [&>*]:min-w-0">
      <header className="grid gap-3">
        <Button
          asChild
          className="gf-console-focus w-fit"
          size="sm"
          type="button"
          variant="secondary"
        >
          <Link
            className="flex items-center gap-1.5"
            href={consoleRoute.collection("content-editions")}
          >
            <ArrowLeftIcon size={15} />
            返回文章列表
          </Link>
        </Button>
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
            workflowRevision={
              typeof edition["workflowRevision"] === "number" ? edition["workflowRevision"] : 0
            }
            workflowStatus={workflowStatus}
          />

          <ArticleAssignmentPanel
            canAssign={canAssign}
            coveredSiteIds={coveredSiteIds}
            editionId={numericId}
            owner={ownerId === null ? "" : String(ownerId)}
            site={siteId === null ? "" : String(siteId)}
            siteLocked={siteLocked}
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="m-0 text-base font-semibold tracking-tight text-[var(--console-ink)]">
                阅读分析
              </h2>
              <span className="text-xs font-semibold text-[var(--console-ink-muted)]">
                今日 {todayVisits} · 累计 {totalVisits}
              </span>
            </div>
            {snapshots === null ? (
              <p className="m-0 text-sm leading-6 text-[var(--console-ink-muted)]">
                当前角色无权读取流量统计。
              </p>
            ) : totalVisits === 0 ? (
              <p className="m-0 text-sm leading-6 text-[var(--console-ink-muted)]">
                暂无流量统计数据；由站点或 n8n 上报后，这里将展示今日阅读、近 30
                天趋势与访问城市排行。
              </p>
            ) : (
              <>
                <TrendBars color="#f59e0b" data={readingTrend} emptyLabel="近 30 天暂无阅读" />
                {cityItems.length > 0 && (
                  <div className="grid gap-2 border-t border-[var(--console-border)] pt-3">
                    <p className="m-0 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--console-ink-muted)]">
                      访问城市排行
                    </p>
                    <RankedBars color="#f59e0b" items={cityItems} />
                  </div>
                )}
              </>
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
