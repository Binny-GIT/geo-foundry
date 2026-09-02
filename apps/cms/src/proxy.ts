import { NextResponse, type NextRequest } from "next/server"

import { CONSOLE_NEXT_HEADER, shouldForwardConsoleNext } from "./console/lib/console-next"

/**
 * Next 16 请求边界：只向认证 Console layout 传递受限的站内返回地址，
 * 不执行认证，也不会访问 Payload 或数据库。
 */
export const proxy = (request: NextRequest): NextResponse => {
  const requestHeaders = new Headers(request.headers)
  requestHeaders.delete(CONSOLE_NEXT_HEADER)

  const next = `${request.nextUrl.pathname}${request.nextUrl.search}`
  if (shouldForwardConsoleNext(next)) requestHeaders.set(CONSOLE_NEXT_HEADER, next)

  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: ["/admin/:path*"],
}
