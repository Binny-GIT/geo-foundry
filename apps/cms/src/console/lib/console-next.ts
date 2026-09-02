export const CONSOLE_NEXT_HEADER = "x-gf-console-next"

const INTERNAL_ORIGIN = "http://geo-foundry.internal"
const MAX_CONSOLE_NEXT_LENGTH = 2_048

const hasControlCharacter = (value: string): boolean => /[\u0000-\u001F\u007F]/u.test(value)

const isExcludedConsoleNextPath = (pathname: string): boolean =>
  pathname === "/admin/login" ||
  pathname.startsWith("/admin/login/") ||
  pathname === "/admin/forgot-password" ||
  pathname.startsWith("/admin/forgot-password/") ||
  pathname === "/admin/reset-password" ||
  pathname.startsWith("/admin/reset-password/") ||
  pathname === "/admin/_emergency" ||
  pathname.startsWith("/admin/_emergency/")

const isAdminPath = (pathname: string): boolean =>
  pathname === "/admin" || pathname.startsWith("/admin/")

const safelyDecode = (value: string): string | null => {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

/**
 * 将返回地址限制为同源的人类 Console 路由。Proxy 提供的路径提示和
 * workspace 的显式深链接都会经过这里，调用方不能把登录重定向变成外部跳转。
 */
export const normalizeConsoleNext = (value: string | null | undefined): string => {
  if (
    value === null ||
    value === undefined ||
    value.length === 0 ||
    value.length > MAX_CONSOLE_NEXT_LENGTH ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    hasControlCharacter(value)
  ) {
    return "/admin"
  }

  let parsed: URL
  try {
    parsed = new URL(value, INTERNAL_ORIGIN)
  } catch {
    return "/admin"
  }

  if (parsed.origin !== INTERNAL_ORIGIN || !isAdminPath(parsed.pathname)) return "/admin"

  const decodedPathname = safelyDecode(parsed.pathname)
  if (
    decodedPathname === null ||
    decodedPathname.includes("\\") ||
    hasControlCharacter(decodedPathname) ||
    isExcludedConsoleNextPath(decodedPathname)
  ) {
    return "/admin"
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

/** 仅普通 Console 认证页面需要经 Proxy 转发真实返回地址。 */
export const shouldForwardConsoleNext = (pathname: string): boolean => {
  const normalized = normalizeConsoleNext(pathname)
  return normalized === pathname && !pathname.startsWith("/admin/workspace")
}
