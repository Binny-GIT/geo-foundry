import type { Endpoint, PayloadRequest } from "payload"

import { resolveSessionClaims } from "../access/session"

const editionIdOf = (req: PayloadRequest): number | null => {
  const id = Number(req.routeParams?.["id"])
  return Number.isInteger(id) && id > 0 ? id : null
}

const response = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  })

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}

const idOf = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value
  if (typeof value === "object" && value !== null) return idOf(record(value)["id"])
  return null
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null

const sourceDto = (value: unknown) => {
  const source = record(value)
  const intake = record(source["intakeItem"])
  return {
    id: idOf(source["id"]),
    note: text(source["note"]),
    role: text(source["role"]),
    intakeItem: {
      id: idOf(intake["id"]),
      sourceUrl: text(intake["sourceUrl"]),
      status: text(intake["status"]),
      title: text(intake["title"]),
    },
  }
}

const commentDto = (value: unknown) => {
  const comment = record(value)
  const author = record(comment["author"])
  return {
    author: {
      email: text(author["email"]),
      id: idOf(author["id"]),
    },
    body: text(comment["body"]),
    createdAt: text(comment["createdAt"]),
    id: idOf(comment["id"]),
    kind: text(comment["kind"]),
    workflowRevision:
      typeof comment["workflowRevision"] === "number" ? comment["workflowRevision"] : null,
  }
}

const assessmentDto = (value: unknown) => {
  const assessment = record(value)
  if (Object.keys(assessment).length === 0) return null
  return {
    createdAt: text(assessment["createdAt"]),
    inputHash: text(assessment["inputHash"]),
    issues: Array.isArray(assessment["issues"]) ? assessment["issues"] : [],
    overall: typeof assessment["overall"] === "number" ? assessment["overall"] : null,
    state: text(assessment["state"]),
  }
}

const variantDto = (value: unknown) => {
  const variant = record(value)
  const site = record(variant["site"])
  return {
    body: Array.isArray(variant["body"]) ? variant["body"] : [],
    id: idOf(variant["id"]),
    site: { id: idOf(site["id"]), name: text(site["name"]) },
    summary: text(variant["summary"]),
    title: text(variant["title"]),
    updatedAt: text(variant["updatedAt"]),
    workflowStatus: text(variant["workflowStatus"]),
  }
}

/**
 * Browser-safe workspace context. Every collection query runs through Payload
 * access control under the current session, so related sources, comments and
 * quality evidence cannot widen the edition's tenant scope.
 */
export const editionWorkspaceContextEndpoint: Endpoint = {
  handler: async (req) => {
    const editionId = editionIdOf(req)
    const claims = resolveSessionClaims(req.user)
    if (editionId === null) return response(400, { error: { code: "EDITION_WORKSPACE_ID_INVALID" } })
    if (claims === null) return response(401, { error: { code: "EDITION_WORKSPACE_UNAUTHENTICATED" } })

    const editionResult = await req.payload.find({
      collection: "content-editions",
      depth: 0,
      draft: true,
      limit: 1,
      overrideAccess: false,
      user: req.user,
      where: { id: { equals: editionId } },
    })
    const edition = editionResult.docs[0]
    if (edition === undefined) return response(404, { error: { code: "EDITION_WORKSPACE_NOT_FOUND" } })
    const tenantId = idOf(record(edition)["tenant"])

    const contentId = idOf(record(edition)["content"])

    const [sources, comments, assessments, users, variants] = await Promise.all([
      req.payload.find({
        collection: "article-sources",
        depth: 1,
        limit: 50,
        overrideAccess: false,
        sort: "createdAt",
        user: req.user,
        where: { edition: { equals: editionId } },
      }),
      req.payload.find({
        collection: "review-comments",
        depth: 1,
        limit: 100,
        overrideAccess: false,
        sort: "-createdAt",
        user: req.user,
        where: { edition: { equals: editionId } },
      }),
      req.payload.find({
        collection: "quality-assessments",
        depth: 0,
        limit: 1,
        overrideAccess: false,
        sort: "-createdAt",
        user: req.user,
        where: { edition: { equals: editionId } },
      }),
      tenantId === null || (claims.role !== "editor" && claims.role !== "tenant-admin")
        ? Promise.resolve({ docs: [] as unknown[] })
        : req.payload.find({
            collection: "users",
            depth: 0,
            limit: 100,
            overrideAccess: true,
            sort: "email",
            where: { tenant: { equals: tenantId } },
          }),
      contentId === null
        ? Promise.resolve({ docs: [] as unknown[] })
        : req.payload.find({
            collection: "content-editions",
            depth: 1,
            draft: true,
            limit: 20,
            overrideAccess: false,
            sort: "-updatedAt",
            user: req.user,
            where: {
              and: [
                { content: { equals: contentId } },
                { id: { not_equals: editionId } },
              ],
            },
          }),
    ])

    const siteId = idOf(record(edition)["site"])
    const site = siteId === null
      ? null
      : await req.payload
          .findByID({ collection: "sites", depth: 0, id: siteId, overrideAccess: false, user: req.user })
          .catch(() => null)

    return response(200, {
      assignees: users.docs.map((user) => ({
        email: text(record(user)["email"]),
        id: idOf(record(user)["id"]),
        role: text(record(user)["role"]),
      })),
      comments: comments.docs.map(commentDto),
      edition: {
        siteTimezone: text(record(site)["timezone"]),
        workflowRevision:
          typeof record(edition)["workflowRevision"] === "number"
            ? record(edition)["workflowRevision"]
            : 0,
      },
      quality: assessmentDto(assessments.docs[0]),
      sources: sources.docs.map(sourceDto),
      variants: variants.docs.map(variantDto),
    })
  },
  method: "get",
  path: "/workspaces/editions/:id/context",
}
