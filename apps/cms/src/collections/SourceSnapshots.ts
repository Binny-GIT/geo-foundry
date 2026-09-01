import { APIError, type CollectionBeforeChangeHook, type CollectionConfig } from "payload"

import { claimsFromRequest } from "../access/functions"
import { CMS_RESOURCE, readScope } from "../access/policy"
import { CMS_ROLE } from "../access/roles"
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

/** A snapshot must always remain attached to an intake item in the same tenant. */
export const ensureSourceSnapshotTenantConsistency: CollectionBeforeChangeHook = async ({
  data,
  req,
}) => {
  const intakeItemId = idOf(data["intakeItem"])
  const snapshotTenantId = idOf(data["tenant"])
  if (intakeItemId === null || snapshotTenantId === null) {
    return data
  }

  const intakeItem = await req.payload.findByID({
    collection: "intake-items",
    id: intakeItemId,
    depth: 0,
    overrideAccess: true,
  })
  const intakeTenantId = idOf(intakeItem.tenant)
  if (intakeTenantId !== null && String(intakeTenantId) !== String(snapshotTenantId)) {
    throw new APIError("CMS_SOURCE_SNAPSHOT_TENANT_MISMATCH", 400)
  }
  return data
}

const serviceOnlyCreate = ({ req }: { readonly req: { readonly user: unknown } }): boolean =>
  claimsFromRequest(req)?.role === CMS_ROLE.CONTENT_SERVICE

/**
 * Immutable object-storage metadata. Snapshot bytes are held outside Payload;
 * this collection stores only object references, media metadata, and hashes.
 */
export const SourceSnapshots = {
  slug: "source-snapshots",
  labels: {
    plural: localized("Source snapshots", "来源快照"),
    singular: localized("Source snapshot", "来源快照"),
  },
  admin: {
    defaultColumns: ["intakeItem", "kind", "contentHash", "capturedAt"],
    group: localized("Sources", "稿源"),
    useAsTitle: "contentHash",
  },
  access: {
    create: serviceOnlyCreate,
    read: ({ req }) => readScope(claimsFromRequest(req), CMS_RESOURCE.SOURCE_SNAPSHOTS),
    update: () => false,
    delete: () => false,
  },
  hooks: {
    beforeChange: [ensureSourceSnapshotTenantConsistency],
  },
  fields: localizedFields([
    {
      name: "intakeItem",
      type: "relationship",
      relationTo: "intake-items",
      required: true,
      index: true,
    },
    tenantField({ index: true }),
    {
      name: "kind",
      type: "select",
      options: ["raw-response", "extracted-content"],
      required: true,
    },
    {
      name: "storageKey",
      label: localized("Object storage key", "对象存储键"),
      type: "text",
      required: true,
      unique: true,
    },
    {
      name: "contentHash",
      label: localized("Content SHA-256", "内容 SHA-256"),
      type: "text",
      required: true,
      index: true,
    },
    {
      name: "contentType",
      type: "text",
    },
    {
      name: "contentLength",
      type: "number",
      min: 0,
    },
    {
      name: "capturedAt",
      type: "date",
      required: true,
      defaultValue: () => new Date().toISOString(),
      index: true,
    },
  ]),
} satisfies CollectionConfig
