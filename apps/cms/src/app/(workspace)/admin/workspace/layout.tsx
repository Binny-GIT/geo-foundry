import { handleServerFunctions, RootLayout } from "@payloadcms/next/layouts"
import "@payloadcms/next/css"
import config from "@payload-config"
import Script from "next/script"
import type { ServerFunctionClient } from "payload"
import type { ReactNode } from "react"
import { importMap } from "../../../(payload)/admin/importMap"

import "../../../(payload)/admin-theme.css"
import "../../../(payload)/admin-tailwind.css"
import "./workspace-chrome.css"

import { CMS_ACTION } from "@/access/policy"
import { ConsoleShell } from "@/console/components/ConsoleShell"
import {
  CONSOLE_RESOURCES,
  type ConsoleResourceSlug,
  VISIBLE_RESOURCE_SLUGS,
} from "@/console/lib/resources"
import { canConsole, requireConsoleSession } from "@/console/lib/session.server"

const serverFunction: ServerFunctionClient = async (arguments_) => {
  "use server"
  return handleServerFunctions({ ...arguments_, config, importMap })
}

const PayloadLanguageBootstrap = () => (
  <Script id="payload-language-bootstrap" strategy="beforeInteractive">
    {`if (!document.cookie.split('; ').some((row) => row.startsWith('payload-lng='))) document.cookie = 'payload-lng=zh; path=/; SameSite=Lax'`}
  </Script>
)

const ROLE_LABEL: Readonly<Record<string, string>> = {
  "content-service": "内容服务",
  editor: "编辑",
  publisher: "发布",
  reviewer: "审阅",
  "super-admin": "超级管理员",
  "tenant-admin": "租户管理员",
}

/*
 * The workspace tree shares the console shell (sidebar + top bar + main) so
 * editor routes look identical to the rest of the admin. Payload's
 * DefaultTemplate still renders underneath for the admin views themselves —
 * its own sidebar/nav chrome is hidden via workspace-chrome.css.
 */
const WorkspaceLayout = async ({ children }: { readonly children: ReactNode }) => {
  const session = await requireConsoleSession()
  const resources = VISIBLE_RESOURCE_SLUGS.filter((slug): slug is ConsoleResourceSlug => {
    const resource = CONSOLE_RESOURCES[slug].resource
    return resource !== null && canConsole(session, resource, CMS_ACTION.READ)
  })
  return (
    <>
      <PayloadLanguageBootstrap />
      <RootLayout config={config} importMap={importMap} serverFunction={serverFunction}>
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
          {/*
           * -m-4 cancels the console main's p-4: the Payload views inside carry
           * their own gutters and the edition editor assumes it sits flush
           * under the 56px top bar (min-h calc(100vh-3.5rem), sticky top-14).
           */}
          <div className="gf-workspace-host -m-4 [&>*]:min-w-0">{children}</div>
        </ConsoleShell>
      </RootLayout>
    </>
  )
}

export default WorkspaceLayout
