"use client"

import {
  Form,
  OperationProvider,
  toast,
  useAuth,
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
import { ContentEditionContextRail } from "../content-edition/ContentEditionContextRail"
import { ContentEditionControlRail } from "../content-edition/ContentEditionControlRail"
import {
  ContentEditionEditorCanvas,
  ContentEditionMetadataEditor,
} from "../content-edition/ContentEditionEditorCanvas"
import { ContentEditionPreview } from "../content-edition/ContentEditionPreview"
import type { VersionSelection } from "../content-edition/ContentEditionRail"
import { ContentEditionSetupFields } from "../content-edition/ContentEditionSetupFields"
import { uiLangOf } from "../i18n/ui-lang"
import { CheckCircleIcon, EyeIcon, PencilIcon } from "@/components/icons"
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
    save: "保存草稿",
    saved: "已保存",
    saving: "正在保存…",
    unsaved: "有未保存修改",
  },
} as const

const ContentEditionDocumentBody = ({ readOnly }: { readonly readOnly: boolean }) => {
  const { id } = useDocumentInfo()
  const { getData } = useForm()
  const { i18n } = useTranslation()
  const lang = uiLangOf(i18n.language)
  const t = COPY[lang]
  const processing = useFormProcessing()
  const modified = useFormModified()
  const workflowStatus = useFormFields(([fields]) => fields["workflowStatus"]?.value)
  const title = useFormFields(([fields]) => fields["title"]?.value)
  const summary = useFormFields(([fields]) => fields["summary"]?.value)
  const body = useFormFields(([fields]) => fields["body"]?.value)
  const citations = useFormFields(([fields]) => fields["citations"]?.value)
  const entities = useFormFields(([fields]) => fields["entities"]?.value)
  const content = useFormFields(([fields]) => fields["content"]?.value)
  const site = useFormFields(([fields]) => fields["site"]?.value)
  const updatedAt = useFormFields(([fields]) => fields["updatedAt"]?.value)
  const [mode, setMode] = useState<"edit" | "preview">(
    id === undefined || id === null ? "edit" : "preview",
  )
  const [selectedVersion, setSelectedVersion] = useState<VersionSelection>(null)
  // getData reduces block row state into the actual Payload document value.
  // This preserves unsaved editor changes without treating a form field-state
  // object as if it were the stored block array.
  const formData = getData() as Record<string, unknown>
  const source =
    selectedVersion === null
      ? {
          body: formData["body"] ?? body,
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
  const saveState = processing ? t.saving : modified ? t.unsaved : t.saved

  return (
    <main className="flex min-h-full w-full flex-col gap-5 p-4 sm:p-6 lg:px-8 lg:py-6">
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
            <Button
              aria-pressed={mode === "preview"}
              onClick={() => {
                setSelectedVersion(null)
                setMode("preview")
              }}
              size="lg"
              variant={mode === "preview" ? "default" : "secondary"}
              type="button"
            >
              <EyeIcon size={16} /> {t.preview}
            </Button>
            {!readOnly && (
              <Button
                aria-pressed={mode === "edit"}
                onClick={() => {
                  setSelectedVersion(null)
                  setMode("edit")
                }}
                size="lg"
                variant={mode === "edit" ? "default" : "secondary"}
                type="button"
              >
                <PencilIcon size={16} /> {t.edit}
              </Button>
            )}
            {!readOnly && (
              <Button disabled={processing} size="lg" type="submit" variant="dark">
                <CheckCircleIcon size={15} /> {processing ? t.saving : t.save}
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Responsive three-pane: 2xl keeps the full rail|canvas|control layout,
       * xl fits rails+canvas while the control rail wraps to a full row, and
       * below xl everything stacks. Track minimums (240/480/300) replace the
       * old fixed-ratio tracks so the canvas can never be crushed under the
       * rails; the canvas is a @container so its inner fields reflow by the
       * canvas' own width, not the viewport. */}
      <div className="gf-stagger grid min-w-0 gap-5 2xl:grid-cols-[minmax(240px,0.7fr)_minmax(480px,1.6fr)_minmax(300px,0.8fr)] xl:grid-cols-[minmax(240px,0.9fr)_minmax(420px,1.7fr)]">
        {id !== undefined && id !== null && (
          <ContentEditionContextRail
            onSelectVersion={setSelectedVersion}
            selectedVersion={selectedVersion}
          />
        )}
        <section className="@container min-w-0">
          {mode === "preview" ? (
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
            <div className="grid gap-4">
              <div className="grid gap-4">
                {(id === undefined || id === null) && (
                  <ContentEditionSetupFields readOnly={readOnly} />
                )}
                <div className="rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] p-5 shadow-[var(--gf-shadow-surface)] sm:p-7">
                  <p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">
                    {t.editing}
                  </p>
                  <div className="mt-5">
                    <ContentEditionMetadataEditor readOnly={readOnly} />
                  </div>
                </div>
              </div>
              <ContentEditionEditorCanvas readOnly={readOnly} />
              <section className="grid gap-3">
                <p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">
                  {t.preview}
                </p>
                <ContentEditionPreview source={source} />
              </section>
            </div>
          )}
        </section>
        <ContentEditionControlRail readOnly={readOnly} />
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
  const { user } = useAuth()
  const { i18n } = useTranslation()
  const router = useRouter()
  const lang = uiLangOf(i18n.language)
  const readOnly = !hasSavePermission || isTrashed || user?.["role"] !== "editor"

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
        <ContentEditionDocumentBody readOnly={readOnly} />
      </Form>
    </OperationProvider>
  )
}
