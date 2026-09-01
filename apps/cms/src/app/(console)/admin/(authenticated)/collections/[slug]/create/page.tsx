import { PageHeader } from "@/console/components/PageHeader"
import { notFound } from "next/navigation"

import { CMS_ACTION } from "@/access/policy"
import { CMS_ROLE } from "@/access/roles"
import { ConsoleCreateForm } from "@/console/components/ConsoleCreateForm"
import { ConsoleSiteForm } from "@/console/components/ConsoleSiteForm"
import { ConsoleUserForm } from "@/console/components/ConsoleUserForm"
import {
  CONSOLE_RESOURCES,
  isConsoleResourceSlug,
} from "@/console/lib/resources"
import { canConsole, requireConsoleSession } from "@/console/lib/session.server"

const CREATE_SUPPORTED = new Set(["contents", "domains", "sites", "tenants", "users"])

type UserAdministratorRole = typeof CMS_ROLE.SUPER_ADMIN | typeof CMS_ROLE.TENANT_ADMIN

const userAdministratorRole = (role: typeof CMS_ROLE[keyof typeof CMS_ROLE]): UserAdministratorRole => {
  if (role === CMS_ROLE.SUPER_ADMIN || role === CMS_ROLE.TENANT_ADMIN) return role
  notFound()
}

type CreatePageProps = {
  readonly params: Promise<{ readonly slug: string }>
}

const ConsoleCreatePage = async ({ params }: CreatePageProps) => {
  const { slug } = await params
  if (!isConsoleResourceSlug(slug) || !CREATE_SUPPORTED.has(slug)) notFound()

  const session = await requireConsoleSession(`/admin/collections/${slug}/create`)
  const resource = CONSOLE_RESOURCES[slug]
  if (
    resource.resource === null ||
    !canConsole(session, resource.resource, CMS_ACTION.CREATE) ||
    (slug === "users" &&
      session.role !== CMS_ROLE.SUPER_ADMIN &&
      session.role !== CMS_ROLE.TENANT_ADMIN)
  ) {
    notFound()
  }

  return (
    <div className="grid gap-6">
      <PageHeader title={`新建${resource.label.zh}`} />
      <section className="gf-console-card p-5 sm:p-6">
        {slug === "users" ? (
          <ConsoleUserForm actorRole={userAdministratorRole(session.role)} />
        ) : slug === "sites" ? (
          <ConsoleSiteForm mode="create" />
        ) : (
          <ConsoleCreateForm slug={slug} />
        )}
      </section>
    </div>
  )
}

export default ConsoleCreatePage
