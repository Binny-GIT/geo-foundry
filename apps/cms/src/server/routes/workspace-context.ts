/*
 * 工作台上下文路由：GET /api/workspaces/editions/:id/context。
 * 全部读走 Drizzle + 会话租户谓词（等价旧 overrideAccess:false 的租户边界），
 * 返回形状与旧端点逐字段一致。
 */

import { and, asc, desc, eq, ne } from "drizzle-orm"

import { markdownToBlocks } from "../../editor/block-markdown"
import { authenticateRequest } from "../auth/session"
import {
  contentEditions,
  editionVersionRels,
  editionVersions,
} from "../db/edition-schema"
import { sites } from "../db/entity-schema"
import { users } from "../db/schema"
import { articleSources, intakeItems, qualityAssessments } from "../db/session-schema"
import { reviewComments } from "../db/workflow-schema"
import { entityScopeOf } from "../repositories/entities"
import { serverRuntime } from "../runtime"

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  })

export const workspaceContextRouteOf = (slug: readonly string[] | undefined): boolean =>
  slug?.length === 4 && slug[0] === "workspaces" && slug[1] === "editions" && slug[3] === "context"

export const handleWorkspaceContextGet = async (
  request: Request,
  slug: readonly string[] | undefined,
): Promise<Response | null> => {
  if (!workspaceContextRouteOf(slug)) return null
  const editionId = slug?.[2] !== undefined && /^\d+$/.test(slug[2]) ? Number(slug[2]) : null
  if (editionId === null || editionId <= 0) {
    return json(400, { error: { code: "EDITION_WORKSPACE_ID_INVALID" } })
  }
  const auth = await authenticateRequest(request.headers)
  if (auth === null) return json(401, { error: { code: "EDITION_WORKSPACE_UNAUTHENTICATED" } })
  const scope = entityScopeOf(auth)
  if (scope === null) return json(404, { error: { code: "EDITION_WORKSPACE_NOT_FOUND" } })
  const tenantPredicate =
    scope.kind === "global" ? undefined : eq(editionVersions.tenantId, scope.tenantId)

  const db = serverRuntime().db
  const editionRows = await db
    .select()
    .from(editionVersions)
    .where(and(eq(editionVersions.parentId, editionId), eq(editionVersions.latest, true)))
    .limit(1)
  const edition = editionRows[0]
  if (edition === undefined) {
    return json(404, { error: { code: "EDITION_WORKSPACE_NOT_FOUND" } })
  }
  if (tenantPredicate !== undefined && edition.tenantId !== (scope.kind === "global" ? null : scope.tenantId)) {
    return json(404, { error: { code: "EDITION_WORKSPACE_NOT_FOUND" } })
  }
  const tenantId = edition.tenantId
  const contentId = edition.contentId

  const [sourceRows, commentRows, assessmentRows, userRows, variantRows] = await Promise.all([
    db
      .select({
        id: articleSources.id,
        note: articleSources.note,
        role: articleSources.role,
        intakeId: intakeItems.id,
        intakeUrl: intakeItems.sourceUrl,
        intakeStatus: intakeItems.status,
        intakeTitle: intakeItems.title,
      })
      .from(articleSources)
      .leftJoin(intakeItems, eq(intakeItems.id, articleSources.intakeItemId))
      .where(eq(articleSources.editionId, editionId))
      .orderBy(asc(articleSources.createdAt))
      .limit(50),
    db
      .select({
        id: reviewComments.id,
        body: reviewComments.body,
        kind: reviewComments.kind,
        createdAt: reviewComments.createdAt,
        workflowRevision: reviewComments.workflowRevision,
        authorId: reviewComments.authorId,
        authorEmail: users.email,
      })
      .from(reviewComments)
      .leftJoin(users, eq(users.id, reviewComments.authorId))
      .where(eq(reviewComments.editionId, editionId))
      .orderBy(desc(reviewComments.createdAt))
      .limit(100),
    db
      .select()
      .from(qualityAssessments)
      .where(eq(qualityAssessments.editionId, editionId))
      .orderBy(desc(qualityAssessments.createdAt))
      .limit(1),
    (auth.claims.role === "editor" ||
      auth.claims.role === "super-admin" ||
      auth.claims.role === "tenant-admin") &&
    tenantId !== null
      ? db
          .select({ email: users.email, id: users.id, role: users.role })
          .from(users)
          .where(eq(users.tenantId, tenantId))
          .orderBy(asc(users.email))
          .limit(100)
      : Promise.resolve([] as never[]),
    contentId === null
      ? Promise.resolve([] as never[])
      : db
          .select({
            id: editionVersions.id,
            title: editionVersions.title,
            summary: editionVersions.summary,
            updatedAt: editionVersions.updatedAt,
            workflowStatus: editionVersions.workflowStatus,
            bodyMarkdown: editionVersions.bodyMarkdown,
            siteId: editionVersions.siteId,
            siteName: sites.name,
          })
          .from(editionVersions)
          .leftJoin(sites, eq(sites.id, editionVersions.siteId))
          .where(
            and(
              eq(editionVersions.latest, true),
              eq(editionVersions.contentId, contentId),
              ne(editionVersions.parentId, editionId),
              ...(tenantPredicate !== undefined ? [tenantPredicate] : []),
            ),
          )
          .orderBy(desc(editionVersions.updatedAt))
          .limit(20),
  ])

  const siteRows =
    edition.siteId === null
      ? []
      : await db
          .select({ timezone: sites.timezone })
          .from(sites)
          .where(eq(sites.id, edition.siteId))
          .limit(1)
  void contentEditions
  void editionVersionRels

  const assessment = assessmentRows[0]
  return json(200, {
    assignees: userRows.map((user) => ({
      email: user.email,
      id: user.id,
      role: user.role,
    })),
    comments: commentRows.map((comment) => ({
      author: { email: comment.authorEmail, id: comment.authorId },
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
      id: comment.id,
      kind: comment.kind,
      workflowRevision:
        comment.workflowRevision === null ? null : Number(comment.workflowRevision),
    })),
    edition: {
      siteTimezone: siteRows[0]?.timezone ?? null,
      workflowRevision: Number(edition.workflowRevision ?? 0),
    },
    quality:
      assessment === undefined
        ? null
        : {
            createdAt: assessment.createdAt.toISOString(),
            inputHash: assessment.inputHash,
            issues: Array.isArray(assessment.issues) ? assessment.issues : [],
            overall: assessment.overall === null ? null : Number(assessment.overall),
            state: assessment.state,
          },
    sources: sourceRows.map((source) => ({
      id: source.id,
      note: source.note ?? null,
      role: source.role,
      intakeItem: {
        id: source.intakeId,
        sourceUrl: source.intakeUrl ?? null,
        status: source.intakeStatus ?? null,
        title: source.intakeTitle ?? null,
      },
    })),
    variants: variantRows.map((variant) => ({
      body: markdownToBlocks(variant.bodyMarkdown ?? ""),
      id: variant.id,
      site: { id: variant.siteId, name: variant.siteName ?? null },
      summary: variant.summary ?? null,
      title: variant.title ?? null,
      updatedAt: variant.updatedAt.toISOString(),
      workflowStatus: variant.workflowStatus ?? null,
    })),
  })
}
