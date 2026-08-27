import { APIError, type CollectionBeforeChangeHook, type CollectionConfig } from "payload"

import { claimsFromRequest, collectionAccess } from "../access/functions"
import { CMS_RESOURCE } from "../access/policy"
import { localized, localizedFields } from "./shared/localized-labels"
import { tenantField } from "./shared/tenant-field"

const idOf = (reference: unknown): number | string | null => {
  if (typeof reference === "number" || typeof reference === "string") return reference
  if (typeof reference === "object" && reference !== null) {
    const id = (reference as Record<string, unknown>)["id"]
    return typeof id === "number" || typeof id === "string" ? id : null
  }
  return null
}

const valueOf = (
  data: Record<string, unknown>,
  originalDoc: Record<string, unknown> | undefined,
  field: string,
): unknown => (Object.hasOwn(data, field) ? data[field] : originalDoc?.[field])

const assertSameTenant = (left: unknown, right: unknown, code: string): void => {
  const leftId = idOf(left)
  const rightId = idOf(right)
  if (leftId !== null && rightId !== null && String(leftId) !== String(rightId)) {
    throw new APIError(code, 400)
  }
}

const forceAuthorFromSession: CollectionBeforeChangeHook = ({ data, req }) => {
  const claims = claimsFromRequest(req)
  return claims?.kind === "user" ? { ...data, author: claims.userId } : data
}

/** Review comments bind their author and edition to one tenant. */
export const ensureReviewCommentTenantConsistency: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  req,
}) => {
  const original = originalDoc as Record<string, unknown> | undefined
  const tenant = valueOf(data, original, "tenant")
  const editionId = idOf(valueOf(data, original, "edition"))
  const authorId = idOf(valueOf(data, original, "author"))
  if (editionId === null || authorId === null) return data

  const [edition, author] = await Promise.all([
    req.payload.findByID({
      collection: "content-editions",
      id: editionId,
      depth: 0,
      overrideAccess: true,
    }),
    req.payload.findByID({
      collection: "users",
      id: authorId,
      depth: 0,
      overrideAccess: true,
    }),
  ])
  assertSameTenant(tenant, edition.tenant, "CMS_REVIEW_COMMENT_EDITION_TENANT_MISMATCH")
  assertSameTenant(tenant, author.tenant, "CMS_REVIEW_COMMENT_AUTHOR_TENANT_MISMATCH")
  assertSameTenant(edition.tenant, author.tenant, "CMS_REVIEW_COMMENT_TENANT_MISMATCH")
  return data
}

/** Immutable, tenant-scoped editorial review feedback. */
export const ReviewComments = {
  slug: "review-comments",
  labels: {
    plural: localized("Review comments", "审核意见"),
    singular: localized("Review comment", "审核意见"),
  },
  admin: {
    defaultColumns: ["edition", "kind", "author", "createdAt"],
    group: localized("Content", "内容"),
    useAsTitle: "body",
  },
  access: {
    ...collectionAccess(CMS_RESOURCE.REVIEW_COMMENTS),
    update: () => false,
    delete: () => false,
  },
  hooks: {
    beforeChange: [forceAuthorFromSession, ensureReviewCommentTenantConsistency],
  },
  fields: localizedFields([
    {
      name: "edition",
      type: "relationship",
      relationTo: "content-editions",
      required: true,
      index: true,
      admin: {
        components: {
          Cell: "/components/fields/EditionCell#EditionCell",
        },
      },
    },
    tenantField({ index: true }),
    {
      name: "author",
      type: "relationship",
      relationTo: "users",
      required: true,
      index: true,
      admin: { readOnly: true },
    },
    {
      name: "kind",
      type: "select",
      options: ["comment", "request-changes"],
      required: true,
      defaultValue: "comment",
      index: true,
    },
    {
      name: "body",
      label: localized("Comment", "意见"),
      type: "textarea",
      required: true,
      validate: (value) =>
        typeof value === "string" && value.trim().length > 0 && value.trim().length <= 2_000
          ? true
          : "Comment must be between 1 and 2000 characters",
    },
    {
      name: "workflowRevision",
      type: "number",
      min: 0,
      index: true,
      admin: { readOnly: true },
    },
  ]),
} satisfies CollectionConfig
