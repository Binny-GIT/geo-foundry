import { z } from "zod"

import { ReleaseIdSchema, SiteIdSchema } from "../../page-document/v1/primitives.js"
import {
  AuditActorSchema,
  CanonicalTimestampSchema,
  ETagSchema,
  RELEASE_SCHEMA_VERSION,
  Sha256Schema,
} from "./primitives.js"

const ReceiptFields = {
  actor: AuditActorSchema,
  manifestSha256: Sha256Schema,
  newEtag: ETagSchema,
  recordedAt: CanonicalTimestampSchema,
  releaseId: ReleaseIdSchema,
  schemaVersion: z.literal(RELEASE_SCHEMA_VERSION),
  siteId: SiteIdSchema,
} as const

export const PublishReceiptSchema = z
  .strictObject({
    ...ReceiptFields,
    action: z.literal("publish"),
    oldEtag: ETagSchema.nullable(),
  })
  .readonly()

export const RollbackReceiptSchema = z
  .strictObject({
    ...ReceiptFields,
    action: z.literal("rollback"),
    fromManifestSha256: Sha256Schema,
    fromReleaseId: ReleaseIdSchema,
    oldEtag: ETagSchema,
  })
  .readonly()

export type PublishReceipt = z.infer<typeof PublishReceiptSchema>
export type RollbackReceipt = z.infer<typeof RollbackReceiptSchema>
