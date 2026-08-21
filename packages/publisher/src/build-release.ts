import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

import { canonicalJson, type CompileOutput } from "@geo/compiler"
import {
  CanonicalTimestampSchema,
  CompilerVersionSchema,
  ContentTypeSchema,
  ReleaseArtifactPathSchema,
  ReleaseIdSchema,
  ReleaseManifestSchema,
  type RoutingManifestInput,
  serializeRoutingManifest,
  Sha256Schema,
  SiteIdSchema,
  SourceVersionIdSchema,
  type ImmutableArtifact,
  type ReleaseManifest,
} from "@geo/schema/release/v1"

import { ReleaseBuildError, RELEASE_BUILD_ERROR_CODE } from "./errors.js"

export const JSON_CONTENT_TYPE = "application/json"
export const XML_CONTENT_TYPE = "application/xml"

export type PlannedObject = {
  readonly body: Uint8Array
  readonly bytes: number
  readonly contentType: string
  readonly path: string
  readonly sha256: string
}

export type PlannedRelease = {
  readonly manifest: ReleaseManifest
  /** Everything except manifest.json - the manifest is written last. */
  readonly objects: readonly PlannedObject[]
  readonly plannedManifest: PlannedObject
}

export type MediaObject = {
  readonly body: Uint8Array
  readonly contentType: string
  /** Release-relative path, e.g. media/map.webp. */
  readonly path: string
}

export type ReleaseBuildInput = {
  readonly compileOutput: CompileOutput
  /** Canonical millisecond-precision UTC instant; fixed input means fixed bytes. */
  readonly createdAt: string
  readonly mediaObjects?: readonly MediaObject[]
  readonly releaseId: string
  readonly routingManifest: RoutingManifestInput
  readonly siteId: string
  readonly sourceVersionIds: readonly string[]
}

const SUPPORTED_COMPILER_MAJOR = 1

const encoder = new TextEncoder()

export const sha256Of = (body: Uint8Array): string =>
  createHash("sha256").update(body).digest("hex")

const objectOf = (path: string, body: Uint8Array, contentType: string): PlannedObject => ({
  body,
  bytes: body.byteLength,
  contentType,
  path,
  sha256: sha256Of(body),
})

const safeArtifactPath = (path: string, label: string): string => {
  const parsed = ReleaseArtifactPathSchema.safeParse(path)
  if (!parsed.success) {
    throw new ReleaseBuildError(
      RELEASE_BUILD_ERROR_CODE.RELEASE_PATH_UNSAFE,
      `${label} path "${path}" is not a safe release-relative artifact path`,
      "failed",
    )
  }
  return path
}

const assertCompilerSupported = (compilerVersion: string): void => {
  const parsed = CompilerVersionSchema.safeParse(compilerVersion)
  if (!parsed.success || Number(compilerVersion.split(".")[0]) !== SUPPORTED_COMPILER_MAJOR) {
    throw new ReleaseBuildError(
      RELEASE_BUILD_ERROR_CODE.RELEASE_COMPILER_UNSUPPORTED,
      `compiler version "${compilerVersion}" is not a supported ${SUPPORTED_COMPILER_MAJOR}.x semver release producer`,
      "failed",
    )
  }
}

/**
 * Pure release layout planning: page documents at their route object keys,
 * routes.json, sitemap.xml, the routing candidate, media objects, and the
 * manifest derived from all of them. Identical input yields identical
 * bytes, paths, and hashes with no filesystem access at all.
 */
