"use client"

import { useField } from "@payloadcms/ui"
import { useEffect, useState, type ReactNode } from "react"

import { ChevronDownIcon, PencilIcon, XIcon } from "../icons"

const isRow = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const rowsOf = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isRow) : []

const cloneRows = (rows: readonly Record<string, unknown>[]) =>
  JSON.parse(JSON.stringify(rows)) as Record<string, unknown>[]

const labelOf = (row: Record<string, unknown>): string => {
  switch (row["blockType"]) {
    case "heading":
      return "标题"
    case "paragraph":
      return "段落"
    case "quote":
      return "引用"
    case "list":
      return "列表"
    case "image":
      return "图片"
    case "table":
      return "表格"
    case "faq":
      return "问答"
    case "callout":
      return "提示"
    case "code":
      return "代码"
    case "video":
      return "视频"
    case "embed":
      return "嵌入"
    case "references":
      return "参考文献"
    default:
      return "内容区块"
  }
}

const FieldLabel = ({ children }: { readonly children: ReactNode }) => (
  <label className="block text-xs font-bold uppercase tracking-[0.06em] text-[var(--theme-elevation-600)]">
    {children}
  </label>
)

const InlineTextField = ({
  label,
  multiline = false,
  path,
  placeholder,
  readOnly,
}: {
  readonly label: string
  readonly multiline?: boolean
  readonly path: string
  readonly placeholder?: string
  readonly readOnly: boolean
}) => {
  const { setValue, value } = useField<string>({ path })
  const className = multiline
    ? "mt-2 min-h-24 w-full resize-y border-0 bg-transparent p-0 text-base leading-7 text-[var(--theme-text)] outline-none placeholder:text-[var(--theme-elevation-400)]"
    : "mt-2 w-full border-0 bg-transparent p-0 text-base text-[var(--theme-text)] outline-none placeholder:text-[var(--theme-elevation-400)]"
  return (
    <div className="rounded-xl border border-[var(--theme-elevation-150)] bg-[var(--theme-elevation-50)] px-4 py-3 focus-within:border-[var(--gf-accent-400)] focus-within:ring-2 focus-within:ring-[var(--gf-accent-100)]">
      <FieldLabel>{label}</FieldLabel>
      {multiline ? (
        <textarea
          className={className}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          readOnly={readOnly}
          value={value ?? ""}
        />
      ) : (
        <input
          className={className}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          readOnly={readOnly}
          value={value ?? ""}
        />
      )}
    </div>
  )
}

const BlockEditor = ({
  index,
  readOnly,
  row,
  update,
}: {
  readonly index: number
  readonly readOnly: boolean
  readonly row: Record<string, unknown>
  readonly update: (next: Record<string, unknown>) => void
}) => {
  const type = row["blockType"]
  const text = typeof row["text"] === "string" ? row["text"] : ""
  if (type === "paragraph" || type === "quote") {
    return (
      <textarea
        className="min-h-26 w-full resize-y border-0 bg-transparent p-0 text-base leading-8 text-[var(--theme-text)] outline-none placeholder:text-[var(--theme-elevation-400)]"
        onChange={(event) => update({ ...row, text: event.target.value })}
        placeholder={type === "quote" ? "输入引用内容" : "开始输入正文…"}
        readOnly={readOnly}
        value={text}
      />
    )
  }
  if (type === "heading") {
    return (
      <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
        <select
          aria-label="标题级别"
          className="h-9 rounded-lg border border-[var(--theme-elevation-200)] bg-[var(--theme-elevation-50)] px-2 text-sm font-bold text-[var(--theme-text)]"
          disabled={readOnly}
          onChange={(event) => update({ ...row, level: event.target.value })}
          value={String(row["level"] ?? "2")}
        >
          {["2", "3", "4", "5", "6"].map((level) => <option key={level} value={level}>H{level}</option>)}
        </select>
        <textarea
          className="min-h-16 w-full resize-y border-0 bg-transparent p-0 text-2xl font-bold leading-9 tracking-tight text-[var(--theme-text)] outline-none"
          onChange={(event) => update({ ...row, text: event.target.value })}
          placeholder="标题"
          readOnly={readOnly}
          value={text}
        />
      </div>
    )
  }
  return (
    <details className="rounded-lg border border-dashed border-[var(--theme-elevation-250)] bg-[var(--theme-elevation-50)] p-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-bold text-[var(--theme-text)]">
        <span>{labelOf(row)}区块</span><ChevronDownIcon size={16} />
      </summary>
      <p className="m-0 mt-2 text-xs leading-5 text-[var(--theme-elevation-600)]">
        此区块保留结构化编辑，避免破坏页面文档契约。
      </p>
      <textarea
        aria-label={`${labelOf(row)}结构化内容`}
        className="mt-3 min-h-44 w-full resize-y rounded-lg border border-[var(--theme-elevation-200)] bg-white p-3 font-mono text-xs leading-5 text-[var(--theme-text)] outline-none focus:border-[var(--gf-accent-400)]"
        onChange={(event) => {
          try {
            const parsed = JSON.parse(event.target.value)
            if (isRow(parsed)) update(parsed)
          } catch {
            // Keep the last valid block while the user finishes editing JSON.
          }
        }}
        readOnly={readOnly}
        value={JSON.stringify(row, null, 2)}
      />
    </details>
  )
}

