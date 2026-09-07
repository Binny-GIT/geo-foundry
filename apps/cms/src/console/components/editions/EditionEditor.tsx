"use client"

import { useState } from "react"

import { CheckCircleIcon, EyeIcon, PencilIcon } from "@/components/icons"
import { Badge } from "@/components/ui/Badge"
import { Button } from "@/components/ui/button"
import {
  isWorkflowStatus,
  WORKFLOW_TONE,
  workflowStatusLabel,
} from "@/components/workflow/workflow-actions-model"
import {
  ContentEditionAiChat,
  ContentEditionAiChatRail,
  useAiChatPanel,
} from "./ContentEditionAiChat"
import { ContentEditionControlRail } from "./ContentEditionControlRail"
import { ContentEditionHeadlineFields, ContentEditionMetadataEditor } from "./ContentEditionEditorCanvas"
import { EditionMarkdownEditor } from "./EditionMarkdownEditor"
import { ContentEditionPreview } from "./ContentEditionPreview"
import type { VersionSelection } from "./ContentEditionRail"
import { ContentEditionSetupFields } from "./ContentEditionSetupFields"
import {
  EditionEditorProvider,
  type EditionSession,
  useEditionBody,
  useEditionEditor,
} from "./edition-editor-context"

const workflowLabel = (status: unknown): string =>
  isWorkflowStatus(status) ? workflowStatusLabel(status, "zh") : String(status ?? "")

const EditorBody = ({ readOnly }: { readonly readOnly: boolean }) => {
  const editor = useEditionEditor()
  const { rows: bodyRows } = useEditionBody()
  const [mode, setMode] = useState<"edit" | "preview">("edit")
  const [selectedVersion, setSelectedVersion] = useState<VersionSelection>(null)
  const [chatOpen, setChatOpen] = useAiChatPanel()
  if (editor === null) return null
  const { dirty: formDirty, id, save, saving, values } = editor
  const workflowStatus = values["workflowStatus"]
  const title = values["title"]
  const summary = values["summary"]
  const citations = values["citations"]
  const entities = values["entities"]
  const content = values["content"]
  const site = values["site"]
  const updatedAt = values["updatedAt"]

  const source =
    selectedVersion === null
      ? {
          body: bodyRows,
          citations: citations,
          contentId: content,
          editionId: id,
          entities: entities,
          modifiedAt: updatedAt,
          siteId: site,
          summary: summary,
          title: title,
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
    ? "当前账号没有编辑此版本的权限。"
    : saving
      ? "正在保存…"
      : formDirty
        ? "有未保存修改"
        : "已保存"

  // 历史版本选择天然只读，强制预览。
  const activeMode = selectedVersion !== null || readOnly ? "preview" : mode

  return (
    /* AI 助手独占一条全高栏：吸顶跟随文档滚动，长文中对话随时可达。 */
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
                  {typeof title === "string" && title.length > 0 ? title : "未命名内容版本"}
                </h1>
                {isWorkflowStatus(workflowStatus) && (
                  <Badge tone={WORKFLOW_TONE[workflowStatus]}>
                    {workflowLabel(workflowStatus)}
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
                  <PencilIcon size={16} /> 编辑内容
                </Button>
              )}
              <Button
                aria-pressed={activeMode === "preview"}
                onClick={() => setMode("preview")}
                size="lg"
                type="button"
                variant={activeMode === "preview" ? "default" : "secondary"}
              >
                <EyeIcon size={16} /> 预览
              </Button>
              {!readOnly && (
                <Button
                  disabled={saving}
                  onClick={() => void save()}
                  size="lg"
                  type="button"
                  variant="dark"
                >
                  <CheckCircleIcon size={15} /> {saving ? "正在保存…" : "保存草稿"}
                </Button>
              )}
            </div>
          </div>
        </header>

        {/* 画布与编辑侧栏共享剩余宽度；侧栏在画布被挤压前先换行。 */}
        <div className="gf-stagger grid min-w-0 gap-5 2xl:grid-cols-[minmax(520px,1.9fr)_minmax(320px,0.9fr)]">
          <section className="@container min-w-0">
            {activeMode === "preview" ? (
              <div className="grid gap-4">
                <div className="rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] p-5 shadow-[var(--gf-shadow-surface)] sm:p-7">
                  <p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">
                    {selectedVersion === null ? "正在预览文档" : "历史版本预览"}
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
              /* 先标题摘要，再正文，最后是文章存在后才相关的元数据。 */
              <div className="grid gap-4">
                <div className="rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] p-5 shadow-[var(--gf-shadow-surface)] sm:p-7">
                  <p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">
                    正在编辑草稿
                  </p>
                  <div className="mt-5">
                    <ContentEditionHeadlineFields readOnly={readOnly} />
                  </div>
                </div>
                <EditionMarkdownEditor readOnly={readOnly} />
                <ContentEditionMetadataEditor defaultOpen={id === null} readOnly={readOnly} />
              </div>
            )}
          </section>

          <div className="grid min-w-0 content-start gap-4">
            {/* 未保存的文章在这里选择内容与站点，画布保持全宽写作。 */}
            {id === null && <ContentEditionSetupFields readOnly={readOnly} />}
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
 * Console 原生编辑器根组件：接管原 Payload `views.edit.default` 的职责。
 * 文档数据、权限与保存链路全部由服务端页面与本组件的状态层提供，
 * 不再依赖 Payload 的 Form/DocumentInfo。
 */
export const EditionEditor = ({
  doc,
  readOnly,
  session,
  versionCount,
}: {
  /** 服务端加载的 draft 文档；新建时为 null。 */
  readonly doc: Readonly<Record<string, unknown>> | null
  readonly readOnly: boolean
  readonly session: EditionSession
  readonly versionCount: number
}) => (
  <EditionEditorProvider
    doc={doc}
    readOnly={readOnly}
    session={session}
    versionCount={versionCount}
  >
    <EditorBody readOnly={readOnly} />
  </EditionEditorProvider>
)
