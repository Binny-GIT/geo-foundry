"use client"

import {
  Form,
  OperationProvider,
  toast,
  useDocumentInfo,
  useForm,
  useFormFields,
  useFormModified,
  useFormProcessing,
  useTranslation,
} from "@payloadcms/ui"
import { useRouter } from "next/navigation"
import type { DocumentViewClientProps } from "payload"
import { useState } from "react"
import { CheckCircleIcon, EyeIcon, PencilIcon } from "@/components/icons"
import {
  ContentEditionAiChat,
  ContentEditionAiChatRail,
  useAiChatPanel,
} from "../content-edition/ContentEditionAiChat"
import { ContentEditionControlRail } from "../content-edition/ContentEditionControlRail"
import {
  ContentEditionEditorCanvas,
  ContentEditionHeadlineFields,
  ContentEditionMetadataEditor,
} from "../content-edition/ContentEditionEditorCanvas"
import { ContentEditionPreview } from "../content-edition/ContentEditionPreview"
import type { VersionSelection } from "../content-edition/ContentEditionRail"
import { ContentEditionSetupFields } from "../content-edition/ContentEditionSetupFields"
import { EditionBodyProvider, useEditionBody } from "../content-edition/edition-body-context"
import { uiLangOf } from "../i18n/ui-lang"
import { Badge } from "../ui/Badge"
import { Button } from "../ui/button"
import {
  isWorkflowStatus,
  WORKFLOW_TONE,
  workflowStatusLabel,
} from "../workflow/workflow-actions-model"

const COPY = {
  en: {
    edit: "Edit content",
    editing: "Editing draft",
    preview: "Preview",
    previewing: "Previewing document",
    readOnly: "You do not have permission to edit this edition.",
    save: "Save draft",
    saved: "Saved",
    saving: "Saving…",
    unsaved: "Unsaved changes",
  },
  zh: {
    edit: "编辑内容",
    editing: "正在编辑草稿",
    preview: "预览",
    previewing: "正在预览文档",
    readOnly: "当前账号没有编辑此版本的权限。",
    save: "保存草稿",
    saved: "已保存",
    saving: "正在保存…",
    unsaved: "有未保存修改",
  },
} as const

