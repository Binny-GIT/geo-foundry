"use client"

import { useCallback, useRef } from "react"

import { useEditionBody } from "./edition-editor-context"

/**
 * 整篇 Markdown 正文编辑器：一整份连续文档，不再逐块编辑。
 * 工具栏与分屏预览在后续批次接入更重的编辑器组件，这里先保证
 * 连续输入、粘贴与自适应高度的行为正确。
 */
export const EditionMarkdownEditor = ({ readOnly }: { readonly readOnly: boolean }) => {
  const { markdown, replaceMarkdown, reportSelection } = useEditionBody()
  const areaRef = useRef<HTMLTextAreaElement>(null)

  const autosize = useCallback(() => {
    const node = areaRef.current
    if (node === null) return
    node.style.height = "auto"
    node.style.height = `${String(Math.max(node.scrollHeight, 320))}px`
  }, [])

  /* 鼠标/键盘选择都会触发 onSelect；折叠光标（start==end）视为无选区。 */
  const handleSelect = useCallback(() => {
    const node = areaRef.current
    if (node === null) return
    const start = node.selectionStart
    const end = node.selectionEnd
    if (readOnly || start >= end) {
      reportSelection(null)
      return
    }
    reportSelection({ end, start, text: node.value.slice(start, end) })
  }, [readOnly, reportSelection])

  const chars = markdown.length

  return (
    <section className="rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] p-4 shadow-[var(--gf-shadow-surface)] sm:p-5">
      <div className="flex items-center justify-between">
        <p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">
          正文（Markdown）
        </p>
        <span className="text-xs text-[var(--theme-elevation-600)]">{chars} 字</span>
      </div>
      <textarea
        aria-label="正文 Markdown"
        className="gf-console-focus mt-3 w-full resize-y rounded-xl border border-[var(--theme-elevation-250)] bg-[var(--theme-elevation-50)] p-4 font-mono text-sm leading-7 text-[var(--theme-text)] outline-none focus:border-[var(--gf-accent-400)] focus:ring-2 focus:ring-[var(--gf-accent-200)]"
        disabled={readOnly}
        onChange={(event) => {
          replaceMarkdown(event.target.value)
          autosize()
        }}
        onInput={autosize}
        onSelect={handleSelect}
        placeholder={"用 Markdown 写正文：## 标题、段落、- 列表、```代码```、![图片](url)…"}
        ref={areaRef}
        spellCheck={false}
        value={markdown}
      />
      <p className="m-0 mt-2 text-xs leading-5 text-[var(--theme-elevation-600)]">
        支持标题、列表、引用、表格、代码块与图片；保存后发布链路自动渲染。
      </p>
    </section>
  )
}
