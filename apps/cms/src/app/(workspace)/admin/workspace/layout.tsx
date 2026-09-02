import { handleServerFunctions, RootLayout } from "@payloadcms/next/layouts"
import "@payloadcms/next/css"
import config from "@payload-config"
import Script from "next/script"
import type { ServerFunctionClient } from "payload"
import type { ReactNode } from "react"
import { importMap } from "../../../(payload)/admin/importMap"

import "../../../(payload)/admin-theme.css"
import "../../../(payload)/admin-tailwind.css"

import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { requireConsoleSession } from "@/console/lib/session.server"

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

const WorkspaceLayout = async ({ children }: { readonly children: ReactNode }) => {
  const session = await requireConsoleSession()
  return (
    <>
      <PayloadLanguageBootstrap />
      <RootLayout config={config} importMap={importMap} serverFunction={serverFunction}>
        <WorkspaceTopBar
          session={{
            email: session.email,
            roleLabel: ROLE_LABEL[session.role] ?? session.role,
            tenantName: session.tenantName,
          }}
        />
        {children}
      </RootLayout>
    </>
  )
}

export default WorkspaceLayout
