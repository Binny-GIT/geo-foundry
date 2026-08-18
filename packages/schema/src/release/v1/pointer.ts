import { z } from "zod"

import { ReleaseIdSchema, SiteIdSchema } from "../../page-document/v1/primitives.js"
import { UnverifiedReleasePointerError } from "./errors.js"
import { canonicalizeReleaseManifest, hashReleaseManifest } from "./manifest.js"
import {
  type AuditActor,
  AuditActorSchema,
  type CanonicalTimestamp,
  CanonicalTimestampSchema,
  RELEASE_SCHEMA_VERSION,
  type Sha256,
  Sha256Schema,
} from "./primitives.js"

const VERIFIED_RELEASE_REFERENCE_BRAND: unique symbol = Symbol("VerifiedReleaseReference")
const CURRENT_POINTER_BRAND: unique symbol = Symbol("CurrentPointer")
const verifiedReleaseReferences = new WeakMap<object, symbol>()
const currentPointers = new WeakMap<object, symbol>()

const PointerCandidateSchema = z
  .strictObject({
    actor: AuditActorSchema,
    release: z.unknown(),
    updatedAt: CanonicalTimestampSchema,
  })
  .readonly()

export const CurrentPointerSchema = z
  .strictObject({
    actor: AuditActorSchema,
    manifestSha256: Sha256Schema,
    releaseId: ReleaseIdSchema,
    schemaVersion: z.literal(RELEASE_SCHEMA_VERSION),
    siteId: SiteIdSchema,
    updatedAt: CanonicalTimestampSchema,
  })
  .readonly()

export type VerifiedReleaseReference = {
  readonly [VERIFIED_RELEASE_REFERENCE_BRAND]: typeof VERIFIED_RELEASE_REFERENCE_BRAND
  readonly manifestSha256: Sha256
  readonly releaseId: z.infer<typeof ReleaseIdSchema>
  readonly siteId: z.infer<typeof SiteIdSchema>
}

export type CurrentPointer = z.infer<typeof CurrentPointerSchema> & {
  readonly [CURRENT_POINTER_BRAND]: typeof CURRENT_POINTER_BRAND
}

export type CreateCurrentPointerInput = {
  readonly actor: AuditActor
  readonly release: VerifiedReleaseReference
  readonly updatedAt: CanonicalTimestamp
}

function isVerifiedReleaseReference(value: unknown): value is VerifiedReleaseReference {
  return (
    typeof value === "object" &&
    value !== null &&
    verifiedReleaseReferences.get(value) === VERIFIED_RELEASE_REFERENCE_BRAND
  )
}

function assertCurrentPointer(value: unknown): asserts value is CurrentPointer {
  if (
    typeof value !== "object" ||
    value === null ||
    currentPointers.get(value) !== CURRENT_POINTER_BRAND
  ) {
    throw new UnverifiedReleasePointerError("unknown")
  }
}

export async function verifyManifest(input: unknown): Promise<VerifiedReleaseReference> {
  const manifest = canonicalizeReleaseManifest(input)
  const reference: VerifiedReleaseReference = Object.freeze({
    [VERIFIED_RELEASE_REFERENCE_BRAND]: VERIFIED_RELEASE_REFERENCE_BRAND,
    manifestSha256: await hashReleaseManifest(manifest),
    releaseId: manifest.releaseId,
    siteId: manifest.siteId,
  })
  verifiedReleaseReferences.set(reference, VERIFIED_RELEASE_REFERENCE_BRAND)
  return reference
}

export function createCurrentPointer(input: CreateCurrentPointerInput): CurrentPointer
export function createCurrentPointer(input: unknown): CurrentPointer {
  const candidate = PointerCandidateSchema.parse(input)
  if (!isVerifiedReleaseReference(candidate.release)) {
    throw new UnverifiedReleasePointerError("unknown")
  }

  const document = CurrentPointerSchema.parse({
    actor: candidate.actor,
    manifestSha256: candidate.release.manifestSha256,
    releaseId: candidate.release.releaseId,
    schemaVersion: RELEASE_SCHEMA_VERSION,
    siteId: candidate.release.siteId,
    updatedAt: candidate.updatedAt,
  })
  const pointer = Object.freeze({
    [CURRENT_POINTER_BRAND]: CURRENT_POINTER_BRAND,
    ...document,
  } as const)
  currentPointers.set(pointer, CURRENT_POINTER_BRAND)
  return pointer
}

export function serializeCurrentPointer(pointer: CurrentPointer): Uint8Array {
  assertCurrentPointer(pointer)
  return new TextEncoder().encode(JSON.stringify(CurrentPointerSchema.parse(pointer)))
}

export async function hashCurrentPointer(pointer: CurrentPointer): Promise<Sha256> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(serializeCurrentPointer(pointer)),
  )
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  )
  return Sha256Schema.parse(hex)
}
