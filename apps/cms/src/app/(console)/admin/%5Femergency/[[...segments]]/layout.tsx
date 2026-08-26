import { handleServerFunctions, RootLayout } from "@payloadcms/next/layouts"
import "@payloadcms/next/css"
import type { ReactNode } from "react"
import type { ServerFunctionClient } from "payload"

import { importMap } from "../../../../(payload)/admin/importMap"
import config from "@payload-config"

import "../../../../(payload)/admin-theme.css"
import "../../../../(payload)/admin-tailwind.css"

type EmergencyLayoutProps = {
  readonly children: ReactNode
}

const serverFunction: ServerFunctionClient = async (arguments_) => {
  "use server"
  return handleServerFunctions({
    ...arguments_,
    config,
    importMap,
  })
}

const EmergencyLayout = ({ children }: EmergencyLayoutProps) => (
  <RootLayout config={config} importMap={importMap} serverFunction={serverFunction}>
    {children}
  </RootLayout>
)

export default EmergencyLayout
