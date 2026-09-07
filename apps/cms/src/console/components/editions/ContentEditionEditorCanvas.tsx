"use client"

import { useField } from "./edition-editor-context"
import { type ReactNode, useEffect, useRef, useState } from "react"
import {
  ChevronDownIcon,
  FileClockIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from "@/components/icons"
import { blocksToMarkdown, markdownToBlocks } from "../../../editor/block-markdown"
import { Button } from "@/components/ui/button"

const MODE_KEY = "gf-editor-mode"

type EditorMode = "markdown" | "rich"

const isRow = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const rowsOf = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isRow) : []

const cloneRows = (rows: readonly Record<string, unknown>[]) =>
  JSON.parse(JSON.stringify(rows)) as Record<string, unknown>[]

const LABELS: Readonly<Record<string, string>> = {
  callout: "提示",
  code: "代码",
  embed: "嵌入",
  faq: "问答",
  heading: "标题",
  image: "图片",
  list: "列表",
  paragraph: "段落",
  quote: "引用",
  references: "参考文献",
  table: "表格",
  video: "视频",
}

const labelOf = (row: Record<string, unknown>): string =>
  LABELS[String(row["blockType"])] ?? "内容区块"

/* Only these types have a first-class editor; everything else keeps its
 * structured shape and is edited as JSON so the page document contract can
 * never be broken by a convenience UI. */
const EDITABLE_TYPES = ["paragraph", "heading", "quote", "list", "code"] as const

const emptyBlockOf = (blockType: string): Record<string, unknown> => {
  switch (blockType) {
    case "heading":
      return { blockType, level: "2", text: "新标题" }
    case "quote":
      return { blockType, text: "" }
    case "list":
      return { blockType, items: [{ text: "" }], style: "unordered" }
    case "code":
      return { blockType, code: "", language: "text" }
    default:
      return { blockType: "paragraph", text: "" }
  }
}

const textOf = (value: unknown): string => (typeof value === "string" ? value : "")

const FieldLabel = ({ children }: { readonly children: ReactNode }) => (
  <span className="block text-xs font-bold uppercase tracking-[0.06em] text-[var(--theme-elevation-600)]">
    {children}
  </span>
)

