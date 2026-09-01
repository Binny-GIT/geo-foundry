import { notFound } from "next/navigation"

import { CMS_ROLE } from "@/access/roles"
import { ConsoleRollbackIntentForm } from "@/console/components/ConsoleRollbackIntentForm"
import { requireConsoleSession } from "@/console/lib/session.server"

const ConsoleRollbackIntentCreatePage = async () => {
  const session = await requireConsoleSession("/admin/collections/rollback-intents/create")
  if (session.role !== CMS_ROLE.PUBLISHER) notFound()

  return (
    <div className="grid gap-6">
      <header>
        <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-rose-600">发布控制</p>
        <h1 className="m-0 pt-1 text-3xl font-semibold tracking-tight text-[var(--console-ink)]">创建回滚意图</h1>
        <p className="m-0 pt-2 text-sm leading-6 text-[var(--console-ink-muted)]">
          此操作不会直接改写生产指针。它只提交一条 publisher 批准的不可变意图，后续由受保护的后台流程在预条件仍成立时执行。
        </p>
      </header>
      <section className="gf-console-card p-5 sm:p-6">
        <ConsoleRollbackIntentForm />
      </section>
    </div>
  )
}

export default ConsoleRollbackIntentCreatePage
