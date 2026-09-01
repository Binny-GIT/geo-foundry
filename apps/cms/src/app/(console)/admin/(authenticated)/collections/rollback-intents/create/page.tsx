import { notFound } from "next/navigation"
import { CMS_ROLE } from "@/access/roles"
import { ConsoleRollbackIntentForm } from "@/console/components/ConsoleRollbackIntentForm"
import { PageHeader } from "@/console/components/PageHeader"
import { requireConsoleSession } from "@/console/lib/session.server"

const ConsoleRollbackIntentCreatePage = async () => {
  const session = await requireConsoleSession("/admin/collections/rollback-intents/create")
  if (session.role !== CMS_ROLE.PUBLISHER) notFound()

  return (
    <div className="grid gap-6">
      <PageHeader title="创建回滚意图" />
      <section className="gf-console-card p-5 sm:p-6">
        <ConsoleRollbackIntentForm />
      </section>
    </div>
  )
}

export default ConsoleRollbackIntentCreatePage
