"use client"

import { useEffect, useState } from "react"

import {
  contentEditionWorkflowRequest,
  defaultContentEditionDraft,
  editableContentEditionPayload,
  editionWorkflowActionsFor,
  mapContentEditionDocument,
  type ContentEditionDocument,
  type ContentEditionDraft,
  type EditionWorkflowActionDefinition,
  type RecordLike,
} from "../lib/content-edition-studio"

type RelationshipOption = {
  readonly id: number | string
  readonly name?: string
  readonly topic?: string
}

type PayloadError = {
  readonly errors?: readonly { readonly message?: string }[]
  readonly message?: string
  readonly error?: { readonly code?: string; readonly message?: string }
}

const fieldClass =
  "gf-console-focus w-full rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3.5 text-base text-[var(--console-ink)] outline-none"

const errorMessage = (payload: PayloadError, fallback: string): string =>
  payload.errors?.find((error) => typeof error.message === "string")?.message ??
  payload.error?.message ??
  payload.message ??
  fallback

const jsonText = (value: unknown): string => JSON.stringify(value, null, 2)

const parseJson = (
  source: string,
  fieldName: string,
): { readonly data?: unknown; readonly error?: string } => {
  try {
    return { data: JSON.parse(source) as unknown }
  } catch {
    return { error: `${fieldName} 必须是有效 JSON。` }
  }
}

const relationshipLabel = (option: RelationshipOption, type: "content" | "site"): string =>
  type === "content" ? (option.topic ?? "受限内容") : (option.name ?? "受限站点")

