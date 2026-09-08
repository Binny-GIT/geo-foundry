/*
 * 影子认证端点（批次 4 认证切换的实战演练）：
 * 完全不经过 Payload 的 auth 管线，用「users 仓储 + 认证兼容层」完成
 * 登录验证与会话解析。不设置 cookie、不写库——与 Payload login 并行
 * 运行，用于在生产链路上证明兼容层可用，切换时按此形态接管正式路由。
 */

import { randomUUID } from "node:crypto"
import type { Pool } from "pg"
import type { Endpoint, PayloadRequest } from "payload"
import { z } from "zod"

import { parseCmsEnvironment } from "../config/environment"
import {
  payloadSigningKeyOf,
  verifyPasswordCompat,
  verifySessionTokenCompat,
} from "../server/auth/compat"
import { createServerDb } from "../server/db/client"
import { AuthenticationError } from "../server/errors"
import { UsersRepository } from "../server/repositories/users"
import {
  issueCompatSessionToken,
  LOGIN_REJECTED_BODY,
} from "../services/auth-compat-probe-model"

const TOKEN_COOKIE = "payload-token"

const loginBodySchema = z
  .object({
    email: z.string().trim().min(3).max(254),
    password: z.string().min(1).max(256),
  })
  .strict()

const response = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  })

/* 惰性解析环境与连接池：build 进程 import 本模块时不读凭据文件。 */
let pool: Pool | null = null
let cachedEnv: { configSecret: string; connectionString: string } | null = null

const envOf = (): { configSecret: string; connectionString: string } => {
  cachedEnv ??= (() => {
    const env = parseCmsEnvironment(process.env)
    return {
      configSecret: env.payloadSecret,
      connectionString: env.postgres.connectionString,
    }
  })()
  return cachedEnv
}

const repoOf = (connectionString: string): UsersRepository => {
  const { Pool: PgPool } = require("pg") as typeof import("pg")
  pool ??= new PgPool({ connectionString, max: 4 })
  return new UsersRepository(createServerDb(pool))
}

const publicUserOf = (user: {
  readonly email: string
  readonly id: number
  readonly role: string
  readonly tenantId: number | null
}) => ({ email: user.email, id: user.id, role: user.role, tenantId: user.tenantId })

/** GET：用兼容层解析 payload-token cookie，识别当前身份（读路径演练）。 */
export const authCompatSessionGetEndpoint: Endpoint = {
  handler: async (req: PayloadRequest): Promise<Response> => {
    const cookieHeader = req.headers.get("cookie") ?? ""
    const token = cookieHeader
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${TOKEN_COOKIE}=`))
      ?.slice(TOKEN_COOKIE.length + 1)
    if (token === undefined) {
      return response(401, { error: { code: "AUTH_PROBE_TOKEN_MISSING" } })
    }
    const { configSecret, connectionString } = envOf()
    const claims = await verifySessionTokenCompat(token, configSecret)
    if (claims === null || typeof claims["id"] !== "number") {
      return response(401, { error: { code: "AUTH_PROBE_TOKEN_INVALID" } })
    }
    const user = await repoOf(connectionString).findAuthById(claims["id"])
    if (user === null) {
      return response(401, { error: { code: "AUTH_PROBE_TOKEN_INVALID" } })
    }
    return response(200, {
      claims: { collection: claims["collection"], exp: claims.exp, id: claims["id"], sid: claims["sid"] },
      strategy: "compat",
      user: publicUserOf(user),
    })
  },
  method: "get",
  path: "/auth-compat/session",
}

/** POST：登录验证全链走仓储 + 兼容层（写路径演练；不设 cookie）。 */
export const authCompatSessionPostEndpoint: Endpoint = {
  handler: async (req: PayloadRequest): Promise<Response> => {
    let raw: unknown
    try {
      raw = await req.json?.()
    } catch {
      return response(400, { error: { code: "AUTH_PROBE_BODY_INVALID" } })
    }
    const parsed = loginBodySchema.safeParse(raw)
    if (!parsed.success) return response(400, { error: { code: "AUTH_PROBE_BODY_INVALID" } })

    const { configSecret, connectionString } = envOf()
    const repo = repoOf(connectionString)
    const user = await repo.findAuthByEmail(parsed.data.email)
    /* 无论用户是否存在都执行一次校验，避免时序侧信道泄露账号存在性。 */
    const dummy = { hash: "0".repeat(1024), salt: "0".repeat(64) }
    const passwordOk = await verifyPasswordCompat(
      parsed.data.password,
      user === null ? dummy : { hash: user.hash ?? "", salt: user.salt ?? "" },
    )
    if (user === null || !passwordOk) {
      return response(401, LOGIN_REJECTED_BODY)
    }
    if (user.lockUntil !== null && user.lockUntil.getTime() > Date.now()) {
      return response(423, { error: { code: "AUTH_PROBE_ACCOUNT_LOCKED" } })
    }
    const session = await issueCompatSessionToken({
      configSecret,
      email: user.email,
      sid: randomUUID(),
      userId: user.id,
    })
    return response(200, {
      expiresAt: session.expiresAt,
      strategy: "compat",
      token: session.token,
      user: publicUserOf(user),
    })
  },
  method: "post",
  path: "/auth-compat/session",
}
