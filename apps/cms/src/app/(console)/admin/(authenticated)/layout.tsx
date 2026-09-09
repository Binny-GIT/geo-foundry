import { headers } from "next/headers"
import type { ReactNode } from "react"

import { CMS_ACTION } from "@/access/policy"
import { ConsoleShell } from "@/console/components/ConsoleShell"
import { CONSOLE_NEXT_HEADER, normalizeConsoleNext } from "@/console/lib/console-next"
import {
  CONSOLE_RESOURCES,
  type ConsoleResourceSlug,
  VISIBLE_RESOURCE_SLUGS,
} from "@/console/lib/resources"
import { canConsole, requireConsoleSession } from "@/console/lib/session.server"

const ROLE_LABEL: Readonly<Record<string, string>> = {
  "content-service": "内容服务",
  editor: "编辑",
  publisher: "发布",
  reviewer: "审阅",
  "super-admin": "超级管理员",
  "tenant-admin": "租户管理员",
}

type AuthenticatedLayoutProps = {
  readonly children: ReactNode
}

const AuthenticatedConsoleLayout = async ({ children }: AuthenticatedLayoutProps) => {
  const requestHeaders = await headers()
  const session = await requireConsoleSession(
    normalizeConsoleNext(requestHeaders.get(CONSOLE_NEXT_HEADER)),
  )
  const resources = VISIBLE_RESOURCE_SLUGS.filter((slug): slug is ConsoleResourceSlug => {
    const resource = CONSOLE_RESOURCES[slug].resource
    return resource !== null && canConsole(session, resource, CMS_ACTION.READ)
  })

  return (
    <ConsoleShell
      navigation={{
        resources,
        session: {
          email: session.email,
          roleLabel: ROLE_LABEL[session.role] ?? session.role,
          tenantName: session.tenantName,
        },
      }}
    >
      {children}
    </ConsoleShell>
  )
}

export default AuthenticatedConsoleLayout
