"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { KeyRoundIcon, ShieldCheckIcon, UserIcon } from "@/components/icons"
import ConsolePasswordForm from "@/console/components/ConsolePasswordForm"

/**
 * Account page tabs: profile (identity + role scope) and password change.
 * The active tab mirrors into ?tab= so the header dropdown's 修改密码 entry
 * deep-links straight here and a refresh keeps the operator where they were.
 */
type AccountTab = "profile" | "password"

const TABS: readonly { readonly key: AccountTab; readonly label: string }[] = [
  { key: "profile", label: "个人资料" },
  { key: "password", label: "修改密码" },
]

const ConsoleAccountTabs = ({
  email,
  initialTab,
  roleDetail,
  roleLabel,
  tenantLabel,
}: {
  readonly email: string
  readonly initialTab: AccountTab
  readonly roleDetail: string
  readonly roleLabel: string
  readonly tenantLabel: string
}) => {
  const router = useRouter()
  const [tab, setTab] = useState<AccountTab>(initialTab)

  const switchTab = (next: AccountTab) => {
    setTab(next)
    router.replace(next === "profile" ? "/admin/account" : "/admin/account?tab=password", {
      scroll: false,
    })
  }

  return (
    <div className="grid gap-6 [&>*]:min-w-0">
      <div
        className="gf-console-focus inline-flex w-fit rounded-lg border border-[var(--console-border)] bg-[var(--console-surface-muted)] p-1"
        role="tablist"
      >
        {TABS.map((entry) => (
          <button
            aria-selected={tab === entry.key}
            className={`gf-console-focus cursor-pointer rounded-md px-4 py-1.5 text-sm transition-colors ${
              tab === entry.key
                ? "bg-[var(--console-surface)] font-semibold text-[var(--console-ink)] shadow-sm"
                : "text-[var(--console-ink-muted)] hover:text-[var(--console-ink)]"
            }`}
            key={entry.key}
            onClick={() => switchTab(entry.key)}
            role="tab"
            type="button"
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "profile" ? (
        <>
          <section className="gf-console-card grid gap-5 p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-400/15 dark:text-indigo-300">
                <UserIcon size={21} />
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
                <dd className="m-0 pt-1 text-sm font-medium text-[var(--console-ink)]">{email}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--console-ink-muted)]">
                  所属租户
                </dt>
                <dd className="m-0 pt-1 text-sm font-medium text-[var(--console-ink)]">
                  {tenantLabel}
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
                <h2 className="m-0 text-base font-semibold text-[var(--console-ink)]">
                  {roleLabel}
                </h2>
                <p className="m-0 pt-1 text-sm leading-6 text-[var(--console-ink-muted)]">
                  {roleDetail}
                </p>
              </div>
            </div>
            <p className="m-0 rounded-md border border-[var(--console-border)] bg-[var(--console-surface-muted)] p-4 text-sm leading-6 text-[var(--console-ink-muted)]">
              界面上的可见操作仅用于说明权限范围；每一次读取与写入仍会由 Payload
              集合访问策略和工作流端点在服务端再次验证。
            </p>
          </section>
        </>
      ) : (
        <section className="gf-console-card grid w-full max-w-xl gap-5 p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-400/15 dark:text-indigo-300">
              <KeyRoundIcon size={21} />
            </span>
            <div>
              <h2 className="m-0 text-base font-semibold text-[var(--console-ink)]">修改密码</h2>
              <p className="m-0 pt-1 text-sm text-[var(--console-ink-muted)]">
                需要验证当前密码；修改成功后当前登录保持有效
              </p>
            </div>
          </div>
          <ConsolePasswordForm />
        </section>
      )}
    </div>
  )
}

export default ConsoleAccountTabs
