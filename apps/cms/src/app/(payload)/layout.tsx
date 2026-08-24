import { handleServerFunctions, RootLayout } from "@payloadcms/next/layouts"
import "@payloadcms/next/css"
import "./admin-tailwind.css"
import config from "@payload-config"
import type { ReactNode } from "react"
import type { ServerFunctionClient } from "payload"

import { importMap } from "./admin/importMap"

type LayoutArguments = {
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

const Layout = ({ children }: LayoutArguments) => (
  <RootLayout config={config} importMap={importMap} serverFunction={serverFunction}>
    {children}
  </RootLayout>
)

export default Layout