export const ContentEditionEditorCanvas = ({ readOnly }: { readonly readOnly: boolean }) => {
  const { setValue, value } = useField<unknown[]>({ path: "body" })
  const rows = rowsOf(value)
  const replace = (next: readonly Record<string, unknown>[]) => setValue(cloneRows(next))
  const update = (index: number, row: Record<string, unknown>) => {
    const next = cloneRows(rows)
    next[index] = row
    replace(next)
  }
  const remove = (index: number) => {
    if (rows.length <= 1) return
    replace(rows.filter((_, rowIndex) => rowIndex !== index))
  }
  const add = (blockType: "heading" | "paragraph") =>
    replace([
      ...rows,
      blockType === "heading"
        ? { blockType, level: "2", text: "新标题" }
        : { blockType, text: "新段落" },
    ])

  return (
    <section className="rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] shadow-[var(--gf-shadow-surface)]">
      <header className="flex flex-col gap-3 border-b border-[var(--theme-elevation-150)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">内容画布</p>
          <h2 className="m-0 mt-1 text-base font-bold text-[var(--theme-text)]">正文</h2>
        </div>
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            <button className="rounded-lg border border-[var(--theme-elevation-250)] bg-[var(--theme-elevation-50)] px-3 py-2 text-sm font-bold text-[var(--theme-text)] hover:bg-[var(--theme-elevation-100)]" onClick={() => add("paragraph")} type="button">+ 段落</button>
            <button className="rounded-lg border border-[var(--theme-elevation-250)] bg-[var(--theme-elevation-50)] px-3 py-2 text-sm font-bold text-[var(--theme-text)] hover:bg-[var(--theme-elevation-100)]" onClick={() => add("heading")} type="button">+ 标题</button>
          </div>
        )}
      </header>
      <div className="divide-y divide-[var(--theme-elevation-100)] px-5 sm:px-7">
        {rows.map((row, index) => (
          <article className="group relative py-6" key={`${String(row["id"] ?? row["blockType"])}-${index}`}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--theme-elevation-500)]">{String(index + 1).padStart(2, "0")} · {labelOf(row)}</span>
              {!readOnly && rows.length > 1 && (
                <button aria-label={`删除第 ${index + 1} 个区块`} className="rounded-md p-1.5 text-[var(--theme-elevation-500)] opacity-0 transition hover:bg-[var(--gf-tone-danger-bg)] hover:text-[var(--gf-tone-danger-fg)] group-hover:opacity-100 focus:opacity-100" onClick={() => remove(index)} type="button"><XIcon size={15} /></button>
              )}
            </div>
            <BlockEditor index={index} readOnly={readOnly} row={row} update={(next) => update(index, next)} />
          </article>
        ))}
      </div>
      {rows.length === 0 && <p className="m-0 p-6 text-sm text-[var(--theme-elevation-600)]">请添加至少一个正文区块。</p>}
    </section>
  )
}

