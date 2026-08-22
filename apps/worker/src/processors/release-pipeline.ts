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
  readSecret: (path: string) => string,
): WorkerS3Options => {
  const directOrFile = (direct: string | undefined, file: string | undefined): string => {
    if (direct !== undefined && direct.length > 0) {
      return direct
    }
    if (file !== undefined && file.length > 0) {
      return readSecret(file)
    }
    return ""
  }
  const options: WorkerS3Options = {
    accessKeyId: directOrFile(
      env["GEO_FOUNDRY_S3_ACCESS_KEY"],
      env["GEO_FOUNDRY_S3_ACCESS_KEY_FILE"],
    ),
    bucket: env["GEO_FOUNDRY_S3_BUCKET"] ?? "geo-foundry",
    endpointHost: env["GEO_FOUNDRY_S3_ENDPOINT"] ?? "127.0.0.1",
    endpointPort: Number(env["GEO_FOUNDRY_S3_PORT"] ?? "9000") || 9000,
    keyPrefix: env["GEO_FOUNDRY_S3_KEY_PREFIX"] ?? "objects",
    secretAccessKey: directOrFile(
      env["GEO_FOUNDRY_S3_SECRET_KEY"],
      env["GEO_FOUNDRY_S3_SECRET_KEY_FILE"],
    ),
    useSSL: env["GEO_FOUNDRY_S3_USE_SSL"] === "true",
  }
  if (options.accessKeyId.length === 0 || options.secretAccessKey.length === 0) {
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
 * Deterministic release identity: the release id derives from the operation
 * id and the clock from the target edition's modifiedAt, so the compile
 * stage and the publish gate rebuild byte-identical plans from the same
 * ledger state even across process crashes. The staged directory is fully
 * verified before the plan is handed on.
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
  const releaseId = releaseIdOf(input.operationId)
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
    sourceVersionIds: [`edition-${input.editionId}-rev-${edition.workflowRevision}`],
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
    operationId: input.operationId,
    receipt: result.receipt,
  })
  return result.receipt
}
