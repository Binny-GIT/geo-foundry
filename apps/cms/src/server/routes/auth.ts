/*
 * Payload users auth 路由的兼容接管（login/logout/me）。
 * Cookie、JWT、状态码与响应 envelope 保持兼容；密码/session/用户读取全走
 * Drizzle + compat auth。未迁出的 refresh/forgot/reset 继续由 catch-all 回退。
 */

import { randomBytes, randomUUID } from "node:crypto"

import { z } from "zod"

import {
  generatePasswordCredentialsCompat,
  verifyPasswordCompat,
} from "../auth/compat"
import { authenticateRequest } from "../auth/session"
import { UsersRepository, type UserAuthRecord } from "../repositories/users"
import { serverRuntime } from "../runtime"
import { issueCompatSessionToken } from "../../services/auth-compat-probe-model"

const loginSchema = z
  .object({
    email: z.string().trim().min(1).max(254),
    password: z.string().min(1).max(256),
  })
  .passthrough()

const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().min(8).max(200),
  })
  .strict()

const forgotPasswordSchema = z
  .object({ email: z.string().trim().email().max(254) })
  .passthrough()

const resetPasswordSchema = z
  .object({
    password: z.string().min(8).max(200),
    token: z.string().regex(/^[a-f0-9]{40}$/),
  })
  .passthrough()

const json = (status: number, body: unknown, headers?: Headers): Response => {
  const resultHeaders = headers ?? new Headers()
  resultHeaders.set("content-type", "application/json; charset=utf-8")
  return new Response(JSON.stringify(body), { headers: resultHeaders, status })
}

const cookieOf = (token: string, expiresAt: number): string =>
  [
    `payload-token=${token}`,
    `Expires=${new Date(expiresAt * 1000).toUTCString()}`,
    "Path=/",
    "HttpOnly=true",
    "SameSite=Lax",
  ].join("; ")

const expiredCookie = (): string =>
  [
    "payload-token=",
    `Expires=${new Date(Date.now() - 1000).toUTCString()}`,
    "Path=/",
    "HttpOnly=true",
    "SameSite=Lax",
  ].join("; ")

const publicUser = async (
  repository: UsersRepository,
  user: UserAuthRecord,
  options: Readonly<{ loginResponse?: boolean }> = {},
) => ({
  _strategy: "local-jwt",
  apiKey: null,
  collection: "users",
  createdAt: user.createdAt.toISOString(),
  email: user.email,
  enableAPIKey: user.enableAPIToken,
  id: user.id,
  role: user.role,
  sessions: (await repository.activeSessions(user.id)).map((session) => ({
    createdAt: session.createdAt?.toISOString() ?? null,
    expiresAt: session.expiresAt.toISOString(),
    id: session.id,
  })),
  sites: await repository.siteIds(user.id),
  tenant: user.tenantId,
  updatedAt: options.loginResponse === true ? null : user.updatedAt.toISOString(),
})

const LOGIN_ERROR = { errors: [{ message: "提供的电子邮件或密码不正确。" }] } as const

const handleLogin = async (request: Request): Promise<Response> => {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return json(400, { errors: [{ message: "请求正文无效。" }] })
  }
  const parsed = loginSchema.safeParse(raw)
  if (!parsed.success) return json(400, { errors: [{ message: "请求正文无效。" }] })

  const { configSecret, db } = serverRuntime()
  const repository = new UsersRepository(db)
  const user = await repository.findAuthByEmail(parsed.data.email.toLowerCase())
  const dummy = { hash: "0".repeat(1024), salt: "0".repeat(64) }
  const valid = await verifyPasswordCompat(
    parsed.data.password,
    user === null ? dummy : { hash: user.hash ?? "", salt: user.salt ?? "" },
  )
  const locked = user !== null && user.lockUntil !== null && user.lockUntil.getTime() > Date.now()
  if (user === null || !valid || locked) {
    if (user !== null && !locked) await repository.recordLoginFailure(user.id)
    return json(401, LOGIN_ERROR)
  }

  const sid = randomUUID()
  const session = await issueCompatSessionToken({
    configSecret,
    email: user.email,
    sid,
    userId: user.id,
  })
  await repository.createLoginSession(user.id, sid, new Date(session.expiresAt * 1000))
  const headers = new Headers({ "set-cookie": cookieOf(session.token, session.expiresAt) })
  return json(
    200,
    {
      exp: session.expiresAt,
      message: "身份验证通过",
      token: session.token,
      user: await publicUser(repository, user, { loginResponse: true }),
    },
    headers,
  )
}

