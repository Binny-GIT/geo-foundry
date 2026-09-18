import { CMS_ACTION, CMS_RESOURCE } from "@/access/policy"
import { CMS_ROLE } from "@/access/roles"
import { KeyRoundIcon } from "@/components/icons"
import { IntegrationKeys } from "@/console/components/IntegrationKeys"
import { PageHeader } from "@/console/components/PageHeader"
import { requireConsoleContext } from "@/console/lib/console-context.server"
import { canConsole } from "@/console/lib/session.server"
import {
  listApiCredentials,
  listAutomationIdentities,
  listMyApiCredentials,
  listSiteOptions,
} from "@/server/repositories/console-reads"

export const metadata = { title: "集成密钥 | Geo Foundry" }

/*
 * 集成密钥对全部 Console 用户开放：密钥跟用户走，自助创建、自助吊销，
 * 用密钥采集的投稿归属创建者。tenant-admin / super-admin 额外看到租户
 * 全部密钥与「自动化投稿」共享身份的代签入口。
 */
const IntegrationsPage = async () => {
  const context = await requireConsoleContext()
  const canListTenant = canConsole(context.session, CMS_RESOURCE.USERS, CMS_ACTION.READ)
  const [credentials, identities, siteOptions] = await Promise.all([
    canListTenant
      ? listApiCredentials(context.db, context.scope)
      : listMyApiCredentials(context.db, Number(context.session.id)),
    canListTenant
      ? listAutomationIdentities(context.db, context.scope)
      : Promise.resolve([] as readonly Record<string, unknown>[]),
    /* 各真人角色对站点均只读可见，密钥默认站点下拉无需额外权限门。 */
    listSiteOptions(context.db, context.scope).catch(
      () => [] as readonly { id: number; name: string }[],
    ),
  ])

  return (
    <div className="grid gap-6 [&>*]:min-w-0">
      <PageHeader
        icon={KeyRoundIcon}
        meta={
          <span className="rounded-full border border-[var(--console-border)] bg-[var(--console-surface)] px-3 py-1 text-xs font-semibold text-[var(--console-ink-muted)]">
            {credentials.length} 把密钥
          </span>
        }
        title="集成密钥"
      />
      <IntegrationKeys
        adminIdentities={identities}
        canDelegate={canConsole(context.session, CMS_RESOURCE.USERS, CMS_ACTION.CREATE)}
        credentials={credentials}
        siteOptions={siteOptions}
        viewerIsService={context.session.role === CMS_ROLE.AUTOMATION}
      />
    </div>
  )
}

export default IntegrationsPage
