import { APIError, type CollectionBeforeChangeHook, type CollectionConfig } from "payload"

import { collectionAccess } from "../access/functions"
import { CMS_RESOURCE } from "../access/policy"
import { localized, localizedFields } from "./shared/localized-labels"
import { tenantField } from "./shared/tenant-field"

const idOf = (reference: unknown): number | string | null => {
  if (typeof reference === "number" || typeof reference === "string") {
    return reference
  }
  if (typeof reference === "object" && reference !== null) {
    const id = (reference as Record<string, unknown>)["id"]
    return typeof id === "number" || typeof id === "string" ? id : null
  }
  return null
}

const fieldValue = (
  data: Record<string, unknown>,
  originalDoc: Record<string, unknown> | undefined,
  field: string,
): unknown => (Object.hasOwn(data, field) ? data[field] : originalDoc?.[field])

const sameReference = (left: unknown, right: unknown): boolean => {
  const leftId = idOf(left)
  const rightId = idOf(right)
  return leftId !== null && rightId !== null && String(leftId) === String(rightId)
}

const assertSameTenant = (expectedTenant: unknown, actualTenant: unknown, error: string): void => {
  const expectedTenantId = idOf(expectedTenant)
  const actualTenantId = idOf(actualTenant)
  if (
    expectedTenantId !== null &&
    actualTenantId !== null &&
    String(expectedTenantId) !== String(actualTenantId)
  ) {
    throw new APIError(error, 400)
  }
}

/**
 * Intake-item relationships are tenant-bound and preserve a single target
 * brand by using `sites` directly rather than introducing a Brand entity.
 */
export const ensureIntakeItemTenantConsistency: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  req,
}) => {
  const intakeTenant = fieldValue(data, originalDoc, "tenant")
  const connectorId = idOf(fieldValue(data, originalDoc, "connector"))
  if (connectorId !== null) {
    const connector = await req.payload.findByID({
      collection: "connectors",
      id: connectorId,
      depth: 0,
      overrideAccess: true,
    })
    assertSameTenant(intakeTenant, connector.tenant, "CMS_INTAKE_CONNECTOR_TENANT_MISMATCH")
  }

  const siteId = idOf(fieldValue(data, originalDoc, "suggestedSite"))
  if (siteId !== null) {
    const site = await req.payload.findByID({
      collection: "sites",
      id: siteId,
      depth: 0,
      overrideAccess: true,
    })
    assertSameTenant(intakeTenant, site.tenant, "CMS_INTAKE_SITE_TENANT_MISMATCH")
  }

  const duplicateOfId = idOf(fieldValue(data, originalDoc, "duplicateOf"))
  if (duplicateOfId !== null) {
    const duplicateOf = await req.payload.findByID({
      collection: "intake-items",
      id: duplicateOfId,
      depth: 0,
      overrideAccess: true,
    })
    if (originalDoc !== undefined && sameReference(duplicateOf.id, originalDoc.id)) {
      throw new APIError("CMS_INTAKE_DUPLICATE_SELF_REFERENCE", 400)
    }
    assertSameTenant(intakeTenant, duplicateOf.tenant, "CMS_INTAKE_DUPLICATE_TENANT_MISMATCH")
  }

  return data
}

/** A normalized item entering the editorial intake inbox. */
export const IntakeItems = {
  slug: "intake-items",
  labels: {
    plural: localized("Intake items", "稿源条目"),
    singular: localized("Intake item", "稿源条目"),
  },
  admin: {
    defaultColumns: [
      "title",
      "status",
      "duplicateStatus",
      "suggestedSite",
      "connector",
      "updatedAt",
    ],
    group: localized("Sources", "稿源"),
    useAsTitle: "title",
  },
  access: collectionAccess(CMS_RESOURCE.INTAKE_ITEMS),
  hooks: {
    beforeChange: [ensureIntakeItemTenantConsistency],
  },
  fields: localizedFields([
    {
      name: "connector",
      type: "relationship",
      relationTo: "connectors",
      index: true,
    },
    tenantField({ index: true }),
    {
      name: "channel",
      label: localized("Intake channel", "稿源渠道"),
      type: "select",
      options: ["manual", "url", "webhook", "rss"],
      required: true,
      defaultValue: "manual",
      index: true,
    },
    {
      name: "title",
      type: "text",
      required: true,
      index: true,
    },
    {
      name: "summary",
      label: localized("Summary", "摘要"),
      type: "textarea",
    },
    {
      name: "contentBlocks",
      label: localized("Extracted blocks", "提取的结构化内容"),
      type: "json",
      admin: { hidden: true },
    },
    {
      name: "sourceUrl",
      label: localized("Source URL", "来源 URL"),
      type: "text",
      index: true,
    },
    {
      name: "normalizedUrl",
      label: localized("Normalized URL", "规范化 URL"),
      type: "text",
      index: true,
      admin: { readOnly: true },
      access: { create: () => false, update: () => false },
    },
    {
      name: "status",
      type: "select",
      options: ["new", "fetching", "ready", "failed", "ignored", "duplicate", "adopted", "merged"],
      required: true,
      defaultValue: "new",
      index: true,
    },
    {
      name: "duplicateStatus",
      label: localized("Duplicate status", "重复状态"),
      type: "select",
      options: ["unknown", "unique", "suspected", "duplicate"],
      required: true,
      defaultValue: "unknown",
      index: true,
    },
    {
      name: "contentHash",
      label: localized("Content SHA-256", "正文 SHA-256"),
      type: "text",
      index: true,
      admin: { readOnly: true },
      access: { create: () => false, update: () => false },
    },
    {
      name: "snapshot",
      label: localized("Latest snapshot", "最新快照"),
      type: "relationship",
      relationTo: "source-snapshots",
      index: true,
      admin: { readOnly: true },
      access: { create: () => false, update: () => false },
    },
    {
      name: "duplicateOf",
      label: localized("Duplicate of", "重复项"),
      type: "relationship",
      relationTo: "intake-items",
      index: true,
    },
    {
      name: "mergedInto",
      label: localized("Merged into", "合并到"),
      type: "relationship",
      relationTo: "intake-items",
      index: true,
    },
    {
      name: "suggestedSite",
      label: localized("Suggested site", "建议站点"),
      type: "relationship",
      relationTo: "sites",
      index: true,
      admin: {
        components: {
          Cell: "/components/fields/SiteCell#SiteCell",
        },
      },
    },
    {
      name: "assignedTo",
      label: localized("Assigned editor", "负责人"),
      type: "relationship",
      relationTo: "users",
      index: true,
    },
    {
      name: "receivedAt",
      type: "date",
      required: true,
      defaultValue: () => new Date().toISOString(),
      index: true,
    },
    {
      name: "adoptedEdition",
      label: localized("Adopted edition", "采用后的内容版本"),
      type: "relationship",
      relationTo: "content-editions",
      index: true,
      admin: { readOnly: true },
      access: { create: () => false, update: () => false },
    },
    {
      name: "failureCode",
      label: localized("Failure code", "失败代码"),
      type: "text",
      admin: { readOnly: true },
      access: { create: () => false, update: () => false },
    },
    {
      name: "failureReason",
      label: localized("Failure reason", "失败原因"),
      type: "textarea",
      admin: { readOnly: true },
      access: { create: () => false, update: () => false },
    },
  ]),
} satisfies CollectionConfig
