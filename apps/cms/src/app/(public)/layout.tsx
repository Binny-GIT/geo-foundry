import type { ReactNode } from "react"

type LayoutArguments = {
  readonly children: ReactNode
}

const Layout = ({ children }: LayoutArguments) => (
  <html lang="en">
    <body style={{ margin: 0 }}>{children}</body>
  </html>
)

export default Layout
