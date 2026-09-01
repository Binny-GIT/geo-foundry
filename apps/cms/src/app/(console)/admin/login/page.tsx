import { redirect } from "next/navigation"
import { GeoIcon } from "@/components/branding/GeoIcon"
import { ConsoleLoginForm } from "@/console/components/ConsoleLoginForm"
import { consoleRoute } from "@/console/lib/resources"
import { getConsoleSession, isHumanConsoleSession } from "@/console/lib/session.server"

export const metadata = {
  title: "登录 | Geo Foundry",
}

const ConsoleLoginPage = async () => {
  const session = await getConsoleSession()
  // 服务身份使用租户 API Key，而非人工 Console 会话；将其跳至 /admin
  // 会被页面守卫送回这里，形成重定向循环。
  if (isHumanConsoleSession(session)) redirect(consoleRoute.dashboard)

  return (
    <main
      className="gf-console relative grid min-h-screen place-items-center overflow-hidden px-4 py-8"
      style={{
        backgroundImage:
          "radial-gradient(circle at 82% -8%, rgb(99 102 241 / 13%), transparent 30rem), radial-gradient(circle at -12% 108%, rgb(16 185 129 / 9%), transparent 26rem)",
      }}
    >
      <section className="relative grid w-full max-w-[440px] gap-7">
        <div className="flex items-center gap-3 px-2">
          <span className="grid size-11 place-items-center rounded-2xl bg-indigo-600 shadow-lg shadow-indigo-500/25">
            <GeoIcon size={25} />
          </span>
          <div>
            <p className="m-0 text-sm font-bold tracking-tight text-[var(--console-ink)]">
              Geo Foundry
            </p>
            <p className="m-0 pt-0.5 text-xs text-[var(--console-ink-muted)]">
              GF Studio · 内容运营管理中心
            </p>
          </div>
        </div>
        <section className="gf-console-card p-6 shadow-2xl shadow-indigo-950/10 sm:p-8">
          <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-indigo-600">
            安全访问
          </p>
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