const ContentEditionDocumentBody = ({ readOnly }: { readonly readOnly: boolean }) => {
  const { id } = useDocumentInfo()
  const router = useRouter()
  const { getData } = useForm()
  const { i18n } = useTranslation()
  const lang = uiLangOf(i18n.language)
  const t = COPY[lang]
  const processing = useFormProcessing()
  const modified = useFormModified()
  const { dirty: bodyDirty, rows: bodyRows, save: saveBody } = useEditionBody()
  const { submit } = useForm()
  const [savingAll, setSavingAll] = useState(false)
  const workflowStatus = useFormFields(([fields]) => fields["workflowStatus"]?.value)
  const title = useFormFields(([fields]) => fields["title"]?.value)
  const summary = useFormFields(([fields]) => fields["summary"]?.value)
  const citations = useFormFields(([fields]) => fields["citations"]?.value)
  const entities = useFormFields(([fields]) => fields["entities"]?.value)
  const content = useFormFields(([fields]) => fields["content"]?.value)
  const site = useFormFields(([fields]) => fields["site"]?.value)
  const updatedAt = useFormFields(([fields]) => fields["updatedAt"]?.value)
  const [mode, setMode] = useState<"edit" | "preview">("edit")
  const [selectedVersion, setSelectedVersion] = useState<VersionSelection>(null)
  const [chatOpen, setChatOpen] = useAiChatPanel()
  // getData reduces block row state into the actual Payload document value.
  // This preserves unsaved editor changes without treating a form field-state
  // object as if it were the stored block array.
  const formData = getData() as Record<string, unknown>
  const source =
    selectedVersion === null
      ? {
          body: bodyRows,
          citations: formData["citations"] ?? citations,
          contentId: formData["content"] ?? content,
          editionId: id,
          entities: formData["entities"] ?? entities,
          modifiedAt: updatedAt,
          siteId: formData["site"] ?? site,
          summary: formData["summary"] ?? summary,
          title: formData["title"] ?? title,
        }
      : {
          body: selectedVersion.snapshot.body,
          citations: selectedVersion.snapshot.citations,
          contentId: content,
          editionId: id,
          entities: selectedVersion.snapshot.entities,
          modifiedAt: selectedVersion.updatedAt,
          siteId: site,
          summary: selectedVersion.snapshot.summary,
          title: selectedVersion.snapshot.title,
        }
  const saveState = readOnly
    ? t.readOnly
    : processing || savingAll
      ? t.saving
      : modified || bodyDirty
        ? t.unsaved
        : t.saved

  /* The body is stored outside the Payload form, so one click writes both
   * halves. The form goes first: its own block row state still carries the
   * body as loaded, so submitting after our PATCH would restore the old
   * article. Writing the body last makes the edited version win. */
  const saveAll = async () => {
    setSavingAll(true)
    try {
      /* A brand-new article has no document to PATCH, and its body never
       * reaches the Payload form state, so create it in one request with the
       * form values and the edited body merged. */
      if (id === undefined || id === null) {
        const response = await fetch("/api/content-editions?depth=0&draft=true", {
          body: JSON.stringify({ ...(getData() as Record<string, unknown>), body: bodyRows }),
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          method: "POST",
        })
        const created = (await response.json().catch(() => ({}))) as {
          doc?: { id?: unknown }
          errors?: readonly { message?: string }[]
        }
        if (!response.ok || created.doc?.id === undefined) {
          toast.error(
            created.errors?.[0]?.message ??
              (lang === "zh" ? "创建文章失败。" : "The article could not be created."),
          )
          return
        }
        toast.success(lang === "zh" ? "草稿已保存。" : "Draft saved.")
        router.push(`/admin/workspace/editions/${String(created.doc.id)}`)
        return
      }
      await submit()
      const bodySaved = await saveBody()
      if (!bodySaved) {
        toast.error(
          lang === "zh" ? "正文保存失败，请重试。" : "The article body could not be saved.",
        )
      }
    } finally {
      setSavingAll(false)
    }
  }
  // A historical selection is read-only by nature, so it forces preview.
  const activeMode = selectedVersion !== null || readOnly ? "preview" : mode

  return (
    /* The assistant owns a full-height column of its own: it starts at the top
     * bar, spans the viewport, and sticks while the document scrolls, so the
     * conversation stays reachable from anywhere in a long article. */
    <main className="flex min-h-[calc(100vh-3.5rem)] w-full flex-col xl:flex-row">
      {chatOpen ? (
        <div className="shrink-0 p-4 pb-0 sm:p-6 sm:pb-0 xl:sticky xl:top-14 xl:h-[calc(100vh-3.5rem)] xl:w-[360px] xl:p-5 2xl:w-[400px]">
          <ContentEditionAiChat onCollapse={() => setChatOpen(false)} readOnly={readOnly} />
        </div>
      ) : (
        <div className="shrink-0 p-4 pb-0 sm:p-6 sm:pb-0 xl:sticky xl:top-14 xl:h-[calc(100vh-3.5rem)] xl:w-16 xl:p-3">
          <ContentEditionAiChatRail onExpand={() => setChatOpen(true)} />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-5 p-4 sm:p-6 lg:py-6 xl:pl-0">
        <header className="gf-card-in rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] p-4 shadow-[var(--gf-shadow-surface)] sm:p-5">
          <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">
                Geo Foundry · Content edition
              </p>
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                <h1 className="min-w-0 truncate text-xl font-bold tracking-tight text-[var(--theme-text)] sm:text-2xl">
                  {typeof title === "string" && title.length > 0
                    ? title
                    : lang === "zh"
                      ? "未命名内容版本"
                      : "Untitled content edition"}
                </h1>
                {isWorkflowStatus(workflowStatus) && (
                  <Badge tone={WORKFLOW_TONE[workflowStatus]}>
                    {workflowStatusLabel(workflowStatus, i18n.language)}
                  </Badge>
                )}
              </div>
              <p className="m-0 mt-1 text-xs text-[var(--theme-elevation-600)]">{saveState}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {!readOnly && (
                <Button
                  aria-pressed={activeMode === "edit"}
                  onClick={() => {
                    setSelectedVersion(null)
                    setMode("edit")
                  }}
                  size="lg"
                  type="button"
                  variant={activeMode === "edit" ? "default" : "secondary"}
                >
                  <PencilIcon size={16} /> {t.edit}
                </Button>
              )}
              <Button
                aria-pressed={activeMode === "preview"}
                onClick={() => setMode("preview")}
                size="lg"
                type="button"
                variant={activeMode === "preview" ? "default" : "secondary"}
              >
                <EyeIcon size={16} /> {t.preview}
              </Button>
              {!readOnly && (
                <Button
                  disabled={processing || savingAll}
                  onClick={() => void saveAll()}
                  size="lg"
                  type="button"
                  variant="dark"
                >
                  <CheckCircleIcon size={15} /> {processing || savingAll ? t.saving : t.save}
                </Button>
              )}
            </div>
          </div>
        </header>

        {/* Canvas and editorial rail share the remaining width; the rail wraps
         * below the canvas before the canvas is squeezed. */}
        <div className="gf-stagger grid min-w-0 gap-5 2xl:grid-cols-[minmax(520px,1.9fr)_minmax(320px,0.9fr)]">
          <section className="@container min-w-0">
            {activeMode === "preview" ? (
              <div className="grid gap-4">
                <div className="rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] p-5 shadow-[var(--gf-shadow-surface)] sm:p-7">
                  <p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">
                    {selectedVersion === null
                      ? t.previewing
                      : lang === "zh"
                        ? "历史版本预览"
                        : "Historical version preview"}
                  </p>
                  <h2 className="m-0 mt-2 text-3xl font-bold tracking-tight text-[var(--theme-text)]">
                    {typeof source.title === "string" ? source.title : "—"}
                  </h2>
                  <p className="m-0 mt-3 max-w-3xl whitespace-pre-wrap text-base leading-7 text-[var(--theme-elevation-700)]">
                    {typeof source.summary === "string" ? source.summary : "—"}
                  </p>
                </div>
                <ContentEditionPreview historical={selectedVersion !== null} source={source} />
              </div>
            ) : (
              /* Headline and summary first, then the body, then the reference
               * metadata that only matters once the article exists. */
              <div className="grid gap-4">
                <div className="rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] p-5 shadow-[var(--gf-shadow-surface)] sm:p-7">
                  <p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">
                    {t.editing}
                  </p>
                  <div className="mt-5">
                    <ContentEditionHeadlineFields readOnly={readOnly} />
                  </div>
                </div>
                <ContentEditionEditorCanvas readOnly={readOnly} />
                <ContentEditionMetadataEditor
                  defaultOpen={id === undefined || id === null}
                  readOnly={readOnly}
                />
              </div>
            )}
          </section>

          <div className="grid min-w-0 content-start gap-4">
            {/* An unsaved article picks its content and site here so the canvas
             * keeps its full width for writing. */}
            {(id === undefined || id === null) && <ContentEditionSetupFields readOnly={readOnly} />}
            <ContentEditionControlRail
              onSelectVersion={setSelectedVersion}
              readOnly={readOnly}
              selectedVersion={selectedVersion}
            />
          </div>
        </div>
      </div>
    </main>
  )
}

/**
 * Payload's `views.edit.default` replacement. Payload still provides the
 * document context, access permissions, draft form state and save URL; this
 * component owns the visual editor and preview experience.
 */
export const ContentEditionDocument = ({ formState }: DocumentViewClientProps) => {
  const { action, hasSavePermission, id, isEditing, isInitializing, isTrashed, setData } =
    useDocumentInfo()
  const { i18n } = useTranslation()
  const router = useRouter()
  const lang = uiLangOf(i18n.language)
  // Payload's collection access already decides who may write this edition;
  // a second role check here only locked out tenant admins and super admins.
  const readOnly = hasSavePermission !== true || isTrashed === true

  return (
    <OperationProvider operation={isEditing ? "update" : "create"}>
      <Form
        {...(action === undefined ? {} : { action })}
        className="gf-edition-document"
        disabled={isInitializing || readOnly}
        initialState={formState}
        isDocumentForm
        isInitializing={isInitializing}
        method={id === undefined || id === null ? "POST" : "PATCH"}
        onSuccess={(json) => {
          const saved =
            (json as { doc?: unknown; result?: unknown }).doc ??
            (json as { result?: unknown }).result
          if (typeof saved === "object" && saved !== null) {
            setData(saved as Record<string, unknown>)
            const savedId = (saved as Record<string, unknown>)["id"]
            if (
              (id === undefined || id === null) &&
              (typeof savedId === "number" || typeof savedId === "string")
            ) {
              router.push(`/admin/collections/content-editions/${savedId}`)
              return
            }
          }
          toast.success(lang === "zh" ? "草稿已保存。" : "Draft saved.")
          router.refresh()
        }}
      >
        <EditionBodyProvider>
          <ContentEditionDocumentBody readOnly={readOnly} />
        </EditionBodyProvider>
      </Form>
    </OperationProvider>
  )
}
