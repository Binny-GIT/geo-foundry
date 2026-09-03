import { CMS_ROLE } from "@/access/roles"
import ConsoleAccountTabs from "@/console/components/ConsoleAccountTabs"
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

const ConsoleAccountPage = async ({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>
}) => {
  const session = await requireConsoleSession("/admin/account")
  const params = await searchParams
  const tabParam = params["tab"]
  const initialTab =
    tabParam === "password" || (Array.isArray(tabParam) && tabParam.includes("password"))
      ? "password"
      : "profile"
  const role = ROLE_COPY[session.role] ?? {
    detail: "当前会话的服务端角色未提供可用说明。",
    label: session.role,
  }

  return (
    <div className="grid gap-6 [&>*]:min-w-0">
      <PageHeader title="个人与权限" />
      <ConsoleAccountTabs
        email={session.email}
        initialTab={initialTab}
        roleDetail={role.detail}
        roleLabel={role.label}
        tenantLabel={
          session.tenantId === null
            ? "全部租户（跨租户读取）"
            : (session.tenantName ?? `租户 #${String(session.tenantId)}`)
        }
      />
    </div>
  )
}

export default ConsoleAccountPage
