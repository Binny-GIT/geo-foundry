/*
 * Payload users auth 路由的兼容接管（login/logout/me）。
 * Cookie、JWT、状态码与响应 envelope 保持兼容；密码/session/用户读取全走
 * Drizzle + compat auth。未迁出的 refresh/forgot/reset 继续由 catch-all 回退。
 */

import { randomUUID } from "node:crypto"

import { z } from "zod"

import { verifyPasswordCompat } from "../auth/compat"
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

export const handleUsersAuthGet = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> => {
  if (slug?.length === 2 && slug[0] === "users" && slug[1] === "me") {
    return handleMe(request)
  }
  return null
}

export const handleUsersAuthPost = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> => {
  if (slug?.length !== 2 || slug[0] !== "users") return null
  if (slug[1] === "login") return handleLogin(request)
  if (slug[1] === "logout") return handleLogout(request)
  return null
}

export const authCookie = { cookieOf, expiredCookie }