export const planRelease = (input: ReleaseBuildInput): PlannedRelease => {
  const siteId = SiteIdSchema.parse(input.siteId)
  const releaseId = ReleaseIdSchema.parse(input.releaseId)
  const createdAt = CanonicalTimestampSchema.parse(input.createdAt)
  assertCompilerSupported(input.compileOutput.compilerVersion)
  if (input.compileOutput.routeIndex.schemaVersion !== 1) {
    throw new ReleaseBuildError(
      RELEASE_BUILD_ERROR_CODE.RELEASE_SCHEMA_UNSUPPORTED,
      `route index schemaVersion ${String(input.compileOutput.routeIndex.schemaVersion)} is not supported`,
      "failed",
    )
  }
  for (const versionId of input.sourceVersionIds) {
    SourceVersionIdSchema.parse(versionId)
  }

  const objects: PlannedObject[] = []
  const paths = new Set<string>()
  const add = (object: PlannedObject): void => {
    if (paths.has(object.path)) {
      throw new ReleaseBuildError(
        RELEASE_BUILD_ERROR_CODE.RELEASE_OBJECT_PATH_DUPLICATE,
        `two release objects claim path ${object.path}`,
        "failed",
      )
    }
    paths.add(object.path)
    objects.push(object)
  }

  for (const document of input.compileOutput.documents) {
    const route = input.compileOutput.routeIndex.routes.find(
      (candidate) => candidate.pathname === document.pathname,
    )
    if (route === undefined || !("objectKey" in route)) {
      throw new ReleaseBuildError(
        RELEASE_BUILD_ERROR_CODE.RELEASE_MANIFEST_INVALID,
        `compiled document ${document.pathname} has no page object route`,
        "failed",
      )
    }
    const path = safeArtifactPath(route.objectKey, "page document")
    add(objectOf(path, encoder.encode(document.canonical), JSON_CONTENT_TYPE))
  }
  add(
    objectOf(
      "routes.json",
      encoder.encode(canonicalJson(input.compileOutput.routeIndex)),
      JSON_CONTENT_TYPE,
    ),
  )
  add(objectOf("sitemap.xml", encoder.encode(input.compileOutput.sitemap), XML_CONTENT_TYPE))
  add(objectOf("routing-candidate.json", serializeRoutingManifest(input.routingManifest), JSON_CONTENT_TYPE))
  for (const media of input.mediaObjects ?? []) {
    add(objectOf(safeArtifactPath(media.path, "media object"), media.body, media.contentType))
  }

  const manifestInput = {
    compilerVersion: input.compileOutput.compilerVersion,
    createdAt,
    objects: objects.map(
      (object): ImmutableArtifact => ({
        bytes: object.bytes,
        contentType: ContentTypeSchema.parse(object.contentType),
        path: ReleaseArtifactPathSchema.parse(object.path),
        sha256: Sha256Schema.parse(object.sha256),
      }),
    ),
    releaseId,
    schemaVersion: 1,
    siteId,
    sourceVersionIds: [...input.sourceVersionIds],
  }
  const manifestParsed = ReleaseManifestSchema.safeParse(manifestInput)
  if (!manifestParsed.success) {
    throw new ReleaseBuildError(
      RELEASE_BUILD_ERROR_CODE.RELEASE_MANIFEST_INVALID,
      `planned release failed the manifest contract: ${manifestParsed.error.issues
        .map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`)
        .join("; ")}`,
      "failed",
    )
  }
  const manifest = manifestParsed.data
  const manifestBody = encoder.encode(JSON.stringify(manifest))
  return {
    manifest,
    objects,
    plannedManifest: objectOf("manifest.json", manifestBody, JSON_CONTENT_TYPE),
  }
}

export type BuiltRelease = {
  /** Byte-exact manifest plus hashes, for receipts and observability. */
  readonly artifactManifest: readonly ImmutableArtifact[]
  readonly manifestPath: string
  readonly objectInventory: readonly {
    readonly bytes: number
    readonly path: string
    readonly sha256: string
  }[]
  readonly releaseRoot: string
  readonly state: "built"
}

/**
 * Writes the planned release under the staging root at
 * sites/&lt;siteId&gt;/releases/&lt;releaseId&gt;/: every object first,
 * manifest.json strictly last, so an interrupted build can never leave a
 * directory that verifies. The staging metadata files land at the staging
 * root, outside the immutable release prefix.
 */
export const buildReleaseDirectory = async (
  input: ReleaseBuildInput & { readonly stagingRoot: string },
): Promise<BuiltRelease> => {
  const plan = planRelease(input)
  const releaseRoot = resolve(input.stagingRoot, "sites", input.siteId, "releases", input.releaseId)
  const write = async (object: PlannedObject): Promise<void> => {
    const target = join(releaseRoot, object.path)
    if (!target.startsWith(releaseRoot)) {
      throw new ReleaseBuildError(
        RELEASE_BUILD_ERROR_CODE.RELEASE_PATH_UNSAFE,
        `object path ${object.path} escapes the release root`,
        "failed",
      )
    }
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, object.body)
  }
  try {
    for (const object of plan.objects) {
      await write(object)
    }
    await write(plan.plannedManifest)
    const inventory = [...plan.objects, plan.plannedManifest].map((object) => ({
      bytes: object.bytes,
      path: object.path,
      sha256: object.sha256,
    }))
    await writeFile(
      join(input.stagingRoot, "artifact-manifest.json"),
      `${JSON.stringify(plan.manifest, null, 2)}\n`,
    )
    await writeFile(
      join(input.stagingRoot, "object-inventory.json"),
      `${JSON.stringify(inventory, null, 2)}\n`,
    )
  } catch (error) {
    if (error instanceof ReleaseBuildError) {
      throw error
    }
    throw new ReleaseBuildError(
      RELEASE_BUILD_ERROR_CODE.RELEASE_WRITE_FAILED,
      `release ${input.releaseId} staging write failed: ${error instanceof Error ? error.message : String(error)}`,
      "failed",
    )
  }
  return {
    artifactManifest: plan.manifest.objects,
    manifestPath: join(releaseRoot, "manifest.json"),
    objectInventory: [
      ...plan.manifest.objects.map((object) => ({
        bytes: object.bytes,
        path: object.path,
        sha256: object.sha256,
      })),
      {
        bytes: plan.plannedManifest.bytes,
        path: "manifest.json",
        sha256: plan.plannedManifest.sha256,
      },
    ],
    releaseRoot,
    state: "built",
  }
}
