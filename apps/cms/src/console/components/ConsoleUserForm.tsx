"use client"

import { useEffect, useState } from "react"

import { CMS_ROLE, type CmsRole } from "@/access/roles"
import { PlusIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { consoleRoute } from "../lib/resources"
import { assignableUserRoles, type UserFormActorRole, userFormPayload } from "../lib/user-form"

type TenantOption = {
  readonly id: number | string
  readonly name?: string
}

type PayloadError = {
  readonly errors?: readonly { readonly message?: string }[]
  readonly message?: string
}

type UserDocument = {
  readonly email?: unknown
  readonly id: number | string
  readonly role?: unknown
  readonly sites?: unknown
  readonly tenant?: unknown
}

const documentSiteIds = (sites: unknown): readonly string[] => {
  if (!Array.isArray(sites)) return []
  return sites.flatMap((site) => {
    if (typeof site === "number") return [String(site)]
    if (typeof site === "object" && site !== null && "id" in site) {
      const id = (site as { readonly id?: unknown })["id"]
      if (typeof id === "number") return [String(id)]
    }
    return []
  })
}

const ROLE_LABEL: Readonly<Record<CmsRole, string>> = {
  [CMS_ROLE.CONTENT_SERVICE]: "内容服务",
  [CMS_ROLE.EDITOR]: "编辑",
  [CMS_ROLE.PUBLISHER]: "发布",
  [CMS_ROLE.REVIEWER]: "审阅",
  [CMS_ROLE.SUPER_ADMIN]: "超级管理员",
  [CMS_ROLE.TENANT_ADMIN]: "租户管理员",
}

const errorMessage = (payload: PayloadError): string =>
  payload.errors?.find((error) => typeof error.message === "string")?.message ??
  payload.message ??
  "保存失败，请检查填写内容后重试。"

const stringValue = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : ""

const relationshipId = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") return String(value)
  if (typeof value === "object" && value !== null && "id" in value) {
    return stringValue((value as { readonly id?: unknown })["id"])
  }
  return ""
}

