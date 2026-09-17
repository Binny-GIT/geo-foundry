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
  const [credentials, identities] = await Promise.all([
    canListTenant
      ? listApiCredentials(context.db, context.scope)
      : listMyApiCredentials(context.db, Number(context.session.id)),
    canListTenant
      ? listAutomationIdentities(context.db, context.scope)
      : Promise.resolve([] as readonly Record<string, unknown>[]),
  ])

  return (
    <div className="grid gap-6 [&>*]:min-w-0">
      <PageHeader
        icon={KeyRoundIcon}
        meta={
          <span className="rounded-full border border-[var(--console-border)] bg-[var(--console-surface)] px-3 py-1 text-xs font-semibold text-[var(--console-ink-muted)]">
            仅投稿权限 · 采集归属创建者 · 明文只显示一次 · 可随时吊销
          </span>
        }
        title="集成密钥"
      />
      <section className="gf-console-card grid gap-2 p-5 sm:p-6">
        <p className="m-0 text-sm leading-6 text-[var(--console-ink-muted)]">
          集成密钥用于让外部 AI / 自动化工具（n8n、Dify、脚本等）把素材投进
          <strong>稿源收件箱</strong>。密钥跟创建者走：用它投稿的条目记在你的名下，
          <strong>采纳成文章后作者归属是你，并标注「AI 生成」来源</strong>。持有密钥只能投稿，
          <strong>不能把稿源采纳成文章，也不能编辑、流转或发布任何内容</strong>
          —— 采纳与发布始终是工作台里的人工决定。
        </p>
        <p className="m-0 text-sm leading-6 text-[var(--console-ink-muted)]">
          请求头格式：<code>Authorization: users API-Key gfa_…</code>
        </p>
      </section>
      <IntegrationKeys
        adminIdentities={identities}
        canDelegate={canConsole(context.session, CMS_RESOURCE.USERS, CMS_ACTION.CREATE)}
        credentials={credentials}
        viewerIsService={context.session.role === CMS_ROLE.AUTOMATION}
      />
    </div>
  )
}

export default IntegrationsPage
