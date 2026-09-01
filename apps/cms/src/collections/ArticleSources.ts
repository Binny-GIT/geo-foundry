import { APIError, type CollectionBeforeChangeHook, type CollectionConfig } from "payload"

import { collectionAccess } from "../access/functions"
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

/** Every article-source row joins an edition and intake item in one tenant. */
export const ensureArticleSourceTenantConsistency: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  req,
}) => {
  const tenant = valueOf(data, originalDoc as Record<string, unknown> | undefined, "tenant")
  const editionId = idOf(
    valueOf(data, originalDoc as Record<string, unknown> | undefined, "edition"),
  )
  const intakeItemId = idOf(
    valueOf(data, originalDoc as Record<string, unknown> | undefined, "intakeItem"),
  )

  if (editionId === null || intakeItemId === null) return data

  const [edition, intakeItem] = await Promise.all([
    req.payload.findByID({
      collection: "content-editions",
      id: editionId,
      depth: 0,
      overrideAccess: true,
    }),
    req.payload.findByID({
      collection: "intake-items",
      id: intakeItemId,
      depth: 0,
      overrideAccess: true,
    }),
  ])
  assertSameTenant(tenant, edition.tenant, "CMS_ARTICLE_SOURCE_EDITION_TENANT_MISMATCH")
  assertSameTenant(tenant, intakeItem.tenant, "CMS_ARTICLE_SOURCE_INTAKE_TENANT_MISMATCH")
  assertSameTenant(edition.tenant, intakeItem.tenant, "CMS_ARTICLE_SOURCE_TENANT_MISMATCH")
  return data
}

/** A tenant-scoped association between an article edition and a source inbox item. */
export const ArticleSources = {
  slug: "article-sources",
  labels: {
    plural: localized("Article sources", "文章来源"),
    singular: localized("Article source", "文章来源"),
  },
  admin: {
    defaultColumns: ["edition", "intakeItem", "role", "updatedAt"],
    group: localized("Sources", "稿源"),
    useAsTitle: "id",
  },
  access: collectionAccess(CMS_RESOURCE.ARTICLE_SOURCES),
  hooks: {
    beforeChange: [ensureArticleSourceTenantConsistency],
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
    {
      name: "intakeItem",
      label: localized("Intake item", "稿源条目"),
      type: "relationship",
      relationTo: "intake-items",
      required: true,
      index: true,
    },
    tenantField({ index: true }),
    {
      name: "role",
      type: "select",
      options: ["primary", "supporting"],
      required: true,
      defaultValue: "supporting",
      index: true,
    },
    {
      name: "note",
      label: localized("Editorial note", "编辑备注"),
      type: "textarea",
    },
  ]),
} satisfies CollectionConfig
