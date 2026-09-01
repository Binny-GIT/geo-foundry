import Link from "next/link"

import { GeoIcon } from "@/components/branding/GeoIcon"
import { ConsoleResetPasswordForm } from "@/console/components/ConsoleResetPasswordForm"

export const metadata = {
  title: "设置新密码 | Geo Foundry",
}

const ResetPasswordPage = () => (
  <main className="gf-console grid min-h-screen place-items-center px-4 py-8">
    <section className="grid w-full max-w-[440px] gap-7">
      <div className="flex items-center gap-3 px-2">
        <span className="grid size-11 place-items-center rounded-2xl bg-indigo-600 shadow-lg shadow-indigo-500/20">
          <GeoIcon size={25} />
        </span>
        <div>
          <p className="m-0 text-sm font-bold tracking-tight text-[var(--console-ink)]">
            Geo Foundry
          </p>
          <p className="m-0 pt-0.5 text-xs text-[var(--console-ink-muted)]">GF Studio · 账户恢复</p>
        </div>
      </div>
      <section className="gf-console-card p-6 sm:p-8">
        <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-indigo-600">
          账户恢复
        </p>
        <h1 className="m-0 pt-2 text-2xl font-semibold tracking-tight text-[var(--console-ink)]">
          设置新密码
        </h1>
        <p className="m-0 pt-2 text-sm leading-6 text-[var(--console-ink-muted)]">
          请输入符合账户策略的新密码。完成后将安全返回管理中心。
        </p>
        <div className="pt-7">
          <ConsoleResetPasswordForm />
        </div>
        <Link
          className="gf-console-focus mt-5 inline-block text-sm font-semibold text-indigo-700 dark:text-indigo-300"
          href="/admin/login"
        >
          返回登录
        </Link>
      </section>
    </section>
  </main>
)

export default ResetPasswordPage
