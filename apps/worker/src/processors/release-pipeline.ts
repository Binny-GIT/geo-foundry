import { createHash } from "node:crypto"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { CompilerError, compileSite, type CompileRequest } from "@geo/compiler"
import {
  buildReleaseDirectory,
  createS3ArtifactStore,
  planRelease,
  publishRelease,
  verifyReleaseDirectory,
  type ArtifactStore,
} from "@geo/publisher"
import { ReleaseV1 } from "@geo/schema"

const { verifyManifest } = ReleaseV1
type PublishReceipt = ReleaseV1.PublishReceipt

import { TerminalJobError, type ProcessorContext } from "./types.js"

const COMPILER_VERSION = "1.0.0"

export const releaseIdOf = (operationId: string): string =>
  `rel-${createHash("sha256").update(operationId).digest("hex").slice(0, 24)}`

/**
 * Release identity for one compile: a fresh compile of an approved edition
 * mints a new deterministic id from its operation; recompiling an edition
 * that is already compiled (the publish-gate re-derives the same artifact
 * before uploading) MUST reuse the persisted release id, or the publish
 * receipt would report a release the compile-results evidence never agreed
 * to.
 */
export const releaseIdentityFor = (
  operationId: string,
  edition: { readonly compiledRelease: string | null; readonly workflowStatus: string },
): string =>
  edition.workflowStatus === "compiled" && edition.compiledRelease !== null
    ? edition.compiledRelease
    : releaseIdOf(operationId)

export type WorkerS3Options = {
  readonly accessKeyId: string
  readonly bucket: string
  readonly endpointHost: string
  readonly endpointPort: number
  readonly keyPrefix: string
  readonly secretAccessKey: string
  readonly useSSL: boolean
}

export const parseWorkerS3Options = (
  env: Record<string, string | undefined>,
  credential: (name: string) => string,
): WorkerS3Options => {
  const accessKeyId = credential("GEO_FOUNDRY_S3_ACCESS_KEY")
  const secretAccessKey = credential("GEO_FOUNDRY_S3_SECRET_KEY")
  const options: WorkerS3Options = {
    accessKeyId,
    bucket: env["GEO_FOUNDRY_S3_BUCKET"] ?? "geo-foundry",
    endpointHost: env["GEO_FOUNDRY_S3_ENDPOINT"] ?? "127.0.0.1",
    endpointPort: Number(env["GEO_FOUNDRY_S3_PORT"] ?? "9000") || 9000,
    keyPrefix: env["GEO_FOUNDRY_S3_KEY_PREFIX"] ?? "objects",
    secretAccessKey,
    useSSL: env["GEO_FOUNDRY_S3_USE_SSL"] === "true",
  }
  if (
    options.accessKeyId.length === 0 ||
    options.accessKeyId === "unset" ||
    options.secretAccessKey.length === 0 ||
    options.secretAccessKey === "unset"
  ) {
    throw new TerminalJobError(
      "RELEASE_S3_ENV_INVALID",
      "GEO_FOUNDRY_S3_ACCESS_KEY/SECRET_KEY required",
    )
  }
  return options
}

export const createWorkerArtifactStore = (options: WorkerS3Options): ArtifactStore =>
  createS3ArtifactStore({
    bucket: options.bucket,
    clientConfig: {
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
      endpoint: `${options.useSSL ? "https" : "http"}://${options.endpointHost}:${options.endpointPort}`,
      forcePathStyle: true,
      region: "us-east-1",
    },
    keyPrefix: options.keyPrefix,
  })

type ReleaseBuildInput = Parameters<typeof planRelease>[0]

export type PlannedSiteRelease = {
  readonly buildInput: ReleaseBuildInput
  readonly compileOutput: Awaited<ReturnType<typeof compileSite>>
  readonly manifestSha256: string
  readonly objectCount: number
  readonly plan: Awaited<ReturnType<typeof planRelease>>
  readonly releaseId: string
  readonly verifiedManifest: Awaited<ReturnType<typeof verifyManifest>>
}

/**
 * Deterministic release identity: initial compilation derives the release id
 * from its operation; publication of an already compiled edition reuses that
 * persisted release id. The content clock remains the edition's modifiedAt,
 * so retries rebuild byte-identical plans before the staged directory is
 * verified and handed on.
 */
export const compileAndPlanRelease = async (
  context: ProcessorContext,
  input: { readonly editionId: number; readonly operationId: string },
): Promise<PlannedSiteRelease> => {
  const edition = await context.client.getEditionInput(input.editionId)
  if (edition.workflowStatus !== "approved" && edition.workflowStatus !== "compiled") {
    throw new TerminalJobError(
      "RELEASE_EDITION_NOT_APPROVED",
      `edition ${input.editionId} is ${edition.workflowStatus}`,
    )
  }
  const snapshot = await context.client.getCompileSnapshot(edition.siteId)
  let compileOutput: Awaited<ReturnType<typeof compileSite>>
  try {
    compileOutput = await compileSite({
      ...(snapshot as unknown as Omit<CompileRequest, "clock" | "compilerVersion">),
      clock: { now: edition.modifiedAt },
      compilerVersion: COMPILER_VERSION,
    })
  } catch (error) {
    if (error instanceof CompilerError) {
      throw new TerminalJobError(error.code, error.message)
    }
    throw error
  }
  const releaseId = releaseIdentityFor(input.operationId, edition)
  const siteKey = `site-${edition.siteId}`
  const routingManifest = {
    hosts: [
      {
        canonical: true,
        host: (snapshot.site as { readonly canonicalDomain: string }).canonicalDomain,
        siteId: siteKey,
      },
    ],
    schemaVersion: 1 as const,
  }
  const buildInput: ReleaseBuildInput = {
    compileOutput,
    createdAt: edition.modifiedAt,
    releaseId,
    routingManifest,
    siteId: siteKey,
    sourceVersionIds: [`edition-${input.editionId}-input-${edition.inputHash}`],
  }
  const plan = await planRelease(buildInput)
  const stagingRoot = await mkdtemp(join(tmpdir(), `geo-release-${releaseId}-`))
  const built = await buildReleaseDirectory({ ...buildInput, stagingRoot })
  const verified = await verifyReleaseDirectory({ releaseRoot: built.releaseRoot })
  const verifiedManifest = await verifyManifest(plan.manifest)
  return {
    buildInput,
    compileOutput,
    manifestSha256: verifiedManifest.manifestSha256,
    objectCount: verified.manifest.objects.length,
    plan,
    releaseId,
    verifiedManifest,
  }
}

export const publishPlannedRelease = async (
  context: ProcessorContext,
  input: {
    readonly editionId: number
    readonly operationId: string
    readonly planned: PlannedSiteRelease
    readonly store: ArtifactStore
  },
): Promise<PublishReceipt> => {
  const result = await publishRelease({
    actor: { actorId: "geo-foundry-worker" as never, kind: "service" },
    planned: input.planned.plan,
    store: input.store,
    verifiedManifest: input.planned.verifiedManifest,
  })
  const edition = await context.client.getEditionInput(input.editionId)
  await context.client.recordPublishedRelease(edition.siteId, {
    editionId: input.editionId,
    operationId: input.operationId,
    receipt: result.receipt,
  })
  return result.receipt
}
