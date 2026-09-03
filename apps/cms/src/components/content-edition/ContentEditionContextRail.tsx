"use client"

import { toast, useAuth, useDocumentInfo, useFormFields, useTranslation } from "@payloadcms/ui"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { uiLangOf } from "../i18n/ui-lang"
import { CopyIcon, GlobeIcon, LinkIcon, MessageSquareIcon, PlusIcon, UsersIcon } from "@/components/icons"
import { IconBadge } from "../ui"
import { Button } from "../ui/button"
import { ContentEditionRail, type VersionSelection } from "./ContentEditionRail"

type WorkspaceVariant = Readonly<{
  body: readonly unknown[]
  id: number | null
  site: Readonly<{ id: number | null; name: string | null }>
  summary: string | null
  title: string | null
  updatedAt: string | null
  workflowStatus: string | null
}>

type WorkspaceContext = Readonly<{
  assignees: readonly Readonly<{ email: string | null; id: number | null; role: string | null }>[]
  comments: readonly Readonly<{
    author: Readonly<{ email: string | null; id: number | null }>
    body: string | null
    createdAt: string | null
    id: number | null
    kind: string | null
    workflowRevision: number | null
  }>[]
  quality: Readonly<{
    createdAt: string | null
    inputHash: string | null
    issues: readonly unknown[]
    overall: number | null
    state: string | null
  }> | null
  sources: readonly Readonly<{
    id: number | null
    note: string | null
    role: string | null
    intakeItem: Readonly<{
      id: number | null
      sourceUrl: string | null
      status: string | null
      title: string | null
    }>
  }>[]
  variants: readonly WorkspaceVariant[]
}>

const EMPTY: WorkspaceContext = {
  assignees: [],
  comments: [],
  quality: null,
  sources: [],
  variants: [],
}

const COPY = {
  en: {
    addComment: "Add comment",
    addSource: "Add source",
    comment: "Comment",
    commentPlaceholder: "Add editorial feedback for this version…",
    comments: "Review comments",
    compare: "Compare with this version",
    history: "Version history",
    intakeId: "Intake item ID",
    loading: "Loading workspace context…",
    noComments: "No review comments yet.",
    noSources: "No linked sources yet.",
    noVariants: "No other site version of this content yet.",
    open: "Open workspace",
    sourceRole: "Source role",
    sources: "Sources",
    summary: "Summary",
    supporting: "Supporting",
    primary: "Primary",
    thisVersion: "This version",
    title: "Title",
    variants: "Site variants",
  },
  zh: {
    addComment: "添加评论",
    addSource: "关联来源",
    comment: "评论",
    commentPlaceholder: "为当前版本添加编辑意见…",
    comments: "审核评论",
    compare: "与当前版本对比",
    history: "版本历史",
    intakeId: "稿源条目 ID",
    loading: "正在加载工作台上下文…",
    noComments: "暂时没有审核评论。",
    noSources: "暂时没有关联来源。",
    noVariants: "该内容还没有其他站点版本。",
    open: "打开工作台",
    sourceRole: "来源角色",
    sources: "来源",
    summary: "摘要",
    supporting: "辅助来源",
    primary: "主要来源",
    thisVersion: "当前版本",
    title: "标题",
    variants: "站点版本",
  },
} as const

const blockTextOf = (block: unknown): string => {
  if (typeof block !== "object" || block === null) return "—"
  const row = block as Record<string, unknown>
  if (typeof row["text"] === "string" && row["text"].length > 0) return row["text"]
  if (Array.isArray(row["items"])) {
    const joined = row["items"]
      .map(blockTextOf)
      .filter((part) => part !== "—")
      .join(" · ")
    if (joined.length > 0) return joined
  }
  if (typeof row["question"] === "string" && row["question"].length > 0) return row["question"]
  return typeof row["blockType"] === "string" ? `[${row["blockType"]}]` : "—"
}

const dateOf = (value: string | null, language: string): string => {
  if (value === null) return "—"
  const date = new Date(value)
  // Fixed UTC keeps server and client renders identical; a local-timezone
  // render would differ during hydration (React error #418).
  return Number.isNaN(date.valueOf())
    ? "—"
    : date.toLocaleString(language === "zh" ? "zh-CN" : "en-US", { timeZone: "UTC" })
}

