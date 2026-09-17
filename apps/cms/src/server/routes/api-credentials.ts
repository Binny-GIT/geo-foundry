/*
 * 集成密钥的 Console 管理端点：列出 / 签发 / 吊销。
 *
 * 权限沿用 users 资源（签发密钥本质是管理一个机器身份），因此只有
 * tenant-admin 与 super-admin 可用。密钥明文只在签发响应里出现一次。
 *
 * 只签发给 automation 身份：Worker 的 content-service 密钥由
 * provision-worker-keyring.mjs 管理，两条路径不交叉，避免一次误操作
 * 同时打断外部工具和 Worker。
 */

import { z } from "zod"

import { CMS_ACTION, CMS_RESOURCE, decideAccess } from "../../access/policy"
import { CMS_ROLE } from "../../access/roles"
import { authenticateRequest } from "../auth/session"
import { ApiCredentialsRepository } from "../repositories/api-credentials"
import { entityScopeOf } from "../repositories/entities"
import { UsersRepository } from "../repositories/users"
import { serverRuntime } from "../runtime"

const issueSchema = z
  .object({
    expiresAt: z.string().datetime().nullable().optional(),
    name: z.string().trim().min(1).max(200),
    userId: z.coerce.number().int().positive(),
  })
  .strict()

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  })

const errorJson = (status: number, code: string): Response =>
  json(status, { error: { code }, errors: [{ message: code }] })

const idOf = (value: string | undefined): number | null =>
  value !== undefined && /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : null

const publicRecord = (record: {
  readonly createdAt: Date
  readonly expiresAt: Date | null
  readonly id: number
  readonly keyPrefix: string
  readonly lastUsedAt: Date | null
  readonly name: string
  readonly revokedAt: Date | null
  readonly userId: number
}) => ({
  createdAt: record.createdAt.toISOString(),
  expiresAt: record.expiresAt === null ? null : record.expiresAt.toISOString(),
  id: record.id,
  keyPrefix: record.keyPrefix,
  lastUsedAt: record.lastUsedAt === null ? null : record.lastUsedAt.toISOString(),
  name: record.name,
  revokedAt: record.revokedAt === null ? null : record.revokedAt.toISOString(),
  status:
    record.revokedAt !== null ? "revoked" : expiredOf(record.expiresAt) ? "expired" : "active",
  userId: record.userId,
})

const expiredOf = (expiresAt: Date | null): boolean =>
  expiresAt !== null && expiresAt.getTime() <= Date.now()

export const handleApiCredentialGet = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> => {
  if (slug?.length !== 1 || slug[0] !== "api-credentials") return null
  const auth = await authenticateRequest(request.headers)
  if (auth === null) return errorJson(401, "CMS_UNAUTHENTICATED")
  if (!decideAccess(auth.claims, CMS_RESOURCE.USERS, CMS_ACTION.READ)) {
    return errorJson(403, "CMS_FORBIDDEN")
  }
  const scope = entityScopeOf(auth)
  if (scope === null) return errorJson(403, "CMS_FORBIDDEN")
  const repo = new ApiCredentialsRepository(serverRuntime().db)
  const records =
    scope.kind === "global" ? await repo.listAll() : await repo.listByTenant(scope.tenantId)
  return json(200, { docs: records.map(publicRecord), totalDocs: records.length })
}

export const handleApiCredentialPost = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> => {
  const isIssue = slug?.length === 1 && slug[0] === "api-credentials"
  const isRevoke = slug?.length === 3 && slug[0] === "api-credentials" && slug[2] === "revoke"
  if (!isIssue && !isRevoke) return null

  const auth = await authenticateRequest(request.headers)
  if (auth === null) return errorJson(401, "CMS_UNAUTHENTICATED")
  const scope = entityScopeOf(auth)
  if (scope === null) return errorJson(403, "CMS_FORBIDDEN")
  const { configSecret, db } = serverRuntime()
  const repo = new ApiCredentialsRepository(db)

  if (isRevoke) {
    if (!decideAccess(auth.claims, CMS_RESOURCE.USERS, CMS_ACTION.UPDATE)) {
      return errorJson(403, "CMS_FORBIDDEN")
    }
    const id = idOf(slug?.[1])
    if (id === null) return errorJson(400, "API_CREDENTIAL_ID_INVALID")
    const existing = await repo.findById(id)
    /* 跨租户一律按「不存在」处理，不泄漏他租户密钥的存在性。 */
    if (existing === null || (scope.kind !== "global" && existing.tenantId !== scope.tenantId)) {
      return errorJson(404, "API_CREDENTIAL_NOT_FOUND")
    }
    const revoked = await repo.revoke(id)
    if (!revoked) return errorJson(409, "API_CREDENTIAL_ALREADY_REVOKED")
    const updated = await repo.findById(id)
    return updated === null
      ? errorJson(404, "API_CREDENTIAL_NOT_FOUND")
      : json(200, { doc: publicRecord(updated) })
  }

  if (!decideAccess(auth.claims, CMS_RESOURCE.USERS, CMS_ACTION.CREATE)) {
    return errorJson(403, "CMS_FORBIDDEN")
  }
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return errorJson(400, "API_CREDENTIAL_BODY_INVALID")
  }
  const parsed = issueSchema.safeParse(raw)
  if (!parsed.success) return errorJson(400, "API_CREDENTIAL_BODY_INVALID")

  const target = await new UsersRepository(db).findAuthById(parsed.data.userId)
  if (target === null) return errorJson(404, "API_CREDENTIAL_USER_NOT_FOUND")
  if (target.role !== CMS_ROLE.AUTOMATION) return errorJson(400, "API_CREDENTIAL_ROLE_UNSUPPORTED")
  if (target.tenantId === null) return errorJson(400, "API_CREDENTIAL_USER_TENANT_INVALID")
  if (scope.kind !== "global" && target.tenantId !== scope.tenantId) {
    return errorJson(403, "API_CREDENTIAL_TENANT_SCOPE_DENIED")
  }

  const expiresAt =
    parsed.data.expiresAt === undefined || parsed.data.expiresAt === null
      ? null
      : new Date(parsed.data.expiresAt)
  if (expiresAt !== null && expiresAt.getTime() <= Date.now()) {
    return errorJson(400, "API_CREDENTIAL_EXPIRY_INVALID")
  }

  const issued = await repo.issue({
    configSecret,
    createdById: Number(auth.claims.userId),
    expiresAt,
    name: parsed.data.name,
    tenantId: target.tenantId,
    userId: target.id,
  })
  /* apiKey 明文仅此一次返回；此后任何接口都不再暴露它。 */
  return json(201, { apiKey: issued.apiKey, doc: publicRecord(issued.record) })
}
