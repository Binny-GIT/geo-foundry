"use client"

import { useAuth } from "@payloadcms/ui"
import type { DefaultCellComponentProps } from "payload"

const idOf = (value: unknown): string | number | null => {
  if (typeof value === "string" || typeof value === "number") {
    return value
  }
  if (typeof value === "object" && value !== null) {
    const id = (value as Record<string, unknown>)["id"]
    return typeof id === "string" || typeof id === "number" ? id : null
  }
  return null
}

const labelOf = (value: unknown): string | null => {
  if (typeof value !== "object" || value === null) {
    return null
  }
  const name = (value as Record<string, unknown>)["name"]
  return typeof name === "string" && name.length > 0 ? name : null
}

/**
 * Tenant-bound users do not need a repeated tenant identifier in every row.
 * The server enforces their scope, so a quiet “Current tenant” label is more
 * useful than Payload's unresolved relationship fallback (“Untitled - ID”).
 */
export const TenantCell = ({ cellData }: DefaultCellComponentProps) => {
  const { user } = useAuth()
  const label = labelOf(cellData)
  const id = idOf(cellData)

  if (label !== null) {
    return <span>{label}</span>
  }
  if (id !== null) {
    return (
      <span>{user?.["role"] === "super-admin" ? `Tenant ${String(id)}` : "Current tenant"}</span>
    )
  }
  return <span>—</span>
}