const handleMe = async (request: Request): Promise<Response> => {
  const auth = await authenticateRequest(request.headers)
  if (auth === null || auth.session === null) {
    return json(200, { message: "账号", user: null })
  }
  const repository = new UsersRepository(serverRuntime().db)
  return json(200, {
    collection: "users",
    exp: auth.session.exp,
    message: "账号",
    strategy: "local-jwt",
    token: auth.session.token,
    user: await publicUser(repository, auth.user),
  })
}

const handleLogout = async (request: Request): Promise<Response> => {
  const auth = await authenticateRequest(request.headers)
  if (auth === null || auth.session === null) {
    return json(400, { errors: [{ message: "No User" }] })
  }
  const allSessions = new URL(request.url).searchParams.get("allSessions") === "true"
  const repository = new UsersRepository(serverRuntime().db)
  if (allSessions) await repository.revokeAllSessions(auth.user.id)
  else await repository.revokeSession(auth.user.id, auth.session.sid)
  const headers = new Headers({ "set-cookie": expiredCookie() })
  return json(200, { message: "成功登出。" }, headers)
}

const handleRefresh = async (request: Request): Promise<Response> => {
  const auth = await authenticateRequest(request.headers)
  if (auth === null || auth.session === null) {
    return json(403, { errors: [{ message: "您无权执行此操作。" }] })
  }
  const { configSecret, db } = serverRuntime()
  const repository = new UsersRepository(db)
  const refreshed = await issueCompatSessionToken({
    configSecret,
    email: auth.user.email,
    sid: auth.session.sid,
    userId: auth.user.id,
  })
  const updated = await repository.refreshSession(
    auth.user.id,
    auth.session.sid,
    new Date(refreshed.expiresAt * 1000),
  )
  if (!updated) return json(403, { errors: [{ message: "您无权执行此操作。" }] })
  const headers = new Headers({ "set-cookie": cookieOf(refreshed.token, refreshed.expiresAt) })
  return json(
    200,
    {
      exp: refreshed.expiresAt,
      message: "令牌刷新成功。",
      refreshedToken: refreshed.token,
      setCookie: true,
      strategy: "local-jwt",
      user: await publicUser(repository, auth.user),
    },
    headers,
  )
}

const handleForgotPassword = async (request: Request): Promise<Response> => {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return json(400, { errors: [{ message: "请求正文无效。" }] })
  }
  const parsed = forgotPasswordSchema.safeParse(raw)
  if (!parsed.success) return json(400, { errors: [{ message: "请求正文无效。" }] })

  const token = randomBytes(20).toString("hex")
  await new UsersRepository(serverRuntime().db).writeResetToken(
    parsed.data.email.toLowerCase(),
    token,
    new Date(Date.now() + 60 * 60 * 1000),
  )
  // 未配置邮件 adapter 时与 Payload 一样不向响应暴露 token；未知邮箱同样 200。
  return json(200, { message: "成功" })
}

