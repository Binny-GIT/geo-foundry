"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"

import {
  ChevronDownIcon,
  LayoutGridIcon,
  LogOutIcon,
  PencilIcon,
  UserIcon,
} from "@/components/icons"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export type WorkspaceTopBarSession = {
  readonly email: string
  readonly roleLabel: string
  readonly tenantName: string | null
}

const initialOf = (email: string) => email.slice(0, 1).toUpperCase() || "?"

/*
 * Shared top bar for the Payload-hosted workspace routes. The Payload
 * AppHeader is hidden via nav-layout.css, so this restores the common chrome
 * (brand, back-to-console link, account dropdown) on top of the admin shell.
 * Standard slate palette only — it renders inside the Payload admin Tailwind
 * unit, not the console one.
 */
export const WorkspaceTopBar = ({ session }: { readonly session: WorkspaceTopBarSession }) => {
  const router = useRouter()

  const logout = async () => {
    await fetch("/api/users/logout", { credentials: "same-origin", method: "POST" })
    router.replace("/admin/login")
    router.refresh()
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:px-6">
      <Button asChild size="sm" type="button" variant="secondary">
        <Link href="/admin">
          <LayoutGridIcon size={15} /> 控制台
        </Link>
      </Button>
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-indigo-500/10 text-indigo-600">
          <PencilIcon size={16} />
        </span>
        <h1 className="m-0 min-w-0 truncate text-base font-bold tracking-tight text-slate-900">
          编辑稿件
        </h1>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="账户选项"
          className="flex min-h-9 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-2 pr-2.5 text-slate-900 outline-none transition-colors hover:bg-slate-50"
        >
          <span className="grid size-6 place-items-center rounded-full bg-indigo-500/15 text-xs font-bold text-indigo-600">
            {initialOf(session.email)}
          </span>
          <span className="hidden max-w-[180px] truncate text-sm font-semibold sm:block">
            {session.email}
          </span>
          <ChevronDownIcon size={14} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <div className="grid gap-0.5 px-2.5 py-2">
            <strong className="truncate text-sm font-semibold text-slate-900">
              {session.email}
            </strong>
            <span className="text-xs text-slate-500">
              {session.roleLabel}
              {session.tenantName === null ? "" : ` · 租户：${session.tenantName}`}
            </span>
          </div>
          <div className="my-1 h-px bg-slate-100" />
          <DropdownMenuItem asChild>
            <Link className="flex cursor-pointer items-center gap-2 text-sm" href="/admin/account">
              <UserIcon size={15} /> 账户设置（修改密码）
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="flex cursor-pointer items-center gap-2 text-sm text-rose-600 focus:bg-rose-50 focus:text-rose-700"
            onSelect={() => void logout()}
          >
            <LogOutIcon size={15} /> 退出登录
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
