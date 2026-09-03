import type { ComponentType } from "react"

import {
  ChartBarIcon,
  FilePlusIcon,
  InboxIcon,
  LayersIcon,
  LinkIcon,
  PackageIcon,
  PencilIcon,
  UserIcon,
} from "@/components/icons"
import {
  CONSOLE_RESOURCES,
  type ConsoleResourceSlug,
} from "@/console/lib/resources"

export type TopbarPage = {
  readonly icon: ComponentType<{ readonly size?: number }>
  readonly label: string
}

/*
 * Topbar page identity: the shared header carries the current page's icon +
 * name (its h1), so in-page headers stay lean. Static routes are listed
 * explicitly; /admin/collections/* derives from the resource registry with
 * create/edit suffixes.
 */
const STATIC_PAGES: readonly { readonly href: string; readonly page: TopbarPage }[] = [
  { href: "/admin/work/editions/", page: { icon: PencilIcon, label: "编辑稿件" } },
  { href: "/admin/work/operations/", page: { icon: PackageIcon, label: "操作详情" } },
  { href: "/admin/work", page: { icon: LayersIcon, label: "工作台" } },
  { href: "/admin/inbox", page: { icon: InboxIcon, label: "稿源收件箱" } },
  { href: "/admin/account", page: { icon: UserIcon, label: "个人与权限" } },
  { href: "/admin/api-stats", page: { icon: ChartBarIcon, label: "接口统计" } },
  { href: "/admin/integration-docs", page: { icon: LinkIcon, label: "接入文档" } },
]

const COLLECTIONS_PREFIX = "/admin/collections/"

export const topbarPageOf = (
  pathname: string,
  fallback: TopbarPage,
): TopbarPage => {
  if (pathname === "/admin") return fallback
  for (const entry of STATIC_PAGES) {
    if (pathname === entry.href || pathname.startsWith(`${entry.href}/`)) return entry.page
  }
  if (pathname.startsWith(COLLECTIONS_PREFIX)) {
    const segments = pathname
      .slice(COLLECTIONS_PREFIX.length)
      .split("/")
      .filter((segment) => segment.length > 0)
    const joined = segments.join("/")
    if (joined === "media/upload") return { icon: FilePlusIcon, label: "上传媒体" }
    if (joined === "rollback-intents/create")
      return { icon: PackageIcon, label: "创建回滚意图" }
    const resource = CONSOLE_RESOURCES[segments[0] as ConsoleResourceSlug]
    if (resource !== undefined) {
      if (segments[1] === "create") return { icon: resource.icon, label: `新建${resource.label.zh}` }
      if (segments[2] === "edit") return { icon: resource.icon, label: `编辑${resource.label.zh}` }
      if (segments[1] !== undefined && /^\d+$/.test(segments[1]))
        return { icon: resource.icon, label: `${resource.label.zh}详情` }
      return { icon: resource.icon, label: resource.label.zh }
    }
  }
  return fallback
}