export const ConsoleUserForm = ({
  actorRole,
  document,
}: {
  readonly actorRole: UserFormActorRole
  readonly document?: UserDocument
}) => {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [role, setRole] = useState<CmsRole>(() => {
    const current = document?.role
    const assignable = assignableUserRoles(actorRole)
    if (assignable.includes(current as CmsRole)) return current as CmsRole
    const fallback = assignable[0]
    if (fallback === undefined) throw new Error("CONSOLE_ASSIGNABLE_ROLE_MISSING")
    return fallback
  })
  const [tenants, setTenants] = useState<readonly TenantOption[]>([])
  const [siteOptions, setSiteOptions] = useState<readonly TenantOption[]>([])
  const isCreate = document === undefined
  const needsTenant = actorRole === CMS_ROLE.SUPER_ADMIN && role !== CMS_ROLE.SUPER_ADMIN
  const documentId = document === undefined ? "" : String(document.id)

  useEffect(() => {
    if (actorRole !== CMS_ROLE.SUPER_ADMIN) return
    let active = true
    void fetch("/api/tenants?depth=0&limit=100&sort=name", { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) return []
        const payload = (await response.json()) as { readonly docs?: readonly TenantOption[] }
        return payload.docs ?? []
      })
      .then((docs) => {
        if (active) setTenants(docs)
      })
      .catch(() => {
        if (active) setTenants([])
      })
    return () => {
      active = false
    }
  }, [actorRole])

  useEffect(() => {
    let active = true
    void fetch("/api/sites?depth=0&limit=100&sort=name", { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) return []
        const payload = (await response.json()) as { readonly docs?: readonly TenantOption[] }
        return payload.docs ?? []
      })
      .then((docs) => {
        if (active) setSiteOptions(docs)
      })
      .catch(() => {
        if (active) setSiteOptions([])
      })
    return () => {
      active = false
    }
  }, [])

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setLoading(true)

    const form = new FormData(event.currentTarget)
    const data = userFormPayload(actorRole, {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      role,
      siteIds: form.getAll("sites").map((value) => String(value)),
      tenantId: String(form.get("tenant") ?? ""),
    })
    if (data === null || (isCreate && !("password" in data))) {
      setError(needsTenant ? "请为非超级管理员选择租户。" : "请填写有效的邮箱、角色和新账户密码。")
      setLoading(false)
      return
    }

    try {
      const response = await fetch(
        isCreate ? "/api/users" : `/api/users/${encodeURIComponent(documentId)}`,
        {
          body: JSON.stringify(data),
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          method: isCreate ? "POST" : "PATCH",
        },
      )
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as PayloadError
        setError(errorMessage(payload))
        return
      }
      window.location.assign(
        isCreate ? consoleRoute.collection("users") : consoleRoute.document("users", documentId),
      )
    } catch {
      setError("暂时无法连接到服务，请稍后重试。")
    } finally {
      setLoading(false)
    }
  }

  return (
    <form className="grid gap-5" onSubmit={submit}>
      <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
        邮箱
        <input
          autoComplete="email"
          className="gf-console-focus h-11 rounded-md border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3.5 text-base text-[var(--console-ink)] outline-none"
          defaultValue={stringValue(document?.email)}
          name="email"
          required
          type="email"
        />
      </label>

      <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
        {isCreate ? "账户密码" : "设置新密码（可选）"}
        <input
          autoComplete="new-password"
          className="gf-console-focus h-11 rounded-md border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3.5 text-base text-[var(--console-ink)] outline-none"
          name="password"
          required={isCreate}
          type="password"
        />
        <small className="font-normal leading-5 text-[var(--console-ink-muted)]">
          {isCreate ? "密码仅随本次请求发送，不会显示或保存到 Console。" : "留空则不修改当前密码。"}
        </small>
      </label>

      <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
        角色
        <select
          className="gf-console-focus h-11 rounded-md border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3.5 text-base text-[var(--console-ink)] outline-none"
          name="role"
          onChange={(event) => setRole(event.target.value as CmsRole)}
          value={role}
        >
          {assignableUserRoles(actorRole).map((option) => (
            <option key={option} value={option}>
              {ROLE_LABEL[option]}
            </option>
          ))}
        </select>
      </label>

      {actorRole === CMS_ROLE.SUPER_ADMIN && needsTenant && (
        <label className="grid gap-2 text-sm font-medium text-[var(--console-ink)]">
          租户
          <select
            className="gf-console-focus h-11 rounded-md border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3.5 text-base text-[var(--console-ink)] outline-none disabled:cursor-not-allowed disabled:opacity-60"
            defaultValue={relationshipId(document?.tenant)}
            disabled={tenants.length === 0}
            name="tenant"
            required
          >
            <option value="">{tenants.length === 0 ? "没有可选租户" : "请选择租户"}</option>
            {tenants.map((tenant) => (
              <option key={String(tenant.id)} value={String(tenant.id)}>
                {tenant.name ?? "受限租户"}
              </option>
            ))}
          </select>
          <small className="font-normal leading-5 text-[var(--console-ink-muted)]">
            超级管理员账户不绑定租户；其他角色必须绑定一个租户。
          </small>
        </label>
      )}

      {siteOptions.length > 0 && (
        <fieldset className="grid gap-2 border-0 p-0">
          <legend className="text-sm font-medium text-[var(--console-ink)]">
            站点范围（可选）
          </legend>
          <small className="leading-5 text-[var(--console-ink-muted)]">
            勾选后该用户只能看到所选站点的文章与工作台内容；全部不勾选表示租户内全部站点。超级管理员与租户管理员不受限制。
          </small>
          <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
            {siteOptions.map((site) => {
              const value = String(site.id)
              return (
                <label
                  className="flex min-h-10 items-center gap-2.5 rounded-md border border-[var(--console-border)] bg-[var(--console-surface-muted)] px-3 text-sm text-[var(--console-ink)]"
                  key={value}
                  title={site.name ?? undefined}
                >
                  <input
                    className="gf-console-focus size-4 shrink-0"
                    defaultChecked={documentSiteIds(document?.sites).includes(value)}
                    name="sites"
                    type="checkbox"
                    value={value}
                  />
                  <span className="truncate">{site.name ?? "受限站点"}</span>
                </label>
              )
            })}
          </div>
        </fieldset>
      )}

      {actorRole === CMS_ROLE.TENANT_ADMIN && (
        <p className="m-0 rounded-md border border-[var(--console-border)] bg-[var(--console-surface-muted)] p-4 text-sm leading-6 text-[var(--console-ink-muted)]">
          用户将自动绑定到您的当前租户。此表单不会发送租户字段，也不会提供超级管理员角色。
        </p>
      )}

      {error !== null && (
        <p
          className="m-0 rounded-md border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm leading-6 text-rose-700"
          role="alert"
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-3 border-t border-[var(--console-border)] pt-5">
        <Button asChild size="lg" variant="secondary">
          <a
            href={
              isCreate
                ? consoleRoute.collection("users")
                : consoleRoute.document("users", documentId)
            }
          >
            取消
          </a>
        </Button>
        <Button
          className="disabled:cursor-wait"
          disabled={loading || (needsTenant && tenants.length === 0)}
          size="lg"
          type="submit"
        >
          {isCreate && <PlusIcon size={15} />}
          {loading ? (isCreate ? "正在创建…" : "正在保存…") : isCreate ? "创建用户" : "保存更改"}
        </Button>
      </div>
    </form>
  )
}
