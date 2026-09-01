import { handleServerFunctions, RootLayout } from "@payloadcms/next/layouts"
import "@payloadcms/next/css"
import config from "@payload-config"
import Script from "next/script"
import type { ServerFunctionClient } from "payload"
import type { ReactNode } from "react"
import { importMap } from "../../../(payload)/admin/importMap"

import "../../../(payload)/admin-theme.css"
import "../../../(payload)/admin-tailwind.css"

const serverFunction: ServerFunctionClient = async (arguments_) => {
  "use server"
  return handleServerFunctions({ ...arguments_, config, importMap })
}

const PayloadLanguageBootstrap = () => (
  <Script id="payload-language-bootstrap" strategy="beforeInteractive">
    {`if (!document.cookie.split('; ').some((row) => row.startsWith('payload-lng='))) document.cookie = 'payload-lng=zh; path=/; SameSite=Lax'`}
  </Script>
)

const WorkspaceLayout = ({ children }: { readonly children: ReactNode }) => (
  <>
    <PayloadLanguageBootstrap />
    <RootLayout config={config} importMap={importMap} serverFunction={serverFunction}>
      {children}
    </RootLayout>
  </>
)

export default WorkspaceLayout
