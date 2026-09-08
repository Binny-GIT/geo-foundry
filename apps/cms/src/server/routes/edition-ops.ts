/*
 * 文章运营操作路由：assignment（改派负责人/站点）与 duplicate（复制为新草稿）。
 * 契约与旧 Payload endpoint 一致；写入走 latest 版本语义
 * （assignment 仅版本行；duplicate 建新根 + 新版本，允许同站点文章并存，
 * 与旧行为相同，不做唯一性拦截）。
 */

import { eq, inArray } from "drizzle-orm"
import { z } from "zod"

import { authenticateRequest } from "../auth/session"
import { insertLatestVersion, loadCurrentVersion } from "../repositories/edition-workflow"
import { entityScopeOf } from "../repositories/entities"
import { contentEditions, editionVersions } from "../db/edition-schema"
import { sites } from "../db/entity-schema"
import { users } from "../db/schema"
import { serverRuntime } from "../runtime"

export class EditionOpsError extends Error {
  override readonly name = "EditionOpsError"
  constructor(readonly code: string) {
    super(code)
  }
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  })

const idOf = (slug: readonly string[] | undefined): number | null => {
  const id = slug?.[1]
  return id !== undefined && /^\d+$/.test(id) && Number(id) > 0 ? Number(id) : null
}

const assignmentSchema = z
  .object({
    owner: z.number().int().positive().nullable().optional(),
    site: z.number().int().positive().optional(),
    sites: z.array(z.number().int().positive()).max(20).optional(),
  })
  .strict()

const SITE_REASSIGNABLE = new Set(["draft", "generating", "review", "approved"])

