import { APIError, type CollectionConfig, type FieldHook } from "payload"

import { collectionAccess } from "../access/functions"
import { CMS_RESOURCE } from "../access/policy"
import { resolveSessionClaims } from "../access/session"
import { tenantField } from "./shared/tenant-field"

export const MAX_MEDIA_BYTES = 5 * 1024 * 1024
export const ALLOWED_MEDIA_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const

const isRow = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const idOf = (reference: unknown): number | string | null =>
  typeof reference === "number" || typeof reference === "string" ? reference : null

const tenantPrefixFor = (tenantId: string): string => `tenants/${tenantId}`

/**
 * The storage prefix is never client-controlled: it is always derived from
 * the session tenant, so object keys are physically partitioned per tenant.
 */
const forceTenantStoragePrefix: FieldHook = ({ value, req }) => {
  const claims = resolveSessionClaims(req.user)
  if (claims === null || claims.tenantId === null) {
    return value
  }
  return tenantPrefixFor(String(claims.tenantId))
}

const assertMimeType = (mimeType: unknown): void => {
  if (
    typeof mimeType === "string" &&
    !(ALLOWED_MEDIA_MIME_TYPES as readonly string[]).includes(mimeType)
  ) {
    throw new APIError("CMS_MEDIA_TYPE_UNSUPPORTED", 400)
  }
}

const assertSize = (size: unknown): void => {
  if (typeof size === "number" && size > MAX_MEDIA_BYTES) {
    throw new APIError("CMS_MEDIA_FILE_TOO_LARGE", 400)
  }
}

const fileSizeOf = (file: Record<string, unknown>): number | null => {
  const size = file["size"]
  if (typeof size === "number") {
    return size
  }
  const data = file["data"]
  if (data instanceof Uint8Array) {
    return data.byteLength
  }
  return null
}

/** Upload-time policy check on the incoming request file. */
const assertUploadPolicy = (file: unknown): void => {
  if (!isRow(file)) {
    return
  }
  assertMimeType(file["mimetype"])
  const size = fileSizeOf(file)
  if (size !== null) {
    assertSize(size)
  }
}

/**
 * Stored-shape policy check on the computed document values (authoritative
 * mimeType/filesize produced by Payload's upload processing).
 */
const assertStoredPolicy = (data: unknown): void => {
  if (!isRow(data)) {
    return
  }
  assertMimeType(data["mimeType"])
  assertSize(data["filesize"])
}

/**
 * Release-safe virtual asset path, always derived server-side from the
 * stored tenant and filename; a client-supplied value is never kept. The
 * API-served `url` carries a query string and cannot pass the PageDocument
 * AssetUrl contract - published surfaces reference media through this
 * stable site-relative pathname instead.
 */
const withMediaPath = (data: Record<string, unknown>): Record<string, unknown> => {
  const filename = data["filename"]
  const tenantId = idOf(data["tenant"])
  if (typeof filename !== "string" || filename.length === 0 || tenantId === null) {
    return data
  }
  return { ...data, mediaPath: `/media/tenants/${tenantId}/${filename}` }
}

export const Media = {
  slug: "media",
  admin: {
    defaultColumns: ["filename", "alt", "mimeType", "filesize", "tenant", "updatedAt"],
    group: "Content",
    useAsTitle: "filename",
  },
  access: collectionAccess(CMS_RESOURCE.MEDIA),
  upload: {
    mimeTypes: [...ALLOWED_MEDIA_MIME_TYPES],
  },
  hooks: {
    beforeValidate: [
      ({ data, req }) => {
        assertUploadPolicy(req.file)
        return data
      },
    ],
    beforeChange: [
      ({ data }) => {
        assertStoredPolicy(data)
        return isRow(data) ? withMediaPath(data) : data
      },
    ],
  },
  fields: [
    tenantField(),
    {
      name: "prefix",
      type: "text",
      admin: {
        hidden: true,
        readOnly: true,
      },
      hooks: {
        beforeValidate: [forceTenantStoragePrefix],
      },
    },
    {
      name: "mediaPath",
      type: "text",
      admin: {
        hidden: true,
        readOnly: true,
      },
    },
    {
      name: "alt",
      type: "text",
      required: true,
    },
    {
      name: "caption",
      type: "text",
    },
  ],
} satisfies CollectionConfig
