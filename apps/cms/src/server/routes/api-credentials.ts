/*
 * 集成密钥的 Console 管理端点：列出 / 签发 / 吊销。
 *
 * 两种签发路径：
 * - 自助：任何真人用户（human 身份）不带 userId 即为自己签发，密钥跟
 *   着用户走——用它采集的投稿记 createdById，采纳后文章归属创建者。
 *   权限面由认证层兜底（gfa_ 密钥一律按 automation 角色出 claims），
 *   所以自助签发不放大任何权限，无需 users 资源权限。
 * - 代签：users 资源 create 权限（tenant-admin / super-admin）可为本
 *   租户任意真人或 automation 身份签发。
 *
 * Worker 的 content-service 密钥由 provision-worker-keyring.mjs 管理，
 * 两条路径不交叉，避免一次误操作同时打断外部工具和 Worker。
 */

import { eq } from "drizzle-orm"
import { z } from "zod"

import { CMS_ACTION, CMS_RESOURCE, decideAccess } from "../../access/policy"
import { CMS_ROLE } from "../../access/roles"
import { isCrossTenantClaims } from "../../access/session"
import { authenticateRequest } from "../auth/session"
import { sites } from "../db/entity-schema"
import { ApiCredentialsRepository } from "../repositories/api-credentials"
import { entityScopeOf } from "../repositories/entities"
import { UsersRepository } from "../repositories/users"
import { serverRuntime } from "../runtime"
import { intakeSiteScopeErrorOf } from "./intake-ops"

const issueSchema = z
  .object({
    defaultSiteId: z.coerce.number().int().positive().nullable().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
    name: z.string().trim().min(1).max(200),
    userId: z.coerce.number().int().positive().optional(),
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
  readonly defaultSiteId: number | null
  readonly expiresAt: Date | null
  readonly id: number
  readonly keyPrefix: string
  readonly lastUsedAt: Date | null
  readonly name: string
  readonly revokedAt: Date | null
  readonly userId: number
}) => ({
  createdAt: record.createdAt.toISOString(),
  defaultSiteId: record.defaultSiteId,
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
  const scope = entityScopeOf(auth)
  if (scope === null) return errorJson(403, "CMS_FORBIDDEN")
  const repo = new ApiCredentialsRepository(serverRuntime().db)
  const canListTenant = decideAccess(auth.claims, CMS_RESOURCE.USERS, CMS_ACTION.READ)
  const viewerId = Number(auth.claims.userId)
  /* global 视角（super-admin）见全部；其余按租户取，再按权限决定是否收窄到自己。 */
  const tenantScope = scope.kind === "global" ? null : scope.tenantId
  const records =
    tenantScope === null
      ? await repo.listAll()
      : canListTenant
        ? await repo.listByTenant(tenantScope)
        : (await repo.listByTenant(tenantScope)).filter((row) => row.userId === viewerId)
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
    const id = idOf(slug?.[1])
    if (id === null) return errorJson(400, "API_CREDENTIAL_ID_INVALID")
    const canManageTenant = decideAccess(auth.claims, CMS_RESOURCE.USERS, CMS_ACTION.UPDATE)
    const existing = await repo.findById(id)
    /*
     * 跨租户与别人的密钥一律按「不存在」处理，不泄漏存在性；
     * 自己的密钥自己可吊销（无需 admin 权限）。
     */
    if (
      existing === null ||
      (scope.kind !== "global" && existing.tenantId !== scope.tenantId) ||
      (!canManageTenant && existing.userId !== Number(auth.claims.userId))
    ) {
      return errorJson(404, "API_CREDENTIAL_NOT_FOUND")
    }
    const revoked = await repo.revoke(id)
    if (!revoked) return errorJson(409, "API_CREDENTIAL_ALREADY_REVOKED")
    const updated = await repo.findById(id)
    return updated === null
      ? errorJson(404, "API_CREDENTIAL_NOT_FOUND")
      : json(200, { doc: publicRecord(updated) })
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return errorJson(400, "API_CREDENTIAL_BODY_INVALID")
  }
  const parsed = issueSchema.safeParse(raw)
  if (!parsed.success) return errorJson(400, "API_CREDENTIAL_BODY_INVALID")

  let targetId: number
  if (parsed.data.userId === undefined) {
    /* 自助签发：密钥跟当前真人用户走，权限面已由认证层固定为投稿面。 */
    if (auth.claims.kind !== "user") return errorJson(403, "API_CREDENTIAL_SELF_SERVICE_DENIED")
    if (isCrossTenantClaims(auth.claims)) {
      return errorJson(400, "API_CREDENTIAL_TENANT_SCOPE_REQUIRED")
    }
    targetId = Number(auth.claims.userId)
  } else {
    if (!decideAccess(auth.claims, CMS_RESOURCE.USERS, CMS_ACTION.CREATE)) {
      return errorJson(403, "CMS_FORBIDDEN")
    }
    targetId = parsed.data.userId
  }

  const target = await new UsersRepository(db).findAuthById(targetId)
  if (target === null) return errorJson(404, "API_CREDENTIAL_USER_NOT_FOUND")
  /*
   * 绑定用户必须有租户（密钥认证按 tenant 出 claims）；content-service
   * 的 Worker 密钥不走这里。automation 身份与各真人角色都允许。
   */
  if (target.role === CMS_ROLE.CONTENT_SERVICE) {
    return errorJson(400, "API_CREDENTIAL_ROLE_UNSUPPORTED")
  }
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

  /*
   * 默认站点：不填=无回落；填了必须存在且属于密钥租户（与投稿入口
   * 同一套规则）。跨租户/不存在的站点在签发时就拒，不让坏配置等
   * 到第一次投稿才爆。
   */
  let defaultSiteId: number | null = null
  if (parsed.data.defaultSiteId !== undefined && parsed.data.defaultSiteId !== null) {
    const siteRows = await db
      .select({ tenantId: sites.tenantId })
      .from(sites)
      .where(eq(sites.id, parsed.data.defaultSiteId))
      .limit(1)
    const siteError = intakeSiteScopeErrorOf(siteRows[0]?.tenantId, target.tenantId)
    if (siteError !== null) return errorJson(400, "API_CREDENTIAL_SITE_INVALID")
    defaultSiteId = parsed.data.defaultSiteId
  }

  const issued = await repo.issue({
    configSecret,
    createdById: Number(auth.claims.userId),
    defaultSiteId,
    expiresAt,
    name: parsed.data.name,
    tenantId: target.tenantId,
    userId: target.id,
  })
  /* apiKey 明文仅此一次返回；此后任何接口都不再暴露它。 */
  return json(201, { apiKey: issued.apiKey, doc: publicRecord(issued.record) })
}
