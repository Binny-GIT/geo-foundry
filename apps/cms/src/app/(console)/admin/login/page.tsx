import { GeoIcon } from "@/components/branding/GeoIcon"
import { ConsoleLoginForm } from "@/console/components/ConsoleLoginForm"
import { getConsoleSession } from "@/console/lib/session.server"
import { consoleRoute } from "@/console/lib/resources"
import { redirect } from "next/navigation"

export const metadata = {
  title: "登录 | Geo Foundry",
}

const ConsoleLoginPage = async () => {
  const session = await getConsoleSession()
  if (session !== null) redirect(consoleRoute.dashboard)

  return (
    <main className="gf-console grid min-h-screen place-items-center px-4 py-8">
      <section className="grid w-full max-w-[440px] gap-7">
        <div className="flex items-center gap-3 px-2">
          <span className="grid size-11 place-items-center rounded-2xl bg-indigo-600 shadow-lg shadow-indigo-500/20">
            <GeoIcon size={25} />
          </span>
          <div>
            <p className="m-0 text-sm font-bold tracking-tight text-[var(--console-ink)]">Geo Foundry</p>
            <p className="m-0 pt-0.5 text-xs text-[var(--console-ink-muted)]">GF Studio · 内容运营管理中心</p>
          </div>
        </div>
        <section className="gf-console-card p-6 sm:p-8">
          <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-indigo-600">安全访问</p>
          <h1 className="m-0 pt-2 text-2xl font-semibold tracking-tight text-[var(--console-ink)]">
            登录管理中心
          </h1>
          <p className="m-0 pt-2 text-sm leading-6 text-[var(--console-ink-muted)]">
            使用您的 Geo Foundry 账户管理内容版本、质量审核、发布与分发。
          </p>
          <div className="pt-7">
            <ConsoleLoginForm />
          </div>
        </section>
        <p className="m-0 px-2 text-center text-xs leading-5 text-[var(--console-ink-muted)]">
          所有访问都受会话、租户隔离与服务端权限策略保护。
        </p>
      </section>
    </main>
  )
}

export default ConsoleLoginPage