export const ContentEditionStudio = ({
  canEdit,
  editionId,
  role,
}: {
  readonly canEdit: boolean
  readonly editionId?: string
  readonly role: string
}) => {
  const [draft, setDraft] = useState<ContentEditionDraft>(defaultContentEditionDraft)
  const [document, setDocument] = useState<ContentEditionDocument | null>(null)
  const [contents, setContents] = useState<readonly RelationshipOption[]>([])
  const [sites, setSites] = useState<readonly RelationshipOption[]>([])
  const [bodyText, setBodyText] = useState("[]")
  const [citationsText, setCitationsText] = useState("null")
  const [entitiesText, setEntitiesText] = useState("null")
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [workflowError, setWorkflowError] = useState<string | null>(null)
  const [loading, setLoading] = useState(editionId !== undefined)
  const [saving, setSaving] = useState(false)
  const [pendingAction, setPendingAction] = useState<EditionWorkflowActionDefinition | null>(null)
  const [workflowPending, setWorkflowPending] = useState(false)
  const [reason, setReason] = useState("")

  useEffect(() => {
    let active = true
    const loadRelationships = async () => {
      const [contentsResponse, sitesResponse] = await Promise.all([
        fetch("/api/contents?depth=0&limit=100&sort=topic", { credentials: "same-origin" }),
        fetch("/api/sites?depth=0&limit=100&sort=name", { credentials: "same-origin" }),
      ])
      const contentsPayload = contentsResponse.ok
        ? ((await contentsResponse.json()) as { readonly docs?: readonly RelationshipOption[] })
        : {}
      const sitesPayload = sitesResponse.ok
        ? ((await sitesResponse.json()) as { readonly docs?: readonly RelationshipOption[] })
        : {}
      if (!active) return
      setContents(contentsPayload.docs ?? [])
      setSites(sitesPayload.docs ?? [])
    }

    void loadRelationships().catch(() => {
      if (!active) return
      setLoadError("无法加载可关联的内容或站点。请刷新后重试。")
    })

    if (editionId === undefined)
      return () => {
        active = false
      }

    void (async () => {
      try {
        const response = await fetch(
          `/api/content-editions/${encodeURIComponent(editionId)}?depth=1&draft=true`,
          { credentials: "same-origin" },
        )
        const payload = (await response.json().catch(() => ({}))) as RecordLike & PayloadError
        if (!response.ok) {
          throw new Error(errorMessage(payload, "无法读取此内容版本。"))
        }
        const loaded = mapContentEditionDocument(payload)
        if (!active) return
        setDocument(loaded)
        setDraft(loaded)
        setBodyText(jsonText(loaded.body))
        setCitationsText(jsonText(loaded.citations))
        setEntitiesText(jsonText(loaded.entities))
      } catch (error) {
        if (active) {
          setLoadError(error instanceof Error ? error.message : "无法读取此内容版本。")
        }
      } finally {
        if (active) setLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [editionId])

  const update = <K extends keyof ContentEditionDraft>(key: K, value: ContentEditionDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const saveDraft = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canEdit) return
    setSaveError(null)

    const parsedBody = parseJson(bodyText, "正文区块")
    const parsedCitations = parseJson(citationsText, "引用")
    const parsedEntities = parseJson(entitiesText, "实体")
    if (parsedBody.error ?? parsedCitations.error ?? parsedEntities.error) {
      setSaveError(
        parsedBody.error ?? parsedCitations.error ?? parsedEntities.error ?? "JSON 无效。",
      )
      return
    }
    if (!Array.isArray(parsedBody.data)) {
      setSaveError("正文区块必须是 JSON 数组。")
      return
    }

    const nextDraft: ContentEditionDraft = {
      ...draft,
      body: parsedBody.data.filter(
        (block): block is RecordLike => typeof block === "object" && block !== null,
      ),
      citations: parsedCitations.data,
      entities: parsedEntities.data,
    }
    setSaving(true)
    try {
      const response = await fetch(
        editionId === undefined
          ? "/api/content-editions?draft=true"
          : `/api/content-editions/${encodeURIComponent(editionId)}?draft=true`,
        {
          body: JSON.stringify(editableContentEditionPayload(nextDraft)),
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          method: editionId === undefined ? "POST" : "PATCH",
        },
      )
      const payload = (await response.json().catch(() => ({}))) as RecordLike & PayloadError
      if (!response.ok) {
        setSaveError(errorMessage(payload, "草稿未能保存，请检查填写内容。"))
        return
      }
      const saved = mapContentEditionDocument(payload)
      setDraft(saved)
      setDocument(saved)
      setBodyText(jsonText(saved.body))
      setCitationsText(jsonText(saved.citations))
      setEntitiesText(jsonText(saved.entities))
      if (editionId === undefined && saved.id.length > 0) {
        window.location.assign(`/admin/editions/${encodeURIComponent(saved.id)}`)
      }
    } catch {
      setSaveError("暂时无法连接到服务，请稍后重试。")
    } finally {
      setSaving(false)
    }
  }

  const runWorkflowAction = async () => {
    if (document === null || pendingAction === null) return
    if (pendingAction.reasonRequired && reason.trim().length === 0) {
      setWorkflowError("退回修改前请填写原因。")
      return
    }
    setWorkflowError(null)
    setWorkflowPending(true)
    try {
      const request = contentEditionWorkflowRequest(
        document.id,
        pendingAction,
        document.workflowRevision,
        reason,
      )
      const response = await fetch(request.endpoint, {
        body: JSON.stringify(request.body),
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...request.headers },
        method: "POST",
      })
      const payload = (await response.json().catch(() => ({}))) as PayloadError
      if (!response.ok) {
        setWorkflowError(errorMessage(payload, "工作流操作未能完成。"))
        return
      }
      setPendingAction(null)
      setReason("")
      window.location.reload()
    } catch {
      setWorkflowError("暂时无法连接到服务，请稍后重试。")
    } finally {
      setWorkflowPending(false)
    }
  }

  const workflowActions = editionWorkflowActionsFor(role, document?.workflowStatus ?? null)

  if (loading) {
    return <p className="m-0 text-sm text-[var(--console-ink-muted)]">正在读取内容版本…</p>
  }

  if (loadError !== null && editionId !== undefined) {
    return (
      <p
        className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
        role="alert"
      >
        {loadError}
      </p>
    )
  }

  return (
    <div className="grid gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <a
            className="gf-console-focus text-sm font-semibold text-indigo-700 no-underline hover:underline dark:text-indigo-300"
            href="/admin/collections/content-editions"
          >
            ← 返回内容版本
          </a>
          <p className="m-0 pt-5 text-xs font-bold uppercase tracking-[0.12em] text-indigo-600">
            Content Edition Studio
          </p>
          <h1 className="m-0 pt-1 text-3xl font-semibold tracking-tight text-[var(--console-ink)]">
            {editionId === undefined ? "新建内容版本草稿" : "编辑内容版本草稿"}
          </h1>
          <p className="m-0 max-w-3xl pt-2 text-sm leading-6 text-[var(--console-ink-muted)]">
            此独立 Console
            工作台只编辑版本内容字段。租户、工作流状态、发布制品、审计记录和时间戳由服务端领域规则维护。
          </p>
        </div>
        {document?.workflowStatus !== null && document?.workflowStatus !== undefined && (
          <span className="w-fit rounded-full border border-[var(--console-border)] bg-[var(--console-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--console-ink-muted)]">
            当前状态：{document.workflowStatus}
          </span>
        )}
      </header>

      {!canEdit && (
        <p className="m-0 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-4 py-3 text-sm leading-6 text-[var(--console-ink-muted)]">
          当前角色可查看该内容版本，但没有编辑草稿的能力。可用的工作流操作仍会通过其专用公开端点执行。
        </p>
      )}

      {document !== null && workflowActions.length > 0 && (
        <section className="gf-console-card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <h2 className="m-0 text-base font-semibold text-[var(--console-ink)]">工作流操作</h2>
            <p className="m-0 pt-1 text-sm leading-6 text-[var(--console-ink-muted)]">
              操作将调用已有的同源公开端点，服务端会验证角色、租户范围、质量门禁和版本修订号。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {workflowActions.map((workflowAction) => (
              <button
                className="gf-console-focus inline-flex h-10 items-center justify-center rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3.5 text-sm font-semibold text-[var(--console-ink)] hover:bg-[var(--console-surface)]"
                key={workflowAction.label}
                onClick={() => {
                  setPendingAction(workflowAction)
                  setWorkflowError(null)
                  setReason("")
                }}
                type="button"
              >
                {workflowAction.label}
              </button>
            ))}
          </div>
        </section>
      )}

      {pendingAction !== null && (
        <section
          aria-label="确认工作流操作"
          className="gf-console-card grid gap-4 border-indigo-200 p-5 sm:p-6"
        >
          <div>
            <h2 className="m-0 text-lg font-semibold text-[var(--console-ink)]">
              确认“{pendingAction.label}”
            </h2>
            <p className="m-0 pt-1 text-sm leading-6 text-[var(--console-ink-muted)]">
              此操作不会直接修改工作流字段；请求将由现有工作流端点按服务端规则处理。
            </p>
          </div>
          {(pendingAction.reasonRequired || pendingAction.type === "publish-operation") && (
            <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
              原因{pendingAction.reasonRequired ? " *" : "（可选）"}
              <textarea
                className={`${fieldClass} min-h-24 resize-y py-3`}
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
                value={reason}
              />
            </label>
          )}
          {workflowError !== null && (
            <p className="m-0 text-sm text-rose-700" role="alert">
              {workflowError}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-3">
            <button
              className="gf-console-focus h-10 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface)] px-3.5 text-sm font-semibold text-[var(--console-ink)]"
              disabled={workflowPending}
              onClick={() => setPendingAction(null)}
              type="button"
            >
              取消
            </button>
            <button
              className="gf-console-focus h-10 rounded-xl bg-[var(--console-accent)] px-3.5 text-sm font-semibold text-white hover:bg-[var(--console-accent-hover)] disabled:cursor-wait disabled:opacity-60"
              disabled={workflowPending}
              onClick={() => void runWorkflowAction()}
              type="button"
            >
              {workflowPending ? "处理中…" : "确认操作"}
            </button>
          </div>
        </section>
      )}

      <form className="grid gap-6" onSubmit={(event) => void saveDraft(event)}>
        <fieldset className="grid gap-6 border-0 p-0 disabled:opacity-70" disabled={!canEdit}>
          <section className="gf-console-card grid gap-5 p-5 sm:p-6">
            <div>
              <h2 className="m-0 text-lg font-semibold text-[var(--console-ink)]">归属与摘要</h2>
              <p className="m-0 pt-1 text-sm leading-6 text-[var(--console-ink-muted)]">
                选择当前会话可读取的内容和站点关系。
              </p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
                内容 *
                <select
                  className={`${fieldClass} h-11`}
                  onChange={(event) => update("content", event.target.value)}
                  required
                  value={draft.content}
                >
                  <option value="">请选择内容</option>
                  {contents.map((content) => (
                    <option key={String(content.id)} value={String(content.id)}>
                      {relationshipLabel(content, "content")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
                站点 *
                <select
                  className={`${fieldClass} h-11`}
                  onChange={(event) => update("site", event.target.value)}
                  required
                  value={draft.site}
                >
                  <option value="">请选择站点</option>
                  {sites.map((site) => (
                    <option key={String(site.id)} value={String(site.id)}>
                      {relationshipLabel(site, "site")}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
              内容角度 *
              <input
                className={`${fieldClass} h-11`}
                onChange={(event) => update("angle", event.target.value)}
                required
                value={draft.angle}
              />
            </label>
            <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
              标题 *
              <input
                className={`${fieldClass} h-11`}
                onChange={(event) => update("title", event.target.value)}
                required
                value={draft.title}
              />
            </label>
            <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
              摘要 *
              <textarea
                className={`${fieldClass} min-h-28 resize-y py-3`}
                onChange={(event) => update("summary", event.target.value)}
                required
                value={draft.summary}
              />
            </label>
          </section>

          <section className="gf-console-card grid gap-5 p-5 sm:p-6">
            <div>
              <h2 className="m-0 text-lg font-semibold text-[var(--console-ink)]">正文区块</h2>
              <p className="m-0 pt-1 text-sm leading-6 text-[var(--console-ink-muted)]">
                保留 Payload 区块的原始 JSON 数组格式，包括 blockType 与各区块字段。
              </p>
            </div>
            <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
              body *
              <textarea
                className={`${fieldClass} min-h-96 resize-y py-3 font-mono text-sm leading-6`}
                onChange={(event) => setBodyText(event.target.value)}
                required
                spellCheck={false}
                value={bodyText}
              />
            </label>
          </section>

          <section className="gf-console-card grid gap-5 p-5 sm:p-6">
            <div>
              <h2 className="m-0 text-lg font-semibold text-[var(--console-ink)]">主题与证据</h2>
              <p className="m-0 pt-1 text-sm leading-6 text-[var(--console-ink-muted)]">
                引用和实体保持为 schema 中的 JSON 值，不进行前端结构转换。
              </p>
            </div>
            <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
              主主题 *
              <input
                className={`${fieldClass} h-11`}
                onChange={(event) => update("primaryTopic", event.target.value)}
                required
                value={draft.primaryTopic}
              />
            </label>
            <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
              次主题（每行一项）
              <textarea
                className={`${fieldClass} min-h-28 resize-y py-3`}
                onChange={(event) => update("secondaryTopics", event.target.value.split("\n"))}
                value={draft.secondaryTopics.join("\n")}
              />
            </label>
            <div className="grid gap-5 lg:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
                citations JSON
                <textarea
                  className={`${fieldClass} min-h-64 resize-y py-3 font-mono text-sm leading-6`}
                  onChange={(event) => setCitationsText(event.target.value)}
                  spellCheck={false}
                  value={citationsText}
                />
              </label>
              <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
                entities JSON
                <textarea
                  className={`${fieldClass} min-h-64 resize-y py-3 font-mono text-sm leading-6`}
                  onChange={(event) => setEntitiesText(event.target.value)}
                  spellCheck={false}
                  value={entitiesText}
                />
              </label>
            </div>
            <label className="grid max-w-sm gap-2 text-sm font-medium text-[var(--console-ink)]">
              创建来源 *
              <select
                className={`${fieldClass} h-11`}
                onChange={(event) =>
                  update(
                    "creationOrigin",
                    event.target.value as ContentEditionDraft["creationOrigin"],
                  )
                }
                value={draft.creationOrigin}
              >
                <option value="human">人工</option>
                <option value="ai">AI</option>
                <option value="hybrid">混合</option>
              </select>
            </label>
          </section>

          {saveError !== null && (
            <p
              className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
              role="alert"
            >
              {saveError}
            </p>
          )}
          {loadError !== null && editionId === undefined && (
            <p className="m-0 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {loadError}
            </p>
          )}
        </fieldset>
        <div className="flex flex-wrap justify-end gap-3">
          <a
            className="gf-console-focus inline-flex h-11 items-center justify-center rounded-xl border border-[var(--console-border)] bg-[var(--console-surface)] px-4 text-sm font-semibold text-[var(--console-ink)] no-underline hover:bg-[var(--console-surface-muted)]"
            href="/admin/collections/content-editions"
          >
            取消
          </a>
          {canEdit && (
            <button
              className="gf-console-focus inline-flex h-11 items-center justify-center rounded-xl bg-[var(--console-accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--console-accent-hover)] disabled:cursor-wait disabled:opacity-60"
              disabled={saving}
              type="submit"
            >
              {saving ? "正在保存草稿…" : "保存草稿"}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
