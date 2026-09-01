"use client"

import { useAuth, useTranslation } from "@payloadcms/ui"
import type { DefaultCellComponentProps } from "payload"
import { useEffect, useState } from "react"

import { uiLangOf } from "../i18n/ui-lang"
import { tenantHrefOf, tenantReferenceOf } from "./tenant-cell-model"

const TEXT = {
  en: {
    current: "Current tenant",
    loading: "Loading tenant…",
    unavailable: (id: string | number) => `Tenant ${String(id)} unavailable`,
  },
  zh: {
    current: "当前租户",
    loading: "正在加载租户…",
    unavailable: (id: string | number) => `租户 ${String(id)} 不可用`,
  },
} as const

type Resolution = "idle" | "loading" | "unavailable"

const tenantNameRequests = new Map<string, Promise<string | null>>()

const tenantNameFromResponse = (value: unknown): string | null => {
  if (typeof value !== "object" || value === null) {
    return null
  }
  const name = (value as Record<string, unknown>)["name"]
  return typeof name === "string" && name.length > 0 ? name : null
}

/**
 * Tenant-bound users do not need a repeated tenant identifier in every row —
 * the server enforces their scope, so a quiet "Current tenant" label stays.
 * Super-admins see every tenant, so their rows resolve the real name in the
 * viewer's own session instead of falling back to a bare "Tenant <id>".
 */
export const TenantCell = ({ cellData }: DefaultCellComponentProps) => {
  const { user } = useAuth()
  const { i18n } = useTranslation()
  const t = TEXT[uiLangOf(i18n.language)]
  const reference = tenantReferenceOf(cellData)
  const isSuperAdmin = user?.["role"] === "super-admin"
  const [name, setName] = useState(reference.name)
  const [resolution, setResolution] = useState<Resolution>(
    reference.name === null ? "idle" : "loading",
  )

  useEffect(() => {
    setName(reference.name)
    if (reference.id === null || reference.name !== null || !isSuperAdmin) {
      setResolution("idle")
      return
    }

    const userId = user?.["id"]
    if (typeof userId !== "number" && typeof userId !== "string") {
      setResolution("unavailable")
      return
    }

    const key = `${String(userId)}:${String(reference.id)}`
    const request =
      tenantNameRequests.get(key) ??
      fetch(`/api/tenants/${encodeURIComponent(String(reference.id))}?depth=0`, {
        credentials: "same-origin",
      })
        .then(async (response) =>
          response.ok ? tenantNameFromResponse(await response.json()) : null,
        )
        .catch(() => null)
    tenantNameRequests.set(key, request)

    let active = true
    setResolution("loading")
    void request.then((resolvedName) => {
      if (active) {
        setName(resolvedName)
        setResolution(resolvedName === null ? "unavailable" : "idle")
      }
    })

    return () => {
      active = false
    }
  }, [reference.id, reference.name, isSuperAdmin, user])

  if (reference.id === null) {
    return <span>—</span>
  }
  if (!isSuperAdmin) {
    return <span>{t.current}</span>
  }
  if (name !== null) {
    return <a href={tenantHrefOf(reference.id)}>{name}</a>
  }
  if (resolution === "loading") {
    return <span>{t.loading}</span>
  }
  return <span>{t.unavailable(reference.id)}</span>
}
