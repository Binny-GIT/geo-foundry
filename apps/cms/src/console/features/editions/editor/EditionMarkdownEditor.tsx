"use client"

import { Editor } from "bytemd"
import gfm from "@bytemd/plugin-gfm"
import zhHans from "bytemd/locales/zh_Hans.json"
import { useCallback, useEffect, useRef, useState } from "react"

import "bytemd/dist/index.min.css"

import "./markdown-editor.css"
import { useEditionBody } from "../state/edition-editor-context"

type UploadResponse = {
  readonly doc?: { readonly url?: unknown }
  readonly errors?: readonly { readonly message?: string }[]
  readonly message?: string
}

const uploadFailureText = (payload: UploadResponse): string => {
  const raw =
    payload.errors?.find((error) => typeof error.message === "string")?.message ?? payload.message
  if (raw?.includes("CMS_MEDIA_FILE_TOO_LARGE")) return "图片超过 5 MB 限制。"
  if (raw?.includes("CMS_MEDIA_TYPE_UNSUPPORTED")) return "只支持 PNG、JPEG、WebP 和 GIF 图片。"
  return raw ?? "图片上传失败，请稍后重试。"
}

const plugins = [gfm()]

/**
 * 整篇 Markdown 正文编辑器（bytemd：GitHub 风格工具栏 + 分屏预览）。
 * 编辑器实例只挂载一次；外部对 markdown 的改动（AI 应用提案、撤销、
 * 保存后重置）通过 $set 同步回去，避免打字时被重复重渲染打断。
 */
export const EditionMarkdownEditor = ({ readOnly }: { readonly readOnly: boolean }) => {
  const { markdown, replaceMarkdown, reportSelection } = useEditionBody()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<Editor | null>(null)
  const syncedValueRef = useRef(markdown)
  const replaceRef = useRef(replaceMarkdown)
  replaceRef.current = replaceMarkdown
  const [uploadError, setUploadError] = useState<string | null>(null)

  const uploadImages = useCallback(async (files: readonly File[]) => {
    const uploaded: { readonly alt: string; readonly url: string }[] = []
    for (const file of files) {
      const form = new FormData()
      form.append("file", file)
      form.append("alt", file.name.replace(/\.[^.]+$/, "") || "正文图片")
      let payload: UploadResponse = {}
      try {
        const response = await fetch("/api/media", {
          body: form,
          credentials: "same-origin",
          method: "POST",
        })
        payload = (await response.json().catch(() => ({}))) as UploadResponse
        if (!response.ok || typeof payload.doc?.url !== "string") {
          setUploadError(uploadFailureText(payload))
          throw new Error("media upload rejected")
        }
      } catch (error) {
        if (error instanceof Error && error.message === "media upload rejected") throw error
        setUploadError("暂时无法连接到服务，请稍后重试。")
        throw error
      }
      uploaded.push({ alt: file.name, url: payload.doc.url as string })
    }
    return uploaded
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const editor = new Editor({
      props: {
        locale: zhHans,
        placeholder:
          "用 Markdown 写正文：## 标题、段落、- 列表、```代码```；图片可直接粘贴或拖入，自动上传媒体库",
        plugins,
        uploadImages,
        value: syncedValueRef.current,
      },
      target: host,
    })
    editor.$on("change", (event) => {
      syncedValueRef.current = event.detail
      replaceRef.current(event.detail)
    })
    editorRef.current = editor
    return () => {
      editor.$destroy()
      editorRef.current = null
    }
  }, [uploadImages])

  useEffect(() => {
    const editor = editorRef.current
    if (editor === null || markdown === syncedValueRef.current) return
    syncedValueRef.current = markdown
    editor.$set({ value: markdown })
  }, [markdown])

  /*
   * AI 助手只消费选区的文本内容；用 DOM selection 而不是 CodeMirror
   * 内部状态上报，避免依赖 bytemd 的私有结构。折叠选区视为无选区。
   */
  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const report = () => {
      const selection = window.getSelection()
      if (readOnly || selection === null || selection.rangeCount === 0) {
        reportSelection(null)
        return
      }
      const text = selection.toString()
      if (text.length === 0 || !host.contains(selection.anchorNode)) {
        reportSelection(null)
        return
      }
      reportSelection({ end: text.length, start: 0, text })
    }
    host.addEventListener("keyup", report)
    host.addEventListener("pointerup", report)
    return () => {
      host.removeEventListener("keyup", report)
      host.removeEventListener("pointerup", report)
    }
  }, [readOnly, reportSelection])

  const chars = markdown.length

  return (
    <section className="rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] p-4 shadow-[var(--gf-shadow-surface)] sm:p-5">
      <div className="flex items-center justify-between">
        <p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">
          正文（Markdown）
        </p>
        <span className="text-xs text-[var(--gf-elevation-600)]">{chars} 字</span>
      </div>
      <div
        className="gf-md-editor mt-3"
        data-readonly={readOnly ? "true" : "false"}
        ref={hostRef}
      />
      {uploadError !== null && (
        <p
          className="m-0 mt-2 rounded-md border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs leading-5 text-rose-700"
          role="alert"
        >
          {uploadError}
        </p>
      )}
      <p className="m-0 mt-2 text-xs leading-5 text-[var(--gf-elevation-600)]">
        工具栏可切换分屏预览；支持标题、列表、引用、表格、代码块，图片粘贴或拖入后自动上传到媒体库。
      </p>
    </section>
  )
}
