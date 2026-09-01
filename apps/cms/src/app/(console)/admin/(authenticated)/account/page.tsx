import { CMS_ROLE } from "@/access/roles"
import { ShieldCheckIcon, UsersIcon } from "@/components/icons"
import { PageHeader } from "@/console/components/PageHeader"
import { requireConsoleSession } from "@/console/lib/session.server"

const ROLE_COPY: Readonly<Record<string, { readonly detail: string; readonly label: string }>> = {
  [CMS_ROLE.EDITOR]: { detail: "可创建并编辑本租户内容、版本与媒体。", label: "编辑" },
  [CMS_ROLE.PUBLISHER]: { detail: "可查看发布台账，并执行发布、归档与回滚操作。", label: "发布" },
  [CMS_ROLE.REVIEWER]: { detail: "可审核内容版本并查看质量评估证据。", label: "审阅" },
  [CMS_ROLE.SUPER_ADMIN]: { detail: "可跨租户读取运营数据并管理租户与用户。", label: "超级管理员" },
  [CMS_ROLE.TENANT_ADMIN]: { detail: "可管理本租户用户、站点与域名。", label: "租户管理员" },
  [CMS_ROLE.CONTENT_SERVICE]: { detail: "服务身份不应使用人工 Console。", label: "内容服务" },
}

const ConsoleAccountPage = async () => {
  const session = await requireConsoleSession("/admin/account")
  const role = ROLE_COPY[session.role] ?? {
    detail: "当前会话的服务端角色未提供可用说明。",
    label: session.role,
  }

  return (
    <div className="grid gap-6 [&>*]:min-w-0">
      <PageHeader title="个人与权限" />
      <section className="gf-console-card grid gap-5 p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-400/15 dark:text-indigo-300">
            <UsersIcon size={21} />
          </span>
          <div>
            <h2 className="m-0 text-base font-semibold text-[var(--console-ink)]">账户身份</h2>
            <p className="m-0 pt-1 text-sm text-[var(--console-ink-muted)]">
              来自当前 Payload 会话
            </p>
          </div>
        </div>
        <dl className="m-0 grid gap-4 border-t border-[var(--console-border)] pt-5 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--console-ink-muted)]">
              邮箱
            </dt>
            <dd className="m-0 pt-1 text-sm font-medium text-[var(--console-ink)]">
              {session.email}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--console-ink-muted)]">
              所属租户
            </dt>
            <dd className="m-0 pt-1 text-sm font-medium text-[var(--console-ink)]">
              {session.tenantId === null
                ? "全部租户（跨租户读取）"
                : (session.tenantName ?? `租户 #${String(session.tenantId)}`)}
            </dd>
          </div>
        </dl>
      </section>
      <section className="gf-console-card grid gap-4 p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300">
            <ShieldCheckIcon size={21} />
          </span>
          <div>
            <h2 className="m-0 text-base font-semibold text-[var(--console-ink)]">{role.label}</h2>
            <p className="m-0 pt-1 text-sm leading-6 text-[var(--console-ink-muted)]">
              {role.detail}
            </p>
          </div>
        </div>
        <p className="m-0 rounded-xl border border-[var(--console-border)] bg-[var(--console-surface-muted)] p-4 text-sm leading-6 text-[var(--console-ink-muted)]">
          界面上的可见操作仅用于说明权限范围；每一次读取与写入仍会由 Payload
          集合访问策略和工作流端点在服务端再次验证。
        </p>
      </section>
    </div>
  )
}

export default ConsoleAccountPage