export const ContentEditionContextRail = ({
  onSelectVersion,
  selectedVersion,
}: {
  readonly onSelectVersion: (version: VersionSelection) => void
  readonly selectedVersion: VersionSelection
}) => {
  const { id } = useDocumentInfo()
  const { user } = useAuth()
  const router = useRouter()
  const { i18n } = useTranslation()
  const lang = uiLangOf(i18n.language)
  const t = COPY[lang]
  const workflowRevision = useFormFields(([fields]) => fields["workflowRevision"]?.value)
  const currentTitle = useFormFields(([fields]) => fields["title"]?.value)
  const currentSummary = useFormFields(([fields]) => fields["summary"]?.value)
  const currentBody = useFormFields(([fields]) => fields["body"]?.value)
  const [context, setContext] = useState<WorkspaceContext>(EMPTY)
  const [loading, setLoading] = useState(false)
  const [intakeItemId, setIntakeItemId] = useState("")
  const [sourceRole, setSourceRole] = useState<"primary" | "supporting">("supporting")
  const [comment, setComment] = useState("")

  const reload = () => {
    if (id === undefined || id === null) return
    setLoading(true)
    void fetch(`/api/workspaces/editions/${id}/context`, {
      credentials: "same-origin",
      headers: { "x-request-id": crypto.randomUUID() },
    })
      .then(async (response) =>
        response.ok ? ((await response.json()) as WorkspaceContext) : EMPTY,
      )
      .then(setContext)
      .catch(() => setContext(EMPTY))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    reload()
  }, [id])

  const addSource = async () => {
    if (id === undefined || id === null || !/^\d+$/.test(intakeItemId.trim())) return
    const response = await fetch(`/api/editions/${id}/article-sources`, {
      body: JSON.stringify({ intakeItemId: Number(intakeItemId), role: sourceRole }),
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "POST",
    })
    if (!response.ok) {
      toast.error(lang === "zh" ? "关联来源失败。" : "Could not link source.")
      return
    }
    setIntakeItemId("")
    reload()
  }

  const addComment = async () => {
    if (id === undefined || id === null || comment.trim().length === 0) return
    const response = await fetch(`/api/editions/${id}/review-comments`, {
      body: JSON.stringify({
        body: comment.trim(),
        ...(typeof workflowRevision === "number" ? { workflowRevision } : {}),
      }),
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "POST",
    })
    if (!response.ok) {
      toast.error(lang === "zh" ? "添加评论失败。" : "Could not add comment.")
      return
    }
    setComment("")
    reload()
  }

  const canEditSources = user?.["role"] === "editor" || user?.["role"] === "tenant-admin"
  const canComment =
    user?.["role"] === "editor" ||
    user?.["role"] === "reviewer" ||
    user?.["role"] === "tenant-admin"

  return (
    <aside
      aria-label={lang === "zh" ? "来源、评论和版本历史" : "Sources, comments, and version history"}
      className="grid min-w-0 content-start gap-4"
    >
      <section className="rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] p-4 shadow-[var(--gf-shadow-surface)]">
        <div className="flex items-center gap-3">
          <IconBadge tone="accent">
            <LinkIcon size={18} />
          </IconBadge>
          <div>
            <p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">
              {t.sources}
            </p>
            <strong className="mt-1 block text-sm text-[var(--theme-text)]">
              {context.sources.length}
            </strong>
          </div>
        </div>
        {loading ? (
          <p className="m-0 mt-4 text-sm text-[var(--theme-elevation-600)]">{t.loading}</p>
        ) : context.sources.length === 0 ? (
          <p className="m-0 mt-4 text-sm text-[var(--theme-elevation-600)]">{t.noSources}</p>
        ) : (
          <ul className="m-0 mt-4 grid list-none gap-3 p-0">
            {context.sources.map((source, index) => (
              <li
                className="rounded-xl border border-[var(--theme-elevation-150)] bg-[var(--theme-elevation-50)] p-3"
                key={source.id ?? index}
              >
                <p className="m-0 text-xs font-bold uppercase tracking-[0.06em] text-[var(--gf-accent-700)]">
                  {source.role ?? "supporting"}
                </p>
                <strong className="mt-1 block text-sm text-[var(--theme-text)]">
                  {source.intakeItem.title ?? "—"}
                </strong>
                {source.intakeItem.sourceUrl !== null && (
                  <a
                    className="mt-1 block truncate text-xs font-semibold text-[var(--gf-accent-700)] hover:text-[var(--gf-accent-400)]"
                    href={source.intakeItem.sourceUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {source.intakeItem.sourceUrl}
                  </a>
                )}
                {source.note !== null && (
                  <p className="m-0 mt-2 text-xs leading-5 text-[var(--theme-elevation-600)]">
                    {source.note}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEditSources && id !== undefined && id !== null && (
          <div className="mt-4 grid gap-2 border-t border-[var(--theme-elevation-150)] pt-4">
            <input
              aria-label={t.intakeId}
              className="min-h-10 rounded-lg border border-[var(--theme-elevation-250)] bg-[var(--theme-elevation-50)] px-3 text-sm text-[var(--theme-text)] focus:border-[var(--gf-accent-400)] focus:outline-none focus:ring-2 focus:ring-[var(--gf-accent-200)]"
              onChange={(event) => setIntakeItemId(event.target.value)}
              placeholder={t.intakeId}
              value={intakeItemId}
            />
            <div className="grid grid-cols-1 gap-2 @min-[420px]:grid-cols-[1fr_auto]">
              <select
                aria-label={t.sourceRole}
                className="min-h-10 rounded-lg border border-[var(--theme-elevation-250)] bg-[var(--theme-elevation-50)] px-3 text-sm text-[var(--theme-text)] focus:border-[var(--gf-accent-400)] focus:outline-none focus:ring-2 focus:ring-[var(--gf-accent-200)]"
                onChange={(event) => setSourceRole(event.target.value as "primary" | "supporting")}
                value={sourceRole}
              >
                <option value="supporting">{t.supporting}</option>
                <option value="primary">{t.primary}</option>
              </select>
              <Button
                disabled={intakeItemId.trim().length === 0}
                onClick={() => void addSource()}
                size="lg"
                type="button"
              >
                <PlusIcon size={15} /> {t.addSource}
              </Button>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] p-4 shadow-[var(--gf-shadow-surface)]">
        <div className="flex items-center gap-3">
          <IconBadge tone="neutral">
            <UsersIcon size={18} />
          </IconBadge>
          <div>
            <p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">
              {t.comments}
            </p>
            <strong className="mt-1 block text-sm text-[var(--theme-text)]">
              {context.comments.length}
            </strong>
          </div>
        </div>
        {context.comments.length === 0 ? (
          <p className="m-0 mt-4 text-sm text-[var(--theme-elevation-600)]">{t.noComments}</p>
        ) : (
          <ul className="m-0 mt-4 grid list-none gap-3 p-0">
            {context.comments.map((entry, index) => (
              <li
                className="rounded-xl border border-[var(--theme-elevation-150)] bg-[var(--theme-elevation-50)] p-3"
                key={entry.id ?? index}
              >
                <div className="flex items-center justify-between gap-2">
                  <strong className="truncate text-xs text-[var(--theme-text)]">
                    {entry.author.email ?? "—"}
                  </strong>
                  <span className="text-[11px] text-[var(--theme-elevation-600)]">
                    {dateOf(entry.createdAt, lang)}
                  </span>
                </div>
                <p className="m-0 mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--theme-elevation-700)]">
                  {entry.body ?? "—"}
                </p>
              </li>
            ))}
          </ul>
        )}
        {canComment && id !== undefined && id !== null && (
          <div className="mt-4 border-t border-[var(--theme-elevation-150)] pt-4">
            <label
              className="block text-xs font-bold uppercase tracking-[0.06em] text-[var(--theme-elevation-600)]"
              htmlFor="edition-review-comment"
            >
              {t.comment}
            </label>
            <textarea
              className="mt-2 min-h-20 w-full resize-y rounded-lg border border-[var(--theme-elevation-250)] bg-[var(--theme-elevation-50)] p-3 text-sm text-[var(--theme-text)]"
              id="edition-review-comment"
              maxLength={2000}
              onChange={(event) => setComment(event.target.value)}
              placeholder={t.commentPlaceholder}
              value={comment}
            />
            <Button
              className="mt-2"
              disabled={comment.trim().length === 0}
              onClick={() => void addComment()}
              size="lg"
              type="button"
              variant="secondary"
            >
              <MessageSquareIcon size={15} /> {t.addComment}
            </Button>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] p-4 shadow-[var(--gf-shadow-surface)]">
        <div className="flex items-center gap-3">
          <IconBadge tone="accent">
            <GlobeIcon size={18} />
          </IconBadge>
          <div>
            <p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">
              {t.variants}
            </p>
            <strong className="mt-1 block text-sm text-[var(--theme-text)]">
              {context.variants.length}
            </strong>
          </div>
        </div>
        {context.variants.length === 0 ? (
          <p className="m-0 mt-4 text-sm text-[var(--theme-elevation-600)]">{t.noVariants}</p>
        ) : (
          <ul className="m-0 mt-4 grid list-none gap-3 p-0">
            {context.variants.map((variant, index) => {
              const currentBlocks = Array.isArray(currentBody) ? currentBody : []
              const variantBlocks = [...variant.body]
              const rows = Math.max(currentBlocks.length, variantBlocks.length)
              return (
                <li
                  className="rounded-xl border border-[var(--theme-elevation-150)] bg-[var(--theme-elevation-50)] p-3"
                  key={variant.id ?? index}
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <strong className="truncate text-sm text-[var(--theme-text)]">
                      {variant.site.name ?? `Site ${variant.site.id ?? "—"}`}
                    </strong>
                    <span className="shrink-0 text-[11px] font-semibold text-[var(--theme-elevation-600)]">
                      {variant.workflowStatus ?? "draft"}
                    </span>
                  </div>
                  {variant.id !== null && (
                    <Button
                      className="mt-2"
                      onClick={() =>
                        router.push(`/admin/collections/content-editions/${variant.id}`)
                      }
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      {t.open}
                    </Button>
                  )}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-bold text-[var(--gf-accent-700)]">
                      {t.compare}
                    </summary>
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full min-w-[320px] border-collapse text-left text-xs leading-5">
                        <thead>
                          <tr>
                            <th className="w-1/2 border-b border-[var(--theme-elevation-150)] pb-1 pr-2 font-bold text-[var(--theme-text)]">
                              {t.thisVersion}
                            </th>
                            <th className="w-1/2 border-b border-[var(--theme-elevation-150)] pb-1 pl-2 font-bold text-[var(--theme-text)]">
                              {variant.site.name ?? "—"}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td className="border-b border-[var(--theme-elevation-100)] py-1 pr-2 align-top text-[var(--theme-elevation-700)]">
                              <span className="block font-bold">{t.title}</span>
                              {typeof currentTitle === "string" && currentTitle.length > 0
                                ? currentTitle
                                : "—"}
                            </td>
                            <td className="border-b border-[var(--theme-elevation-100)] py-1 pl-2 align-top text-[var(--theme-elevation-700)]">
                              <span className="block font-bold">{t.title}</span>
                              {variant.title ?? "—"}
                            </td>
                          </tr>
                          <tr>
                            <td className="border-b border-[var(--theme-elevation-100)] py-1 pr-2 align-top text-[var(--theme-elevation-700)]">
                              <span className="block font-bold">{t.summary}</span>
                              {typeof currentSummary === "string" && currentSummary.length > 0
                                ? currentSummary
                                : "—"}
                            </td>
                            <td className="border-b border-[var(--theme-elevation-100)] py-1 pl-2 align-top text-[var(--theme-elevation-700)]">
                              <span className="block font-bold">{t.summary}</span>
                              {variant.summary ?? "—"}
                            </td>
                          </tr>
                          {Array.from({ length: rows }, (_, rowIndex) => (
                            <tr key={rowIndex}>
                              <td className="border-b border-[var(--theme-elevation-100)] py-1 pr-2 align-top text-[var(--theme-elevation-700)]">
                                {blockTextOf(currentBlocks[rowIndex])}
                              </td>
                              <td className="border-b border-[var(--theme-elevation-100)] py-1 pl-2 align-top text-[var(--theme-elevation-700)]">
                                {blockTextOf(variantBlocks[rowIndex])}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <ContentEditionRail
        onSelectVersion={onSelectVersion}
        selectedVersion={selectedVersion}
        showWorkflow={false}
      />
    </aside>
  )
}