const InlineTextField = ({
  hint,
  label,
  multiline = false,
  path,
  placeholder,
  readOnly,
}: {
  readonly hint?: string
  readonly label: string
  readonly multiline?: boolean
  readonly path: string
  readonly placeholder?: string
  readonly readOnly: boolean
}) => {
  const { setValue, value } = useField<string>({ path })
  const className = multiline
    ? "mt-2 min-h-16 w-full resize-y border-0 bg-transparent p-0 text-base leading-7 text-[var(--theme-text)] outline-none placeholder:text-[var(--theme-elevation-400)] field-sizing-content"
    : "mt-2 w-full border-0 bg-transparent p-0 text-base text-[var(--theme-text)] outline-none placeholder:text-[var(--theme-elevation-400)]"
  return (
    <div className="rounded-xl border border-[var(--theme-elevation-150)] bg-[var(--theme-elevation-50)] px-4 py-3 focus-within:border-[var(--gf-accent-400)] focus-within:ring-2 focus-within:ring-[var(--gf-accent-100)]">
      <FieldLabel>{label}</FieldLabel>
      {hint !== undefined && (
        <p className="m-0 mt-1 text-xs leading-5 text-[var(--theme-elevation-500)]">{hint}</p>
      )}
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

const ListItemsEditor = ({
  readOnly,
  row,
  update,
}: {
  readonly readOnly: boolean
  readonly row: Record<string, unknown>
  readonly update: (next: Record<string, unknown>) => void
}) => {
  const items = Array.isArray(row["items"]) ? row["items"].filter(isRow) : []
  const replace = (next: readonly Record<string, unknown>[]) =>
    update({ ...row, items: next.length === 0 ? [{ text: "" }] : next })
  return (
    <div className="grid gap-2">
      <select
        aria-label="列表样式"
        className="h-9 w-32 rounded-lg border border-[var(--theme-elevation-200)] bg-[var(--theme-elevation-50)] px-2 text-sm text-[var(--theme-text)]"
        disabled={readOnly}
        onChange={(event) => update({ ...row, style: event.target.value })}
        value={String(row["style"] ?? "unordered")}
      >
        <option value="unordered">无序列表</option>
        <option value="ordered">有序列表</option>
      </select>
      {items.map((item, index) => (
        <div className="flex items-center gap-2" key={index}>
          <span className="w-5 shrink-0 text-xs text-[var(--theme-elevation-500)]">
            {row["style"] === "ordered" ? `${index + 1}.` : "•"}
          </span>
          <input
            aria-label={`列表第 ${index + 1} 项`}
            className="min-h-9 w-full min-w-0 rounded-lg border border-[var(--theme-elevation-200)] bg-[var(--theme-elevation-50)] px-3 text-sm text-[var(--theme-text)] outline-none focus:border-[var(--gf-accent-400)]"
            onChange={(event) =>
              replace(
                items.map((row2, i) =>
                  i === index ? { ...row2, text: event.target.value } : row2,
                ),
              )
            }
            readOnly={readOnly}
            value={textOf(item["text"])}
          />
          {!readOnly && (
            <Button
              aria-label={`删除第 ${index + 1} 项`}
              onClick={() => replace(items.filter((_, i) => i !== index))}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <XIcon size={13} />
            </Button>
          )}
        </div>
      ))}
      {!readOnly && (
        <Button
          className="justify-self-start"
          onClick={() => replace([...items, { text: "" }])}
          size="xs"
          type="button"
          variant="secondary"
        >
          <PlusIcon size={13} /> 添加列表项
        </Button>
      )}
    </div>
  )
}

const BlockEditor = ({
  readOnly,
  row,
  update,
}: {
  readonly readOnly: boolean
  readonly row: Record<string, unknown>
  readonly update: (next: Record<string, unknown>) => void
}) => {
  const type = row["blockType"]
  const text = textOf(row["text"])
  if (type === "paragraph" || type === "quote") {
    return (
      <textarea
        className={
          type === "quote"
            ? "min-h-12 w-full resize-y border-0 border-l-4 border-[var(--gf-accent-300)] bg-transparent py-0 pl-4 text-base italic leading-8 text-[var(--theme-elevation-700)] outline-none field-sizing-content"
            : "min-h-12 w-full resize-y border-0 bg-transparent p-0 text-base leading-8 text-[var(--theme-text)] outline-none placeholder:text-[var(--theme-elevation-400)] field-sizing-content"
        }
        onChange={(event) => update({ ...row, text: event.target.value })}
        placeholder={type === "quote" ? "输入引用内容" : "开始输入正文…"}
        readOnly={readOnly}
        value={text}
      />
    )
  }
  if (type === "heading") {
    return (
      <textarea
        className="min-h-11 w-full resize-y border-0 bg-transparent p-0 text-2xl font-bold leading-9 tracking-tight text-[var(--theme-text)] outline-none field-sizing-content"
        onChange={(event) => update({ ...row, text: event.target.value })}
        placeholder="标题"
        readOnly={readOnly}
        value={text}
      />
    )
  }
  if (type === "list") return <ListItemsEditor readOnly={readOnly} row={row} update={update} />
  if (type === "code") {
    return (
      <div className="grid gap-2">
        <input
          aria-label="代码语言"
          className="h-9 w-40 rounded-lg border border-[var(--theme-elevation-200)] bg-[var(--theme-elevation-50)] px-3 text-sm text-[var(--theme-text)]"
          onChange={(event) => update({ ...row, language: event.target.value })}
          placeholder="语言，如 ts"
          readOnly={readOnly}
          value={textOf(row["language"])}
        />
        <textarea
          aria-label="代码内容"
          className="min-h-32 w-full resize-y rounded-lg border border-[var(--theme-elevation-200)] bg-[var(--theme-elevation-50)] p-3 font-mono text-xs leading-5 text-[var(--theme-text)] outline-none focus:border-[var(--gf-accent-400)]"
          onChange={(event) => update({ ...row, code: event.target.value })}
          readOnly={readOnly}
          value={textOf(row["code"])}
        />
      </div>
    )
  }
  return (
    <details className="rounded-lg border border-dashed border-[var(--theme-elevation-250)] bg-[var(--theme-elevation-50)] p-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-bold text-[var(--theme-text)]">
        <span>{labelOf(row)}区块</span>
        <ChevronDownIcon size={16} />
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

const RichCanvas = ({
  readOnly,
  replace,
  rows,
}: {
  readonly readOnly: boolean
  readonly replace: (next: readonly Record<string, unknown>[]) => void
  readonly rows: readonly Record<string, unknown>[]
}) => {
  const update = (index: number, row: Record<string, unknown>) => {
    const next = cloneRows(rows)
    next[index] = row
    replace(next)
  }
  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= rows.length) return
    const next = cloneRows(rows)
    const [moved] = next.splice(index, 1)
    if (moved !== undefined) next.splice(target, 0, moved)
    replace(next)
  }
  const insertAfter = (index: number, blockType: string) => {
    const next = cloneRows(rows)
    next.splice(index + 1, 0, emptyBlockOf(blockType))
    replace(next)
  }
  const retype = (index: number, blockType: string) => {
    const current = rows[index]
    if (current === undefined || current["blockType"] === blockType) return
    const carried = textOf(current["text"])
    const next = cloneRows(rows)
    const created = emptyBlockOf(blockType)
    next[index] =
      blockType === "list"
        ? { ...created, items: carried.length === 0 ? [{ text: "" }] : [{ text: carried }] }
        : blockType === "code"
          ? { ...created, code: carried }
          : { ...created, text: carried }
    replace(next)
  }

  return (
    <div className="divide-y divide-[var(--theme-elevation-100)] px-5 sm:px-7">
      {rows.map((row, index) => (
        <article className="group relative py-3" key={`${String(row["id"] ?? index)}-${index}`}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold tabular-nums text-[var(--theme-elevation-500)]">
              {String(index + 1).padStart(2, "0")}
            </span>
            {readOnly ||
            !EDITABLE_TYPES.includes(
              String(row["blockType"]) as (typeof EDITABLE_TYPES)[number],
            ) ? (
              <span className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--theme-elevation-500)]">
                {labelOf(row)}
              </span>
            ) : (
              <select
                aria-label={`第 ${index + 1} 个区块类型`}
                className="h-8 rounded-lg border border-[var(--theme-elevation-200)] bg-[var(--theme-elevation-50)] px-2 text-xs font-bold text-[var(--theme-text)]"
                onChange={(event) => retype(index, event.target.value)}
                value={String(row["blockType"])}
              >
                {EDITABLE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {LABELS[type]}
                  </option>
                ))}
              </select>
            )}
            {row["blockType"] === "heading" && !readOnly && (
              <select
                aria-label={`第 ${index + 1} 个标题级别`}
                className="h-8 rounded-lg border border-[var(--theme-elevation-200)] bg-[var(--theme-elevation-50)] px-2 text-xs font-bold text-[var(--theme-text)]"
                onChange={(event) => update(index, { ...row, level: event.target.value })}
                value={String(row["level"] ?? "2")}
              >
                {["2", "3", "4", "5", "6"].map((level) => (
                  <option key={level} value={level}>
                    H{level}
                  </option>
                ))}
              </select>
            )}
            {!readOnly && (
              <div className="ml-auto flex items-center gap-1 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
                <Button
                  aria-label={`上移第 ${index + 1} 个区块`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  size="icon-xs"
                  title="上移"
                  type="button"
                  variant="ghost"
                >
                  <span className="inline-flex rotate-180">
                    <ChevronDownIcon size={14} />
                  </span>
                </Button>
                <Button
                  aria-label={`下移第 ${index + 1} 个区块`}
                  disabled={index === rows.length - 1}
                  onClick={() => move(index, 1)}
                  size="icon-xs"
                  title="下移"
                  type="button"
                  variant="ghost"
                >
                  <ChevronDownIcon size={14} />
                </Button>
                <Button
                  aria-label={`在第 ${index + 1} 个区块后插入段落`}
                  onClick={() => insertAfter(index, "paragraph")}
                  size="icon-xs"
                  title="在下方插入段落"
                  type="button"
                  variant="ghost"
                >
                  <PlusIcon size={14} />
                </Button>
                <Button
                  aria-label={`删除第 ${index + 1} 个区块`}
                  disabled={rows.length <= 1}
                  onClick={() => replace(rows.filter((_, rowIndex) => rowIndex !== index))}
                  size="icon-xs"
                  title="删除区块"
                  type="button"
                  variant="ghost"
                >
                  <TrashIcon size={14} />
                </Button>
              </div>
            )}
          </div>
          <BlockEditor readOnly={readOnly} row={row} update={(next) => update(index, next)} />
        </article>
      ))}
      {rows.length === 0 && (
        <p className="m-0 py-6 text-sm text-[var(--theme-elevation-600)]">
          请添加至少一个正文区块。
        </p>
      )}
    </div>
  )
}

