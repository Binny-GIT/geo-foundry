export type TenantReference = {
  readonly id: number | string | null
  readonly name: string | null
}

export const tenantReferenceOf = (value: unknown): TenantReference => {
  if (typeof value === "number" || typeof value === "string") {
    return { id: value, name: null }
  }
  if (typeof value !== "object" || value === null) {
    return { id: null, name: null }
  }
  const row = value as Record<string, unknown>
  const id = row["id"]
  const name = row["name"]
  return {
    id: typeof id === "number" || typeof id === "string" ? id : null,
    name: typeof name === "string" && name.length > 0 ? name : null,
  }
}

export const tenantHrefOf = (id: number | string): string => `/admin/collections/tenants/${String(id)}`
