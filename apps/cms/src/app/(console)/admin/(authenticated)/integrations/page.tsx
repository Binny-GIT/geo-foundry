import { notFound } from "next/navigation"

import { CMS_ACTION, CMS_RESOURCE } from "@/access/policy"
import { KeyRoundIcon } from "@/components/icons"
import { IntegrationKeys } from "@/console/components/IntegrationKeys"
import { PageHeader } from "@/console/components/PageHeader"
import { requireConsoleContext } from "@/console/lib/console-context.server"
import { canConsole } from "@/console/lib/session.server"
import { listApiCredentials, listAutomationIdentities } from "@/server/repositories/console-reads"

export const metadata = { title: "集成密钥 | Geo Foundry" }

/*
 * 集成密钥管理。权限沿用 users 资源：签发一把密钥等于把一个机器身份交出去，
 * 因此只有 tenant-admin 与 super-admin 能进。
 */
const IntegrationsPage = async () => {
  const context = await requireConsoleContext()
  if (!canConsole(context.session, CMS_RESOURCE.USERS, CMS_ACTION.READ)) notFound()
  const [credentials, identities] = await Promise.all([
    listApiCredentials(context.db, context.scope),
    listAutomationIdentities(context.db, context.scope),
  ])

  return (
    <div className="grid gap-6 [&>*]:min-w-0">
      <PageHeader
        icon={KeyRoundIcon}
        meta={
          <span className="rounded-full border border-[var(--console-border)] bg-[var(--console-surface)] px-3 py-1 text-xs font-semibold text-[var(--console-ink-muted)]">
            仅投稿权限 · 明文只显示一次 · 可随时吊销
          </span>
        }
        title="集成密钥"
      />
      <section className="gf-console-card grid gap-2 p-5 sm:p-6">
        <p className="m-0 text-sm leading-6 text-[var(--console-ink-muted)]">
          集成密钥用于让外部 AI / 自动化工具（n8n、Dify、脚本等）把素材投进
          <strong>稿源收件箱</strong>。持有密钥只能投稿与查看自己投进来的条目，
          <strong>不能把稿源采纳成文章，也不能编辑、流转或发布任何内容</strong>
          —— 采纳与发布始终是工作台里的人工决定。
        </p>
        <p className="m-0 text-sm leading-6 text-[var(--console-ink-muted)]">
          请求头格式：<code>Authorization: users API-Key gfa_…</code>
        </p>
      </section>
      <IntegrationKeys
        canManage={canConsole(context.session, CMS_RESOURCE.USERS, CMS_ACTION.CREATE)}
        credentials={credentials}
        identities={identities}
      />
    </div>
  )
}

export default IntegrationsPage
