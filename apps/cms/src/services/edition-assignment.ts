import type { Payload } from "payload"

import { resolveSessionClaims } from "../access/session"

export class EditionAssignmentError extends Error {
  override readonly name = "EditionAssignmentError"

  constructor(readonly code: string) {
    super(code)
  }
}

const fail = (code: string): EditionAssignmentError => new EditionAssignmentError(code)

const idOf = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value
  if (typeof value === "object" && value !== null)
    return idOf((value as Record<string, unknown>)["id"])
  return null
}

/** 站点改派只允许在进入编译前的状态：编译产物与线上 URL 均按站点生成。 */
const SITE_REASSIGNABLE_STATUSES = ["draft", "generating", "review", "approved"] as const

export type EditionAssignmentInput = {
  readonly editionId: number
  /** 传 null 表示清空负责人；不传表示保持不变。 */
  readonly owner?: number | null
  readonly site?: number
  /** 多站点分配；发布链路的主站点 site 自动取所选站点第一个。 */
  readonly sites?: readonly number[]
  readonly user: unknown
}

/**
 * 运营分配操作：改派负责人与所属站点。写走集合 Local API（hooks 仍会校验
 * owner 租户一致性），权限按"分配属运营管理而非内容编辑"放宽到
 * editor/tenant-admin/super-admin——与站点变体端点同一基线。
 */
export const applyEditionAssignment = async (
  payload: Payload,
  input: EditionAssignmentInput,
): Promise<{
  readonly editionId: number
  readonly owner?: number | null
  readonly site?: number
}> => {
  const claims = resolveSessionClaims(input.user)
  if (
    claims === null ||
    claims.kind !== "user" ||
    (claims.role !== "editor" && claims.role !== "tenant-admin" && claims.role !== "super-admin")
  ) {
    throw fail("EDITION_ASSIGNMENT_FORBIDDEN")
  }

  const edition = await payload
    .findByID({
      collection: "content-editions",
      depth: 0,
      draft: true,
      id: input.editionId,
      overrideAccess: true,
    })
    .catch(() => null)
  if (edition === null) throw fail("EDITION_ASSIGNMENT_NOT_FOUND")

  const editionTenantId = idOf(edition.tenant)
  if (claims.role !== "super-admin") {
    if (
      claims.tenantId === null ||
      editionTenantId === null ||
      String(claims.tenantId) !== String(editionTenantId)
    ) {
      throw fail("EDITION_ASSIGNMENT_TENANT_MISMATCH")
    }
  }

  const data: Record<string, unknown> = {}

  if (input.owner !== undefined) {
    if (input.owner === null) {
      data["owner"] = null
    } else {
      const owner = await payload
        .findByID({
          collection: "users",
          depth: 0,
          id: input.owner,
          overrideAccess: true,
        })
        .catch(() => null)
      if (owner === null) throw fail("EDITION_ASSIGNMENT_OWNER_NOT_FOUND")
      if (owner.role === "content-service") throw fail("EDITION_ASSIGNMENT_OWNER_INVALID")
      if (
        editionTenantId !== null &&
        idOf(owner.tenant) !== null &&
        String(idOf(owner.tenant)) !== String(editionTenantId)
      ) {
        throw fail("EDITION_ASSIGNMENT_OWNER_TENANT_MISMATCH")
      }
      data["owner"] = input.owner
    }
  }

  if (input.site !== undefined) {
    if (!SITE_REASSIGNABLE_STATUSES.includes(edition.workflowStatus as never)) {
      throw fail("EDITION_ASSIGNMENT_SITE_LOCKED")
    }
    const site = await payload
      .findByID({
        collection: "sites",
        depth: 0,
        id: input.site,
        overrideAccess: true,
      })
      .catch(() => null)
    if (site === null) throw fail("EDITION_ASSIGNMENT_SITE_NOT_FOUND")
    if (
      editionTenantId !== null &&
      idOf(site.tenant) !== null &&
      String(idOf(site.tenant)) !== String(editionTenantId)
    ) {
      throw fail("EDITION_ASSIGNMENT_SITE_TENANT_MISMATCH")
    }
    data["site"] = input.site
  }

  if (input.sites !== undefined) {
    const assigned: number[] = []
    for (const siteId of input.sites) {
      if (assigned.includes(siteId)) continue
      const site = await payload
        .findByID({
          collection: "sites",
          depth: 0,
          id: siteId,
          overrideAccess: true,
        })
        .catch(() => null)
      if (site === null) throw fail("EDITION_ASSIGNMENT_SITE_NOT_FOUND")
      if (
        editionTenantId !== null &&
        idOf(site.tenant) !== null &&
        String(idOf(site.tenant)) !== String(editionTenantId)
      ) {
        throw fail("EDITION_ASSIGNMENT_SITE_TENANT_MISMATCH")
      }
      assigned.push(siteId)
    }
    if (assigned.length > 0) {
      data["sites"] = assigned
      /* 主站点跟随所选站点第一个，保持发布链路（域名/URL/编译）可用。 */
      data["site"] = assigned[0]
    } else {
      data["sites"] = []
      /* 清空多站点时保留原主站点，避免必填字段悬空。 */
    }
  }

  if (Object.keys(data).length === 0) throw fail("EDITION_ASSIGNMENT_EMPTY")

  await payload.update({
    collection: "content-editions",
    data,
    depth: 0,
    draft: true,
    id: input.editionId,
    overrideAccess: true,
  })
  return { editionId: input.editionId, ...data }
}
