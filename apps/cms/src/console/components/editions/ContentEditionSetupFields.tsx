"use client"

import { useField } from "./edition-editor-context"
import { useEffect, useState } from "react"

type Option = Readonly<{ id: number; label: string; tenantId: number | null }>

type PayloadList = Readonly<{
  docs?: readonly Record<string, unknown>[]
}>

const idOf = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null

const labelOf = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback

const tenantOf = (row: Record<string, unknown>): number | null => {
  const tenant = row["tenant"]
  if (typeof tenant === "number") return idOf(tenant)
  return typeof tenant === "object" && tenant !== null
    ? idOf((tenant as Record<string, unknown>)["id"])
    : null
}

const loadOptions = async (
  endpoint: string,
  label: (row: Record<string, unknown>) => string,
): Promise<readonly Option[]> => {
  const response = await fetch(endpoint, { credentials: "same-origin" })
  if (!response.ok) return []
  const data = (await response.json().catch(() => ({}))) as PayloadList
  return (data.docs ?? []).flatMap((row) => {
    const id = idOf(row["id"])
    return id === null ? [] : [{ id, label: label(row), tenantId: tenantOf(row) }]
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
  const { value: siteValue } = useField<number | null>({ path: "site" })
  const { value: contentValue } = useField<number | null>({ path: "content" })
  const { setValue: setTenant, value: tenantValue } = useField<number | null>({ path: "tenant" })

  /* Content and site must belong to the same tenant — the collection hook
   * rejects a mismatch — but a super-admin reads every tenant's records. So
   * the first pick fixes the tenant, the other list narrows to it, and the
   * required tenant field is filled from that choice instead of by hand. */
  const selectedTenant =
    contents.find((option) => option.id === idOf(contentValue))?.tenantId ??
    sites.find((option) => option.id === idOf(siteValue))?.tenantId ??
    null

  useEffect(() => {
    if (selectedTenant === null || idOf(tenantValue) === selectedTenant) return
    setTenant(selectedTenant)
  }, [selectedTenant, setTenant, tenantValue])

  const visibleContents =
    selectedTenant === null
      ? contents
      : contents.filter((option) => option.tenantId === selectedTenant)
  const visibleSites =
    selectedTenant === null ? sites : sites.filter((option) => option.tenantId === selectedTenant)

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
    <section className="min-w-0 rounded-2xl border border-[var(--gf-border)] bg-[var(--gf-surface)] p-4 shadow-[var(--gf-shadow-surface)]">
      <p className="m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--gf-accent-700)]">
        文档设置
      </p>
      <h2 className="m-0 mt-1 text-sm font-bold text-[var(--theme-text)]">关联内容与站点</h2>
      <p className="m-0 mt-2 text-xs leading-5 text-[var(--theme-elevation-600)]">
        内容与站点均只来自当前会话可读范围，租户由服务端校验。
      </p>
      <div className="mt-4 grid gap-3">
        <SetupSelect
          label="内容"
          options={visibleContents}
          path="content"
          placeholder={loading ? "正在加载内容…" : "选择内容"}
          readOnly={readOnly}
        />
        <SetupSelect
          label="站点"
          options={visibleSites}
          path="site"
          placeholder={loading ? "正在加载站点…" : "选择站点"}
          readOnly={readOnly}
        />
      </div>
      <p className="m-0 mt-3 text-xs text-[var(--theme-elevation-600)]">
        租户：{selectedTenant === null ? "由所选内容或站点自动确定" : `#${selectedTenant}`}
        {selectedTenant !== null && "（另一个下拉已按该租户过滤）"}
      </p>
    </section>
  )
}