const handleResetPassword = async (request: Request): Promise<Response> => {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return json(400, { errors: [{ message: "请求正文无效。" }] })
  }
  const parsed = resetPasswordSchema.safeParse(raw)
  if (!parsed.success) return json(400, { errors: [{ message: "请求正文无效。" }] })

  const { configSecret, db } = serverRuntime()
  const repository = new UsersRepository(db)
  const credentials = await generatePasswordCredentialsCompat(parsed.data.password)
  const sid = randomUUID()
  const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
  const user = await repository.consumeResetToken({
    credentials,
    expiresAt: new Date(expiresAt * 1000),
    sid,
    token: parsed.data.token,
  })
  if (user === null) {
    return json(403, { errors: [{ message: "Token is either invalid or has expired." }] })
  }
  const session = await issueCompatSessionToken({
    configSecret,
    email: user.email,
    expiresAt,
    sid,
    userId: user.id,
  })
  const headers = new Headers({ "set-cookie": cookieOf(session.token, session.expiresAt) })
  return json(
    200,
    {
      message: "密码重置成功。",
      token: session.token,
      user: await publicUser(repository, user),
    },
    headers,
  )
}

const handlePasswordChange = async (request: Request): Promise<Response> => {
  const auth = await authenticateRequest(request.headers)
  if (auth === null || auth.session === null) {
    return json(401, { error: { code: "ACCOUNT_PASSWORD_UNAUTHENTICATED" } })
  }
  if (auth.claims.role === "content-service") {
    return json(403, { error: { code: "ACCOUNT_PASSWORD_ROLE_FORBIDDEN" } })
  }
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return json(400, { error: { code: "ACCOUNT_PASSWORD_BODY_INVALID" } })
  }
  const parsed = passwordChangeSchema.safeParse(raw)
  if (!parsed.success) {
    return json(400, { error: { code: "ACCOUNT_PASSWORD_BODY_INVALID" } })
  }
  const repository = new UsersRepository(serverRuntime().db)
  const valid = await verifyPasswordCompat(parsed.data.currentPassword, {
    hash: auth.user.hash ?? "",
    salt: auth.user.salt ?? "",
  })
  if (!valid) {
    return json(400, { error: { code: "ACCOUNT_PASSWORD_CURRENT_INVALID" } })
  }
  const credentials = await generatePasswordCredentialsCompat(parsed.data.newPassword)
  const updated = await repository.updatePasswordHash(auth.user.id, credentials)
  return updated
    ? json(200, { ok: true })
    : json(500, { error: { code: "ACCOUNT_PASSWORD_UPDATE_FAILED" } })
}

export type CompatAuthRoute =
  | "account-password"
  | "forgot-password"
  | "login"
  | "logout"
  | "me"
  | "refresh"
  | "reset-password"

export const compatAuthRouteOf = (
  method: "GET" | "POST",
  slug: readonly string[] | undefined,
): CompatAuthRoute | null => {
  if (slug?.length !== 2) return null
  if (method === "GET" && slug[0] === "users" && slug[1] === "me") return "me"
  if (method !== "POST") return null
  if (slug[0] === "account" && slug[1] === "password") return "account-password"
  if (slug[0] !== "users") return null
  if (slug[1] === "forgot-password") return "forgot-password"
  if (slug[1] === "login") return "login"
  if (slug[1] === "logout") return "logout"
  if (slug[1] === "refresh-token") return "refresh"
  if (slug[1] === "reset-password") return "reset-password"
  return null
}

export const handleUsersAuthGet = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> =>
  compatAuthRouteOf("GET", slug) === "me" ? handleMe(request) : null

export const handleUsersAuthPost = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> => {
  switch (compatAuthRouteOf("POST", slug)) {
    case "forgot-password":
      return handleForgotPassword(request)
    case "login":
      return handleLogin(request)
    case "logout":
      return handleLogout(request)
    case "refresh":
      return handleRefresh(request)
    case "reset-password":
      return handleResetPassword(request)
    default:
      return null
  }
}

export const handleAccountAuthPost = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> =>
  compatAuthRouteOf("POST", slug) === "account-password"
    ? handlePasswordChange(request)
    : null

export const authCookie = { cookieOf, expiredCookie }