const MarkdownCanvas = ({
  readOnly,
  replace,
  rows,
}: {
  readonly readOnly: boolean
  readonly replace: (next: readonly Record<string, unknown>[]) => void
  readonly rows: readonly Record<string, unknown>[]
}) => {
  const [text, setText] = useState(() => blocksToMarkdown(rows))
  const dirty = useRef(false)

  /* While the editor is untouched the textarea mirrors the document (e.g. the
   * assistant appending blocks); once the writer types, their text wins until
   * it is written back. */
  useEffect(() => {
    if (dirty.current) return
    setText(blocksToMarkdown(rows))
  }, [rows])

  useEffect(() => {
    if (!dirty.current) return
    const timer = setTimeout(() => {
      replace(markdownToBlocks(text))
      dirty.current = false
    }, 500)
    return () => clearTimeout(timer)
  }, [replace, text])

  return (
    <div className="px-5 py-5 sm:px-7">
      <textarea
        aria-label="Markdown 正文"
        className="min-h-[60vh] w-full resize-y rounded-xl border border-[var(--theme-elevation-200)] bg-[var(--theme-elevation-50)] p-4 font-mono text-sm leading-6 text-[var(--theme-text)] outline-none focus:border-[var(--gf-accent-400)]"
        onBlur={() => {
          if (!dirty.current) return
          replace(markdownToBlocks(text))
          dirty.current = false
        }}
        onChange={(event) => {
          dirty.current = true
          setText(event.target.value)
        }}
        placeholder={"## 小标题\n\n正文段落…\n\n- 列表项"}
        readOnly={readOnly}
        value={text}
      />
      <p className="m-0 mt-3 text-xs leading-5 text-[var(--theme-elevation-600)]">
        支持标题、段落、引用、列表和代码块。图片、表格、问答等结构化区块以
        <code className="mx-1">:::gf-block</code>
        原样保留，请勿手工改动其内容，切回文章编辑器仍可正常编辑。
      </p>
    </div>
  )
}

