import { notFound } from "next/navigation"
import { CMS_ACTION } from "@/access/policy"
import { CMS_ROLE } from "@/access/roles"
import { ConsoleEditForm } from "@/console/components/ConsoleEditForm"
import { ConsoleSiteForm } from "@/console/components/ConsoleSiteForm"
import { ConsoleUserForm } from "@/console/components/ConsoleUserForm"
import { PageHeader } from "@/console/components/PageHeader"
import { requireConsoleContext } from "@/console/lib/console-context.server"
import {
  CONSOLE_RESOURCES,
  type ConsoleResourceSlug,
  isConsoleResourceSlug,
  isFirstWaveMutableResource,
} from "@/console/lib/resources"
import { canConsole, requireConsoleSession } from "@/console/lib/session.server"
import { siteFormValuesFromDocument } from "@/console/lib/site-form"
import { findConsoleRecord } from "@/server/repositories/console-collections"

type UserAdministratorRole = typeof CMS_ROLE.SUPER_ADMIN | typeof CMS_ROLE.TENANT_ADMIN

const userAdministratorRole = (
  role: (typeof CMS_ROLE)[keyof typeof CMS_ROLE],
): UserAdministratorRole => {
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

  const context = await requireConsoleContext()
  const numericId = Number.parseInt(id, 10)
  if (!Number.isSafeInteger(numericId) || numericId <= 0) notFound()
  const document = await findConsoleRecord(context.db, context.scope, slug, numericId)
  if (document === null) notFound()
  return (
    <div className="grid gap-6">
      <PageHeader title={`编辑${resource.label.zh}`} />
      <section className="gf-console-card p-5 sm:p-6">
        {slug === "users" ? (
          <ConsoleUserForm
            actorRole={userAdministratorRole(session.role)}
            document={{ ...document, id }}
          />
        ) : slug === "sites" ? (
          <ConsoleSiteForm
            id={id}
            initialValues={siteFormValuesFromDocument(document)}
            mode="edit"
          />
        ) : (
          <ConsoleEditForm
            document={document}
            slug={slug as Extract<ConsoleResourceSlug, "domains" | "tenants">}
          />
        )}
      </section>
    </div>
  )
}

export default ConsoleEditPage
