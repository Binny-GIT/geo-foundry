import { notFound } from "next/navigation"

import { CMS_ACTION, CMS_RESOURCE } from "@/access/policy"
import { PlugIcon } from "@/components/icons"
import { ConnectorManager } from "@/console/components/ConnectorManager"
import { PageHeader } from "@/console/components/PageHeader"
import { requireConsoleContext } from "@/console/lib/console-context.server"
import { canConsole } from "@/console/lib/session.server"
import { listConnectorRows } from "@/server/repositories/console-reads"

export const metadata = { title: "采集源 | Geo Foundry" }

/*
 * 采集源管理。矩阵里 connectors 的写权限只给了 tenant-admin，
 * 其他角色（含 automation 机器身份）只读或不可见。
 */
const ConnectorsPage = async () => {
  const context = await requireConsoleContext()
  if (!canConsole(context.session, CMS_RESOURCE.CONNECTORS, CMS_ACTION.READ)) notFound()
  const connectors = await listConnectorRows(context.db, context.scope)

  return (
    <div className="grid gap-6 [&>*]:min-w-0">
      <PageHeader
        icon={PlugIcon}
        meta={
          <span className="rounded-full border border-[var(--console-border)] bg-[var(--console-surface)] px-3 py-1 text-xs font-semibold text-[var(--console-ink-muted)]">
            RSS 按间隔轮询 · 父稿终态后自动开新批次
          </span>
        }
        title="采集源"
      />
      <section className="gf-console-card grid gap-2 p-5 sm:p-6">
        <p className="m-0 text-sm leading-6 text-[var(--console-ink-muted)]">
          RSS 采集源由 Worker 每分钟检查一次，按各源配置的间隔拉取 feed， 抓到的条目进入
          <strong>稿源收件箱</strong>等待人工采纳；父稿被忽略、合并或采纳后，
          下一轮轮询会自动开启新的批次，采集不会停摆。
        </p>
      </section>
      <ConnectorManager
        canManage={canConsole(context.session, CMS_RESOURCE.CONNECTORS, CMS_ACTION.UPDATE)}
        connectors={connectors}
      />
    </div>
  )
}

export default ConnectorsPage