const StructuredRowsField = ({
  kind,
  path,
  readOnly,
}: {
  readonly kind: "citation" | "entity"
  readonly path: string
  readonly readOnly: boolean
}) => {
  const { setValue, value } = useField<unknown>({ path })
  const rows = rowsOf(value)
  const label = kind === "citation" ? "引用来源" : "相关实体"
  const replace = (next: readonly Record<string, unknown>[]) => setValue(cloneRows(next))
  const update = (index: number, key: string, next: string) => {
    const updated = cloneRows(rows)
    updated[index] = { ...updated[index], [key]: next }
    replace(updated)
  }
  const add = () =>
    replace([
      ...rows,
      kind === "citation"
        ? { id: `citation-${crypto.randomUUID().slice(0, 8)}`, title: "", url: "https://" }
        : { id: `entity-${crypto.randomUUID().slice(0, 8)}`, name: "", type: "Organization" },
    ])
  return (
    <section className="rounded-xl border border-[var(--theme-elevation-150)] bg-[var(--theme-elevation-50)] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-xs font-bold uppercase tracking-[0.06em] text-[var(--theme-elevation-600)]">
            {label}
          </p>
          <p className="m-0 mt-1 text-xs leading-5 text-[var(--theme-elevation-600)]">
            {kind === "citation"
              ? "正文引用的公开资料，标题与链接会进入参考文献。"
              : "文章涉及的机构、产品或人物，用于结构化标注。"}
          </p>
        </div>
        {!readOnly && (
          <Button onClick={add} size="sm" type="button" variant="secondary">
            <PlusIcon size={13} /> 添加
          </Button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="m-0 mt-4 text-sm text-[var(--theme-elevation-600)]">暂未添加{label}。</p>
      ) : (
        <div className="mt-4 grid gap-3">
          {rows.map((row, index) => (
            <div
              className="grid gap-2 rounded-lg border border-[var(--theme-elevation-150)] bg-[var(--gf-surface)] p-3"
              key={String(row["id"] ?? index)}
            >
              <div className="flex items-center justify-between gap-2">
                {/* The stable id is machine-owned: references blocks point at
                 * it, so it is shown for traceability but never hand-edited. */}
                <span className="truncate font-mono text-[11px] text-[var(--theme-elevation-500)]">
                  {textOf(row["id"])}
                </span>
                {!readOnly && (
                  <Button
                    aria-label={`删除第 ${index + 1} 条${label}`}
                    onClick={() => replace(rows.filter((_, rowIndex) => rowIndex !== index))}
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                  >
                    <XIcon size={13} />
                  </Button>
                )}
              </div>
              <input
                aria-label={kind === "citation" ? "来源标题" : "实体名称"}
                className="min-h-10 w-full min-w-0 rounded-md border border-[var(--theme-elevation-250)] bg-[var(--theme-elevation-50)] px-3 text-sm text-[var(--theme-text)]"
                onChange={(event) =>
                  update(index, kind === "citation" ? "title" : "name", event.target.value)
                }
                placeholder={kind === "citation" ? "来源标题" : "实体名称"}
                readOnly={readOnly}
                value={textOf(row[kind === "citation" ? "title" : "name"])}
              />
              <div className="grid gap-2 @min-[520px]:grid-cols-2">
                <input
                  aria-label={kind === "citation" ? "发布方" : "实体类型"}
                  className="min-h-10 w-full min-w-0 rounded-md border border-[var(--theme-elevation-250)] bg-[var(--theme-elevation-50)] px-3 text-sm text-[var(--theme-text)]"
                  onChange={(event) =>
                    update(index, kind === "citation" ? "publisher" : "type", event.target.value)
                  }
                  placeholder={kind === "citation" ? "发布方" : "类型，如 Organization"}
                  readOnly={readOnly}
                  value={textOf(row[kind === "citation" ? "publisher" : "type"])}
                />
                <input
                  aria-label={`${label}链接`}
                  className="min-h-10 w-full min-w-0 rounded-md border border-[var(--theme-elevation-250)] bg-[var(--theme-elevation-50)] px-3 text-sm text-[var(--theme-text)]"
                  onChange={(event) => update(index, "url", event.target.value)}
                  placeholder="https://"
                  readOnly={readOnly}
                  value={textOf(row["url"])}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

const SecondaryTopicsField = ({ readOnly }: { readonly readOnly: boolean }) => {
  const { setValue, value } = useField<unknown>({ path: "secondaryTopics" })
  const text = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").join(", ")
    : ""
  return (
    <div className="rounded-xl border border-[var(--theme-elevation-150)] bg-[var(--theme-elevation-50)] px-4 py-3 focus-within:border-[var(--gf-accent-400)] focus-within:ring-2 focus-within:ring-[var(--gf-accent-100)]">
      <FieldLabel>次要主题</FieldLabel>
      <input
        className="mt-2 w-full border-0 bg-transparent p-0 text-base text-[var(--theme-text)] outline-none placeholder:text-[var(--theme-elevation-400)]"
        onChange={(event) =>
          setValue(
            event.target.value
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
          )
        }
        placeholder="用逗号分隔主题"
        readOnly={readOnly}
        value={text}
      />
    </div>
  )
}

/** Headline and summary — the two fields every article starts from. */
export const ContentEditionHeadlineFields = ({ readOnly }: { readonly readOnly: boolean }) => (
  <section className="grid gap-4">
    <InlineTextField label="标题" path="title" placeholder="内容标题" readOnly={readOnly} />
    <InlineTextField
      label="摘要"
      multiline
      path="summary"
      placeholder="用一两句话说明读者将获得什么"
      readOnly={readOnly}
    />
  </section>
)

/**
 * Topic, angle and reference metadata. It is collapsed by default because it
 * is reviewed once per article, unlike the body which is edited constantly.
 */
export const ContentEditionMetadataEditor = ({
  defaultOpen = false,
  readOnly,
}: {
  readonly defaultOpen?: boolean
  readonly readOnly: boolean
}) => (
  <details
    className="rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] px-5 py-4 shadow-[var(--gf-shadow-surface)] sm:px-7"
    open={defaultOpen}
  >
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
      <span>
        <span className="block text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">
          文章元数据
        </span>
        <span className="mt-1 block text-sm text-[var(--theme-elevation-600)]">
          主题、角度、引用来源与相关实体
        </span>
      </span>
      <ChevronDownIcon size={18} />
    </summary>
    <div className="mt-5 grid gap-4">
      <div className="grid gap-4 @min-[520px]:grid-cols-2">
        <InlineTextField
          hint="文章的核心议题，用于站点归类与检索"
          label="主要主题（必填）"
          path="primaryTopic"
          placeholder="主要主题"
          readOnly={readOnly}
        />
        <InlineTextField
          hint="同一主题下的切入视角，生成与站点适配会参考它"
          label="内容角度（必填）"
          path="angle"
          placeholder="内容角度"
          readOnly={readOnly}
        />
      </div>
      <SecondaryTopicsField readOnly={readOnly} />
      <StructuredRowsField kind="citation" path="citations" readOnly={readOnly} />
      <StructuredRowsField kind="entity" path="entities" readOnly={readOnly} />
    </div>
  </details>
)