const JsonField = ({
  label,
  path,
  readOnly,
}: {
  readonly label: string
  readonly path: string
  readonly readOnly: boolean
}) => {
  const { setValue, value } = useField<unknown>({ path })
  const serialized = JSON.stringify(value ?? null, null, 2)
  const [draft, setDraft] = useState(serialized)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setDraft(serialized)
  }, [serialized])
  return (
    <label className="block rounded-xl border border-[var(--theme-elevation-150)] bg-[var(--theme-elevation-50)] px-4 py-3 focus-within:border-[var(--gf-accent-400)] focus-within:ring-2 focus-within:ring-[var(--gf-accent-100)]">
      <span className="block text-xs font-bold uppercase tracking-[0.06em] text-[var(--theme-elevation-600)]">{label}</span>
      <textarea
        aria-invalid={error !== null}
        className="mt-2 min-h-28 w-full resize-y border-0 bg-transparent p-0 font-mono text-xs leading-5 text-[var(--theme-text)] outline-none"
        onChange={(event) => {
          const next = event.target.value
          setDraft(next)
          try {
            setValue(next.trim().length === 0 ? null : JSON.parse(next))
            setError(null)
          } catch {
            setError("请输入有效 JSON")
          }
        }}
        readOnly={readOnly}
        value={draft}
      />
      {error !== null && <span className="mt-1 block text-xs font-semibold text-[var(--theme-error-700)]">{error}</span>}
    </label>
  )
}

const SecondaryTopicsField = ({ readOnly }: { readonly readOnly: boolean }) => {
  const { setValue, value } = useField<unknown>({ path: "secondaryTopics" })
  const text = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").join(", ") : ""
  return (
    <div className="rounded-xl border border-[var(--theme-elevation-150)] bg-[var(--theme-elevation-50)] px-4 py-3 focus-within:border-[var(--gf-accent-400)] focus-within:ring-2 focus-within:ring-[var(--gf-accent-100)]">
      <FieldLabel>次要主题</FieldLabel>
      <input
        className="mt-2 w-full border-0 bg-transparent p-0 text-base text-[var(--theme-text)] outline-none placeholder:text-[var(--theme-elevation-400)]"
        onChange={(event) => setValue(event.target.value.split(",").map((item) => item.trim()).filter(Boolean))}
        placeholder="用逗号分隔主题"
        readOnly={readOnly}
        value={text}
      />
    </div>
  )
}

export const ContentEditionMetadataEditor = ({ readOnly }: { readonly readOnly: boolean }) => (
  <section className="grid gap-4">
    <InlineTextField label="标题" path="title" placeholder="内容标题" readOnly={readOnly} />
    <InlineTextField label="摘要" multiline path="summary" placeholder="用一两句话说明读者将获得什么" readOnly={readOnly} />
    <div className="grid gap-4 sm:grid-cols-2">
      <InlineTextField label="主要主题" path="primaryTopic" placeholder="主要主题" readOnly={readOnly} />
      <InlineTextField label="内容角度" path="angle" placeholder="内容角度" readOnly={readOnly} />
    </div>
    <SecondaryTopicsField readOnly={readOnly} />
    <details className="rounded-xl border border-[var(--theme-elevation-150)] bg-[var(--theme-elevation-50)] p-4">
      <summary className="cursor-pointer text-sm font-bold text-[var(--theme-text)]">高级文档数据</summary>
      <p className="m-0 mt-2 text-xs leading-5 text-[var(--theme-elevation-600)]">引用与实体保留为结构化数据，保存时仍由现有 Payload 访问和字段校验处理。</p>
      <div className="mt-4 grid gap-4"><JsonField label="引文" path="citations" readOnly={readOnly} /><JsonField label="实体" path="entities" readOnly={readOnly} /></div>
    </details>
  </section>
)
