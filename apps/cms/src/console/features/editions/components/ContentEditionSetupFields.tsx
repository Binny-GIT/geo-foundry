"use client"

import { useEffect, useState } from "react"

import { useEditionField } from "../state/edition-editor-context"

type Option = Readonly<{ id: number; label: string; tenantId: number | null }>

type DocumentListEnvelope = Readonly<{
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

const loadSites = async (): Promise<readonly Option[]> => {
  const response = await fetch("/api/sites?depth=0&limit=100&sort=name", {
    credentials: "same-origin",
  })
  if (!response.ok) return []
  const data = (await response.json().catch(() => ({}))) as DocumentListEnvelope
  return (data.docs ?? []).flatMap((row) => {
    const id = idOf(row["id"])
    return id === null
      ? []
      : [
          {
            id,
            label: labelOf(row["name"], `Site ${String(row["id"] ?? "")}`),
            tenantId: tenantOf(row),
          },
        ]
  })
}

export const ContentEditionSetupFields = ({ readOnly }: { readonly readOnly: boolean }) => {
  const [sites, setSites] = useState<readonly Option[]>([])
  const [loading, setLoading] = useState(true)
  const { setValue: setSite, value: siteValue } = useEditionField<number | null>({ path: "site" })
  const { setValue: setTenant, value: tenantValue } = useEditionField<number | null>({
    path: "tenant",
  })
  const selectedSite = sites.find((option) => option.id === idOf(siteValue)) ?? null

  useEffect(() => {
    const tenantId = selectedSite?.tenantId ?? null
    if (tenantId === null || idOf(tenantValue) === tenantId) return
    setTenant(tenantId)
  }, [selectedSite, setTenant, tenantValue])

  useEffect(() => {
    let active = true
    void loadSites()
      .then((nextSites) => {
        if (active) setSites(nextSites)
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
        发布设置
      </p>
      <h2 className="m-0 mt-1 text-sm font-bold text-[var(--gf-text)]">文章归属站点</h2>
      <p className="m-0 mt-2 text-xs leading-5 text-[var(--gf-elevation-600)]">
        选择文章的主发布站点。内部内容身份与租户由系统自动创建和关联，无需手工选择。
      </p>
      <label className="mt-4 block rounded-xl border border-[var(--gf-elevation-150)] bg-[var(--gf-elevation-50)] px-4 py-3 focus-within:border-[var(--gf-accent-400)] focus-within:ring-2 focus-within:ring-[var(--gf-accent-100)]">
        <span className="block text-xs font-bold uppercase tracking-[0.06em] text-[var(--gf-elevation-600)]">
          发布站点
        </span>
        <select
          className="mt-2 w-full border-0 bg-transparent p-0 text-sm font-semibold text-[var(--gf-text)] outline-none"
          disabled={readOnly}
          onChange={(event) =>
            setSite(event.target.value.length === 0 ? null : Number(event.target.value))
          }
          value={idOf(siteValue) ?? ""}
        >
          <option value="">{loading ? "正在加载站点…" : "选择发布站点"}</option>
          {sites.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <p className="m-0 mt-3 text-xs text-[var(--gf-elevation-600)]">
        租户：
        {selectedSite?.tenantId === null || selectedSite === null
          ? "由站点自动确定"
          : `#${selectedSite.tenantId}`}
      </p>
    </section>
  )
}
