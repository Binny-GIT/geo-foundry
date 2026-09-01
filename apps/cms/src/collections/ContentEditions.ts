import {
  APIError,
  type CollectionBeforeChangeHook,
  type CollectionConfig,
  type Where,
} from "payload"

import { claimsFromRequest, collectionAccess } from "../access/functions"
import { CMS_RESOURCE, readScope } from "../access/policy"
import { PAGE_DOCUMENT_BLOCKS } from "../editor/page-document-blocks"
import { validateEditionBody } from "../editor/validate-body"
import { canonicalize } from "../services/edition-input-hash"
import { localized, localizedFields } from "./shared/localized-labels"
import { tenantField } from "./shared/tenant-field"

const idOf = (reference: unknown): number | string | null =>
  typeof reference === "number" || typeof reference === "string" ? reference : null

const isRow = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const fieldValue = (
  data: Record<string, unknown>,
  originalDoc: Record<string, unknown> | undefined,
  field: string,
): unknown => (Object.hasOwn(data, field) ? data[field] : originalDoc?.[field])

const MEDIA_SRC_PATTERN = /\/media\/tenants\/(\d+)\/([^/?#]+)(?:[?#]|$)/

const CONTENT_VERSION_FIELDS = [
  "body",
  "citations",
  "entities",
  "primaryTopic",
  "secondaryTopics",
  "summary",
  "title",
] as const

const contentModifiedAt = (): string => new Date().toISOString()

const editionVersionReadScope = ({
  req,
}: {
  readonly req: { readonly user: unknown }
}): boolean | Where => {
  const claims = claimsFromRequest(req)
  const scope = readScope(claims, CMS_RESOURCE.EDITIONS)
  if (scope === false || scope === true) return scope
  if (claims === null || claims.tenantId === null) return false
  return { "version.tenant": { equals: claims.tenantId } }
}

const contentFieldChanged = (
  data: Record<string, unknown>,
  originalDoc: Record<string, unknown> | undefined,
  field: (typeof CONTENT_VERSION_FIELDS)[number],
): boolean =>
  Object.hasOwn(data, field) &&
  JSON.stringify(canonicalize(data[field])) !== JSON.stringify(canonicalize(originalDoc?.[field]))

const trackContentVersion: CollectionBeforeChangeHook = ({ data, operation, originalDoc }) => {
  if (
    operation === "create" ||
    CONTENT_VERSION_FIELDS.some((field) =>
      contentFieldChanged(data, originalDoc as Record<string, unknown> | undefined, field),
    )
  ) {
    return { ...data, contentModifiedAt: contentModifiedAt() }
  }
  return data
}

/**
 * Media reference guard: every image block whose src points into the
 * tenant-partitioned media store must reference an existing media object of
 * the edition's own tenant. Deleted sources and foreign-tenant sources are
 * rejected before the write reaches storage.
 */
const ensureMediaReferences: CollectionBeforeChangeHook = async ({ data, req }) => {
  const body = data["body"]
  const editionTenantId = idOf(data["tenant"])
  if (!Array.isArray(body)) {
    return data
  }
  for (const block of body) {
    if (!isRow(block) || block["blockType"] !== "image") {
      continue
    }
    const src = block["src"]
    if (typeof src !== "string") {
      continue
    }
    const match = MEDIA_SRC_PATTERN.exec(src)
    if (match === null) {
      continue
    }
    const [, mediaTenantId, filename] = match
    if (editionTenantId !== null && mediaTenantId !== String(editionTenantId)) {
      throw new APIError("CMS_MEDIA_TENANT_MISMATCH", 400)
    }
    const existing = await req.payload.find({
      collection: "media",
      where: {
        mediaPath: { equals: `/media/tenants/${mediaTenantId}/${filename}` },
      },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    if (existing.docs.length === 0) {
      throw new APIError("CMS_MEDIA_MISSING", 400)
    }
  }
  return data
}

const ensureTenantConsistency: CollectionBeforeChangeHook = async ({ data, req, originalDoc }) => {
  const contentId = idOf(data["content"])
  if (contentId !== null) {
    const content = await req.payload.findByID({
      collection: "contents",
      id: contentId,
      depth: 0,
      overrideAccess: true,
    })
    const contentTenantId = idOf(content.tenant)
    const editionTenantId = idOf(data["tenant"])
    if (
      contentTenantId !== null &&
      editionTenantId !== null &&
      String(contentTenantId) !== String(editionTenantId)
    ) {
      throw new APIError("CMS_EDITION_TENANT_MISMATCH", 400)
    }
  }

  const ownerId = idOf(
    fieldValue(data, originalDoc as Record<string, unknown> | undefined, "owner"),
  )
  if (ownerId !== null) {
    const owner = await req.payload.findByID({
      collection: "users",
      id: ownerId,
      depth: 0,
      overrideAccess: true,
    })
    const ownerTenantId = idOf(owner.tenant)
    const editionTenantId = idOf(
      fieldValue(data, originalDoc as Record<string, unknown> | undefined, "tenant"),
    )
    if (
      ownerTenantId === null ||
      editionTenantId === null ||
      String(ownerTenantId) !== String(editionTenantId)
    ) {
      throw new APIError("CMS_EDITION_OWNER_TENANT_MISMATCH", 400)
    }
  }

  const siteId = idOf(data["site"])
  if (siteId !== null) {
    const site = await req.payload.findByID({
      collection: "sites",
      id: siteId,
      depth: 0,
      overrideAccess: true,
    })
    const siteTenantId = idOf(site.tenant)
    const editionTenantId = idOf(data["tenant"])
    if (
      siteTenantId !== null &&
      editionTenantId !== null &&
      String(siteTenantId) !== String(editionTenantId)
    ) {
      throw new APIError("CMS_EDITION_TENANT_MISMATCH", 400)
    }
  }

  const existing = await req.payload.find({
    collection: "content-editions",
    where: {
      and: [
        { content: { equals: idOf(data["content"]) } },
        { site: { equals: idOf(data["site"]) } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const selfId = idOf(originalDoc?.id)
  const duplicate = existing.docs.find((doc) => String(doc.id) !== String(selfId))
  if (duplicate !== undefined) {
    throw new APIError("CMS_EDITION_SITE_DUPLICATE", 409)
  }

  return data
}

export const ContentEditions = {
  slug: "content-editions",
  labels: {
    plural: localized("Content editions", "内容版本"),
    singular: localized("Content edition", "内容版本"),
  },
  admin: {
    components: {
      views: {
        edit: {
          root: {
            Component: "/components/views/ContentEditionDocument#ContentEditionDocument",
          },
        },
      },
    },
    defaultColumns: ["title", "workflowStatus", "site", "creationOrigin", "updatedAt"],
    group: localized("Content", "内容"),
    useAsTitle: "title",
  },
  access: {
    ...collectionAccess(CMS_RESOURCE.EDITIONS),
    readVersions: editionVersionReadScope,
  },
  versions: {
    drafts: true,
  },
  hooks: {
    beforeChange: [trackContentVersion, ensureTenantConsistency, ensureMediaReferences],
  },
  fields: localizedFields([
    {
      name: "workflowActions",
      type: "ui",
      admin: {
        components: {
          Field: "/components/workflow/WorkflowActions#WorkflowActions",
        },
      },
    },
    {
      name: "content",
      type: "relationship",
      relationTo: "contents",
      required: true,
    },
    {
      name: "site",
      type: "relationship",
      relationTo: "sites",
      required: true,
      admin: {
        components: {
          Cell: "/components/fields/SiteCell#SiteCell",
        },
      },
    },
    tenantField(),
    {
      name: "owner",
      label: localized("Owner", "负责人"),
      type: "relationship",
      relationTo: "users",
      index: true,
    },
    {
      name: "priority",
      type: "select",
      options: ["low", "normal", "high", "urgent"],
      defaultValue: "normal",
      index: true,
    },
    {
      name: "dueAt",
      label: localized("Due at", "截止时间"),
      type: "date",
      index: true,
    },
    {
      name: "editorialStatus",
      label: localized("Editorial status", "编辑状态"),
      type: "select",
      options: ["unassigned", "assigned", "in-progress", "blocked"],
      defaultValue: "unassigned",
      index: true,
    },
    {
      name: "angle",
      type: "text",
      required: true,
    },
    {
      name: "title",
      type: "text",
      required: true,
    },
    {
      name: "summary",
      type: "textarea",
      required: true,
    },
    {
      name: "body",
      type: "blocks",
      blocks: PAGE_DOCUMENT_BLOCKS,
      required: true,
      validate: validateEditionBody,
    },
    {
      name: "primaryTopic",
      type: "text",
      required: true,
    },
    {
      name: "secondaryTopics",
      type: "text",
      hasMany: true,
    },
    {
      name: "citations",
      type: "json",
    },
    {
      name: "entities",
      type: "json",
    },
    {
      name: "creationOrigin",
      type: "select",
      options: ["ai", "human", "hybrid"],
      required: true,
      defaultValue: "human",
    },
    {
      name: "contentModifiedAt",
      type: "date",
      admin: { hidden: true },
      access: {
        create: () => false,
        update: () => false,
      },
    },
    {
      name: "workflowStatus",
      type: "select",
      options: ["draft", "generating", "review", "approved", "compiled", "published", "archived"],
      defaultValue: "draft",
      admin: {
        readOnly: true,
        description: localized(
          "Owned by the edition workflow service.",
          "由内容版本工作流服务管理。",
        ),
      },
      access: {
        create: () => false,
        update: () => false,
      },
    },
    {
      name: "workflowRevision",
      type: "number",
      defaultValue: 0,
      admin: { hidden: true },
      access: {
        create: () => false,
        update: () => false,
      },
    },
    {
      name: "compiledRelease",
      type: "text",
      admin: { hidden: true },
      access: {
        create: () => false,
        update: () => false,
      },
    },
    {
      name: "auditLog",
      type: "json",
      defaultValue: [],
      admin: { hidden: true },
      access: {
        create: () => false,
        update: () => false,
      },
    },
  ]),
} satisfies CollectionConfig
