"use client"

/* 文章信息编辑组件：标题/摘要（HeadlineFields）与可折叠的文章信息面板
 * （MetadataEditor：主题、标签、引用来源、实体）。块编辑画布已随
 * 「正文一整篇 Markdown」改造退役，正文编辑见 editor/EditionMarkdownEditor。 */

import { useEditionField } from "../state/edition-editor-context"
import type { ReactNode } from "react"
import { ChevronDownIcon, PlusIcon, XIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"

const isRow = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const rowsOf = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isRow) : []

const cloneRows = (rows: readonly Record<string, unknown>[]) =>
  JSON.parse(JSON.stringify(rows)) as Record<string, unknown>[]

const textOf = (value: unknown): string => (typeof value === "string" ? value : "")

const FieldLabel = ({ children }: { readonly children: ReactNode }) => (
  <span className="block text-xs font-bold uppercase tracking-[0.06em] text-[var(--gf-elevation-600)]">
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
  const { setValue, value } = useEditionField<string>({ path })
  const className = multiline
    ? "mt-2 min-h-16 w-full resize-y border-0 bg-transparent p-0 text-base leading-7 text-[var(--gf-text)] outline-none placeholder:text-[var(--gf-elevation-400)] field-sizing-content"
    : "mt-2 w-full border-0 bg-transparent p-0 text-base text-[var(--gf-text)] outline-none placeholder:text-[var(--gf-elevation-400)]"
  return (
    <div className="rounded-xl border border-[var(--gf-elevation-150)] bg-[var(--gf-elevation-50)] px-4 py-3 focus-within:border-[var(--gf-accent-400)] focus-within:ring-2 focus-within:ring-[var(--gf-accent-100)]">
      <FieldLabel>{label}</FieldLabel>
      {hint !== undefined && (
        <p className="m-0 mt-1 text-xs leading-5 text-[var(--gf-elevation-500)]">{hint}</p>
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

const StructuredRowsField = ({
  kind,
  path,
  readOnly,
}: {
  readonly kind: "citation" | "entity"
  readonly path: string
  readonly readOnly: boolean
}) => {
  const { setValue, value } = useEditionField<unknown>({ path })
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
    <section className="rounded-xl border border-[var(--gf-elevation-150)] bg-[var(--gf-elevation-50)] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-xs font-bold uppercase tracking-[0.06em] text-[var(--gf-elevation-600)]">
            {label}
          </p>
          <p className="m-0 mt-1 text-xs leading-5 text-[var(--gf-elevation-600)]">
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
        <p className="m-0 mt-4 text-sm text-[var(--gf-elevation-600)]">暂未添加{label}。</p>
      ) : (
        <div className="mt-4 grid gap-3">
          {rows.map((row, index) => (
            <div
              className="grid gap-2 rounded-lg border border-[var(--gf-elevation-150)] bg-[var(--gf-surface)] p-3"
              key={String(row["id"] ?? index)}
            >
              <div className="flex items-center justify-between gap-2">
                {/* The stable id is machine-owned: references blocks point at
                 * it, so it is shown for traceability but never hand-edited. */}
                <span className="truncate font-mono text-[11px] text-[var(--gf-elevation-500)]">
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
                className="min-h-10 w-full min-w-0 rounded-md border border-[var(--gf-elevation-250)] bg-[var(--gf-elevation-50)] px-3 text-sm text-[var(--gf-text)]"
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
                  className="min-h-10 w-full min-w-0 rounded-md border border-[var(--gf-elevation-250)] bg-[var(--gf-elevation-50)] px-3 text-sm text-[var(--gf-text)]"
                  onChange={(event) =>
                    update(index, kind === "citation" ? "publisher" : "type", event.target.value)
                  }
                  placeholder={kind === "citation" ? "发布方" : "类型，如 Organization"}
                  readOnly={readOnly}
                  value={textOf(row[kind === "citation" ? "publisher" : "type"])}
                />
                <input
                  aria-label={`${label}链接`}
                  className="min-h-10 w-full min-w-0 rounded-md border border-[var(--gf-elevation-250)] bg-[var(--gf-elevation-50)] px-3 text-sm text-[var(--gf-text)]"
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
  const { setValue, value } = useEditionField<unknown>({ path: "secondaryTopics" })
  const text = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").join(", ")
    : ""
  return (
    <div className="rounded-xl border border-[var(--gf-elevation-150)] bg-[var(--gf-elevation-50)] px-4 py-3 focus-within:border-[var(--gf-accent-400)] focus-within:ring-2 focus-within:ring-[var(--gf-accent-100)]">
      <FieldLabel>次要主题</FieldLabel>
      <input
        className="mt-2 w-full border-0 bg-transparent p-0 text-base text-[var(--gf-text)] outline-none placeholder:text-[var(--gf-elevation-400)]"
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
        <span className="mt-1 block text-sm text-[var(--gf-elevation-600)]">
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