export const handleEditionOpsPost = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> => {
  if (slug?.length !== 3 || slug[0] !== "editions") return null
  const editionId = idOf(slug)
  if (editionId === null) return null
  const auth = await authenticateRequest(request.headers)
  if (auth === null) return json(401, { error: { code: "EDITION_OPS_UNAUTHENTICATED" } })
  const role = auth.claims.role
  const allowed = role === "editor" || role === "tenant-admin" || role === "super-admin"
  const scope = entityScopeOf(auth)
  if (scope === null || !allowed) {
    return json(403, { error: { code: "EDITION_OPS_FORBIDDEN" } })
  }

  // body 只在本路由真正认领（duplicate/assignment）时才读取；
  // 提前消费会让后续 handler 的 request.json() 抛错。
  if (slug[2] !== "duplicate" && slug[2] !== "assignment") return null
  let raw: unknown = {}
  try {
    raw = await request.json()
  } catch {
    if (slug[2] === "duplicate") raw = {}
    else return json(400, { error: { code: "EDITION_OPS_BODY_INVALID" } })
  }

  const db = serverRuntime().db

  if (slug[2] === "duplicate") {
    // 旧端点允许无 body 的 POST；JSON 解析失败按空对象处理。
    if (raw === null) raw = {}
    const parsed = z.object({}).strict().safeParse(raw)
    if (!parsed.success) return json(400, { error: { code: "EDITION_OPS_BODY_INVALID" } })
    try {
      const newEditionId = await db.transaction(async (tx) => {
        const { version } = await loadCurrentVersion(tx, scope, editionId)
        const now = new Date()
        const rootRows = await tx
          .insert(contentEditions)
          .values({
            angle: version.angle,
            auditLog: [],
            bodyMarkdown: version.bodyMarkdown,
            citations: version.citations,
            compiledRelease: null,
            contentModifiedAt: now,
            creationOrigin: version.creationOrigin ?? "human",
            dueAt: version.dueAt,
            editorialStatus: "unassigned",
            entities: version.entities,
            ownerId: null,
            primaryTopic: version.primaryTopic,
            secondaryTopics: version.secondaryTopics,
            priority: "normal",
            siteId: version.siteId,
            sites: version.sites,
            status: "draft",
            summary: version.summary,
            tenantId: version.tenantId,
            title: version.title,
            workflowRevision: "0",
            workflowStatus: "draft",
          })
          .returning({ id: contentEditions.id })
        const newId = rootRows[0]?.id
        if (newId === undefined) throw new EditionOpsError("EDITION_DUPLICATE_FAILED")
        const versionRows = await tx
          .insert(editionVersions)
          .values({
            angle: version.angle,
            auditLog: [],
            bodyMarkdown: version.bodyMarkdown,
            citations: version.citations,
            compiledRelease: null,
            contentModifiedAt: now,
            creationOrigin: version.creationOrigin ?? "human",
            dueAt: version.dueAt,
            editorialStatus: "unassigned",
            entities: version.entities,
            latest: true,
            ownerId: null,
            parentId: newId,
            primaryTopic: version.primaryTopic,
            secondaryTopics: version.secondaryTopics,
            priority: "normal",
            siteId: version.siteId,
            sites: version.sites,
            status: "draft",
            summary: version.summary,
            tenantId: version.tenantId,
            title: version.title,
            versionCreatedAt: now,
            versionUpdatedAt: now,
            workflowRevision: "0",
            workflowStatus: "draft",
          })
          .returning({ id: editionVersions.id })
        const newVersionId = versionRows[0]?.id
        if (newVersionId === undefined) throw new EditionOpsError("EDITION_DUPLICATE_FAILED")
        return newId
      })
      return json(201, { editionId: newEditionId })
    } catch (error) {
      const code = error instanceof EditionOpsError ? error.code : "EDITION_DUPLICATE_FAILED"
      const status =
        code === "EDITION_DUPLICATE_NOT_FOUND" || code === "EDITION_DUPLICATE_TENANT_MISMATCH"
          ? code.endsWith("TENANT_MISMATCH")
            ? 403
            : 404
          : 500
      return json(status, { error: { code } })
    }
  }

  if (slug[2] !== "assignment") return null
  const parsed = assignmentSchema.safeParse(raw)
  if (!parsed.success) return json(400, { error: { code: "EDITION_OPS_BODY_INVALID" } })
  const input = parsed.data
  try {
    const result = await db.transaction(async (tx) => {
      const { version } = await loadCurrentVersion(tx, scope, editionId)
      const tenantId = version.tenantId
      let ownerId = version.ownerId
      let siteId = version.siteId
      let nextSites: readonly number[] | undefined
      const response: Record<string, unknown> = { editionId }

      if (input.owner !== undefined) {
        if (input.owner === null) {
          ownerId = null
          response["owner"] = null
        } else {
          const ownerRows = await tx
            .select({ role: users.role, tenantId: users.tenantId })
            .from(users)
            .where(eq(users.id, input.owner))
            .limit(1)
          const owner = ownerRows[0]
          if (owner === undefined) throw new EditionOpsError("EDITION_ASSIGNMENT_OWNER_NOT_FOUND")
          if (owner.role === "content-service") {
            throw new EditionOpsError("EDITION_ASSIGNMENT_OWNER_INVALID")
          }
          if (tenantId !== null && owner.tenantId !== null && owner.tenantId !== tenantId) {
            throw new EditionOpsError("EDITION_ASSIGNMENT_OWNER_TENANT_MISMATCH")
          }
          ownerId = input.owner
          response["owner"] = input.owner
        }
      }

      if (input.site !== undefined) {
        if (!SITE_REASSIGNABLE.has(version.workflowStatus ?? "draft")) {
          throw new EditionOpsError("EDITION_ASSIGNMENT_SITE_LOCKED")
        }
        const siteRows = await tx
          .select({ tenantId: sites.tenantId })
          .from(sites)
          .where(eq(sites.id, input.site))
          .limit(1)
        const site = siteRows[0]
        if (site === undefined) throw new EditionOpsError("EDITION_ASSIGNMENT_SITE_NOT_FOUND")
        if (tenantId !== null && site.tenantId !== null && site.tenantId !== tenantId) {
          throw new EditionOpsError("EDITION_ASSIGNMENT_SITE_TENANT_MISMATCH")
        }
        siteId = input.site
        response["site"] = input.site
      }

      if (input.sites !== undefined) {
        const assigned: number[] = []
        for (const candidate of input.sites) {
          if (assigned.includes(candidate)) continue
          assigned.push(candidate)
        }
        if (assigned.length > 0) {
          const siteRows = await tx
            .select({ id: sites.id, tenantId: sites.tenantId })
            .from(sites)
            .where(inArray(sites.id, assigned))
          if (siteRows.length !== new Set(assigned).size) {
            throw new EditionOpsError("EDITION_ASSIGNMENT_SITE_NOT_FOUND")
          }
          if (siteRows.some((row) => tenantId !== null && row.tenantId !== tenantId)) {
            throw new EditionOpsError("EDITION_ASSIGNMENT_SITE_TENANT_MISMATCH")
          }
          nextSites = assigned
          const [primary] = assigned
          if (primary !== undefined) {
            siteId = primary
            response["site"] = primary
          }
          response["sites"] = assigned
        } else {
          nextSites = []
          response["sites"] = []
        }
      }

      if (Object.keys(response).length === 1) {
        throw new EditionOpsError("EDITION_ASSIGNMENT_EMPTY")
      }
      const newVersionId = await insertLatestVersion(tx, version, {
        auditLog: version.auditLog ?? [],
        compiledRelease: version.compiledRelease,
        workflowRevision: version.workflowRevision ?? "0",
        workflowStatus: version.workflowStatus ?? "draft",
      })
      // 显式回写 owner/site：insertLatestVersion 复制 current，需要覆盖这两列语义。
      await tx
        .update(editionVersions)
        .set({
          ownerId,
          siteId,
          ...(nextSites === undefined ? {} : { sites: [...nextSites] }),
        })
        .where(eq(editionVersions.id, newVersionId))
      return response
    })
    return json(200, result)
  } catch (error) {
    const code = error instanceof EditionOpsError ? error.code : "EDITION_ASSIGNMENT_FAILED"
    const status = code.endsWith("TENANT_MISMATCH")
      ? 403
      : code === "EDITION_ASSIGNMENT_NOT_FOUND" || code === "EDITION_DUPLICATE_NOT_FOUND"
        ? 404
        : 400
    return json(status, { error: { code } })
  }
}
