"use client"

import { useField } from "@payloadcms/ui"
import { useEffect, useState } from "react"

type Option = Readonly<{ id: number; label: string; meta?: string }>

type PayloadList = Readonly<{
  docs?: readonly Record<string, unknown>[]
}>

const idOf = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null

const labelOf = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback

const loadOptions = async (
  endpoint: string,
  label: (row: Record<string, unknown>) => string,
): Promise<readonly Option[]> => {
  const response = await fetch(endpoint, { credentials: "same-origin" })
  if (!response.ok) return []
  const data = (await response.json().catch(() => ({}))) as PayloadList
  return (data.docs ?? []).flatMap((row) => {
    const id = idOf(row["id"])
    return id === null ? [] : [{ id, label: label(row) }]
  })
}

const SetupSelect = ({
  label,
  options,
  path,
  placeholder,
  readOnly,
}: {
  readonly label: string
  readonly options: readonly Option[]
  readonly path: string
  readonly placeholder: string
  readonly readOnly: boolean
}) => {
  const { setValue, value } = useField<number | null>({ path })
  const selected = idOf(value)
  return (
    <label className="block rounded-xl border border-[var(--theme-elevation-150)] bg-[var(--theme-elevation-50)] px-4 py-3 focus-within:border-[var(--gf-accent-400)] focus-within:ring-2 focus-within:ring-[var(--gf-accent-100)]">
      <span className="block text-xs font-bold uppercase tracking-[0.06em] text-[var(--theme-elevation-600)]">
        {label}
      </span>
      <select
        className="mt-2 w-full border-0 bg-transparent p-0 text-sm font-semibold text-[var(--theme-text)] outline-none"
        disabled={readOnly}
        onChange={(event) =>
          setValue(event.target.value.length === 0 ? null : Number(event.target.value))
        }
        value={selected ?? ""}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export const ContentEditionSetupFields = ({ readOnly }: { readonly readOnly: boolean }) => {
  const [contents, setContents] = useState<readonly Option[]>([])
  const [sites, setSites] = useState<readonly Option[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    void Promise.all([
      loadOptions("/api/contents?depth=0&limit=100&sort=-updatedAt", (row) =>
        labelOf(row["topic"], `Content ${String(row["id"] ?? "")}`),
      ),
      loadOptions("/api/sites?depth=0&limit=100&sort=name", (row) =>
        labelOf(row["name"], `Site ${String(row["id"] ?? "")}`),
      ),
    ])
      .then(([nextContents, nextSites]) => {
        if (!active) return
        setContents(nextContents)
        setSites(nextSites)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <section className="rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] p-5 shadow-[var(--gf-shadow-surface)] sm:p-7">
      <p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">
        文档设置
      </p>
      <h2 className="m-0 mt-1 text-lg font-bold text-[var(--theme-text)]">关联内容与站点</h2>
      <p className="m-0 mt-2 text-sm leading-6 text-[var(--theme-elevation-600)]">
        内容与站点均只来自当前会话可读范围，租户由服务端校验。
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <SetupSelect
          label="内容"
          options={contents}
          path="content"
          placeholder={loading ? "正在加载内容…" : "选择内容"}
          readOnly={readOnly}
        />
        <SetupSelect
          label="站点"
          options={sites}
          path="site"
          placeholder={loading ? "正在加载站点…" : "选择站点"}
          readOnly={readOnly}
        />
      </div>
    </section>
  )
}
