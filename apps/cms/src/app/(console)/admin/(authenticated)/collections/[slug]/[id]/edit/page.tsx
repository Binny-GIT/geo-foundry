import { notFound } from "next/navigation"

import { CMS_ACTION } from "@/access/policy"
import { CMS_ROLE } from "@/access/roles"
import { ConsoleEditForm } from "@/console/components/ConsoleEditForm"
import { ConsoleSiteForm } from "@/console/components/ConsoleSiteForm"
import { ConsoleUserForm } from "@/console/components/ConsoleUserForm"
import {
  CONSOLE_RESOURCES,
  isConsoleResourceSlug,
  isFirstWaveMutableResource,
  type ConsoleResourceSlug,
} from "@/console/lib/resources"
import { findConsoleDocument } from "@/console/lib/payload.server"
import { siteFormValuesFromDocument } from "@/console/lib/site-form"
import { canConsole, requireConsoleSession } from "@/console/lib/session.server"

type UserAdministratorRole = typeof CMS_ROLE.SUPER_ADMIN | typeof CMS_ROLE.TENANT_ADMIN

const userAdministratorRole = (role: typeof CMS_ROLE[keyof typeof CMS_ROLE]): UserAdministratorRole => {
  if (role === CMS_ROLE.SUPER_ADMIN || role === CMS_ROLE.TENANT_ADMIN) return role
  notFound()
}

type EditPageProps = {
  readonly params: Promise<{ readonly id: string; readonly slug: string }>
}

const ConsoleEditPage = async ({ params }: EditPageProps) => {
  const { id, slug } = await params
  if (!isConsoleResourceSlug(slug) || (slug !== "users" && !isFirstWaveMutableResource(slug))) {
    notFound()
  }

  const session = await requireConsoleSession(`/admin/collections/${slug}/${id}/edit`)
  const resource = CONSOLE_RESOURCES[slug]
  if (
    resource.resource === null ||
    !canConsole(session, resource.resource, CMS_ACTION.UPDATE) ||
    (slug === "users" &&
      session.role !== CMS_ROLE.SUPER_ADMIN &&
      session.role !== CMS_ROLE.TENANT_ADMIN)
  ) {
    notFound()
  }

  const document = await findConsoleDocument({ id, slug })
  return (
    <div className="grid gap-6">
      <header>
        <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-indigo-600">编辑记录</p>
        <h1 className="m-0 pt-1 text-3xl font-semibold tracking-tight text-[var(--console-ink)]">
          编辑{resource.label.zh}
        </h1>
        <p className="m-0 pt-2 text-sm leading-6 text-[var(--console-ink-muted)]">
          {slug === "users"
            ? "可用角色与租户选择由当前会话决定；Payload API 仍会在服务端强制执行最终权限与租户规则。"
            : "只提交当前资源允许由人工更新的字段。服务端会继续执行租户范围、唯一性、关系与领域校验。"}
        </p>
      </header>
      <section className="gf-console-card p-5 sm:p-6">
        {slug === "users" ? (
          <ConsoleUserForm actorRole={userAdministratorRole(session.role)} document={{ ...document, id }} />
        ) : slug === "sites" ? (
          <ConsoleSiteForm id={id} initialValues={siteFormValuesFromDocument(document)} mode="edit" />
        ) : (
          <ConsoleEditForm
            document={document}
            slug={slug as Extract<ConsoleResourceSlug, "contents" | "domains" | "tenants">}
          />
        )}
      </section>
    </div>
  )
}

export default ConsoleEditPage
