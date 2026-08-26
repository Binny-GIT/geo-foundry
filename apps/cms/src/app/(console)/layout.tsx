import type { ReactNode } from "react"

import "./console.css"

// Every Console page resolves the current Payload session from HTTP-only
// cookies. It must never be prerendered against the build-time database.
export const dynamic = "force-dynamic"

type LayoutProps = {
  readonly children: ReactNode
}

const ConsoleRootLayout = ({ children }: LayoutProps) => (
  <html lang="zh-CN" suppressHydrationWarning>
    <body style={{ margin: 0 }}>{children}</body>
  </html>
)

export default ConsoleRootLayout
