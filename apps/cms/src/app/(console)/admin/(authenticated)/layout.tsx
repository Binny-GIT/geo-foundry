import type { ReactNode } from "react"
import Script from "next/script"

import { CMS_ACTION, CMS_RESOURCE } from "@/access/policy"
import { ConsoleShell } from "@/console/components/ConsoleShell"
import {
  CONSOLE_RESOURCES,
  VISIBLE_RESOURCE_SLUGS,
  type ConsoleResourceSlug,
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
  const session = await requireConsoleSession()
  const resources = VISIBLE_RESOURCE_SLUGS.filter((slug): slug is ConsoleResourceSlug => {
    const resource = CONSOLE_RESOURCES[slug].resource
    return resource !== null && canConsole(session, resource, CMS_ACTION.READ)
  })

  return (
    <>
      {/* Keep Payload i18n aligned with the SSR zh fallback before any jump
          into the emergency tree; same bootstrap as workspace/_emergency. */}
      <Script id="payload-language-bootstrap" strategy="beforeInteractive">
        {`if (!document.cookie.split('; ').some((row) => row.startsWith('payload-lng='))) document.cookie = 'payload-lng=zh; path=/; SameSite=Lax'`}
      </Script>
      <ConsoleShell
        navigation={{
          canReadInbox: canConsole(session, CMS_RESOURCE.INTAKE_ITEMS, CMS_ACTION.READ),
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
    </>
  )
}

export default AuthenticatedConsoleLayout
