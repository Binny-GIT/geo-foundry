import { createHash } from "node:crypto"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { GetObjectCommand, type GetObjectCommandOutput, S3Client } from "@aws-sdk/client-s3"
import {
  CompilerError,
  compileSite,
  GEO_MEDIA_PATH_PREFIX,
  type CompileRequest,
} from "@geo/compiler"
import {
  buildReleaseDirectory,
  createS3ArtifactStore,
  planRelease,
  publishRelease,
  verifyReleaseDirectory,
  type ArtifactStore,
  type MediaObject,
} from "@geo/publisher"
import { ReleaseV1 } from "@geo/schema"

const { verifyManifest } = ReleaseV1
type PublishReceipt = ReleaseV1.PublishReceipt

import { workerCredentialOf } from "../config/credentials.js"
import { TerminalJobError, type ProcessorContext } from "./types.js"

const COMPILER_VERSION = "1.0.0"

/**
 * A2 多站：release id 恒由 operationId 确定性推导（一站一条操作、一条操作
 * 一个 release）。重试/重放同一条操作必得同一 release，台账证据与发布回执
 * 因此天然对齐；不再复用"文章最近一次 compiledRelease"（多站后该单值
 * 属于另一个站点的 release）。
 */
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

/**
 * 媒体对象在 release 键空间之外：artifact store 的 read 只认 sites/... 键，
 * 取媒体字节要独立的 S3 客户端按物理键读。前缀默认与 CMS 的
 * CMS_MEDIA_PREFIX 保持一致（objects/media）。
 */
export const DEFAULT_MEDIA_PREFIX = "objects/media"

export type WorkerMediaOptions = WorkerS3Options & { readonly mediaPrefix: string }

export const parseWorkerMediaOptions = (
  env: Record<string, string | undefined>,
  credential: (name: string) => string,
): WorkerMediaOptions => ({
  ...parseWorkerS3Options(env, credential),
  mediaPrefix: (env["GEO_FOUNDRY_S3_MEDIA_PREFIX"] ?? DEFAULT_MEDIA_PREFIX).replace(/\/+$/, ""),
})

export const createWorkerMediaClient = (options: WorkerMediaOptions): S3Client =>
  new S3Client({
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
    endpoint: `${options.useSSL ? "https" : "http"}://${options.endpointHost}:${options.endpointPort}`,
    forcePathStyle: true,
    region: "us-east-1",
  })

/** 媒体对象键：<mediaPrefix>/tenants/<租户>/<文件名>，与 CMS 上传布局一致。 */
export const mediaObjectKeyOf = (
  mediaPrefix: string,
  tenantId: number,
  filename: string,
): string => `${mediaPrefix}/tenants/${tenantId}/${filename}`

/**
 * 编译快照的媒体条目是 CMS 的传输数据（tenantId/mimeType 编译过程忽略）；
 * 这里把整站引用到的媒体字节从对象存储读进 release，同一文件名只读一次。
 * 对象不存在是确定性数据丢失（终态错误），其他 S3 错误向上抛交给队列重试。
 */
export const collectMediaObjects = async (
  snapshot: { readonly editions: readonly Record<string, unknown>[] },
  options: WorkerMediaOptions,
  client?: S3Client,
): Promise<MediaObject[]> => {
  const s3 = client ?? createWorkerMediaClient(options)
  const seen = new Set<string>()
  const objects: MediaObject[] = []
  for (const edition of snapshot.editions) {
    const media = edition["media"]
    if (!Array.isArray(media)) continue
    for (const entry of media) {
      if (entry === null || typeof entry !== "object") continue
      const row = entry as Record<string, unknown>
      const path = typeof row["path"] === "string" ? row["path"] : ""
      if (!path.startsWith(GEO_MEDIA_PATH_PREFIX)) continue
      const filename = path.slice(GEO_MEDIA_PATH_PREFIX.length)
      if (seen.has(filename) || filename.length === 0 || filename.includes("/")) continue
      const tenantId = typeof row["tenantId"] === "number" ? row["tenantId"] : undefined
      if (tenantId === undefined) {
        throw new TerminalJobError(
          "RELEASE_MEDIA_OPTIONS_INVALID",
          `media ${filename} has no tenantId in the compile snapshot`,
        )
      }
      let result: GetObjectCommandOutput
      try {
        result = await s3.send(
          new GetObjectCommand({
            Bucket: options.bucket,
            Key: mediaObjectKeyOf(options.mediaPrefix, tenantId, filename),
          }),
        )
      } catch (error) {
        if (error instanceof Error && error.name === "NoSuchKey") {
          throw new TerminalJobError(
            "RELEASE_MEDIA_FETCH_FAILED",
            `media object ${filename} is missing from the object store`,
          )
        }
        throw error
      }
      const bytes = await result.Body?.transformToByteArray()
      if (bytes === undefined) {
        throw new TerminalJobError(
          "RELEASE_MEDIA_FETCH_FAILED",
          `media object ${filename} has an empty body`,
        )
      }
      const mimeType = typeof row["mimeType"] === "string" ? row["mimeType"] : ""
      seen.add(filename)
      objects.push({
        body: new Uint8Array(bytes),
        contentType: mimeType || result.ContentType || "application/octet-stream",
        path: `media/${filename}`,
      })
    }
  }
  return objects
}

type ReleaseBuildInput = Parameters<typeof planRelease>[0]

export type PlannedSiteRelease = {
  readonly buildInput: ReleaseBuildInput
  readonly compileOutput: Awaited<ReturnType<typeof compileSite>>
  readonly manifestSha256: string
  readonly objectCount: number
  readonly plan: Awaited<ReturnType<typeof planRelease>>
  readonly releaseId: string
  /** A2：本条操作编译发布的目标站点（任务 siteId 或文章单数站点回退）。 */
  readonly siteId: number
  readonly verifiedManifest: Awaited<ReturnType<typeof verifyManifest>>
}

/**
 * A2 多站：按任务载荷里的 siteId 编译发布（缺省时回退文章单数站点，
 * 兼容旧在途任务）；release id 恒由 operationId 确定性推导。内容时钟
 * 仍是文章 modifiedAt，重试重建字节一致的 plan。
 */
export const compileAndPlanRelease = async (
  context: ProcessorContext,
  input: { readonly editionId: number; readonly operationId: string; readonly siteId?: number },
): Promise<PlannedSiteRelease> => {
  const edition = await context.client.getEditionInput(input.editionId)
  // 他站已发布后的单站重试：文章已 published 但目标站行未发布，允许。
  const isPublishedSiteRetry = edition.workflowStatus === "published" && input.siteId !== undefined
  if (
    edition.workflowStatus !== "approved" &&
    edition.workflowStatus !== "compiled" &&
    !isPublishedSiteRetry
  ) {
    throw new TerminalJobError(
      "RELEASE_EDITION_NOT_APPROVED",
      `edition ${input.editionId} is ${edition.workflowStatus}`,
    )
  }
  const siteId = input.siteId ?? edition.siteId
  const snapshot = await context.client.getCompileSnapshot(siteId)
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
  const siteKey = `site-${siteId}`
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
  // 编译器已保证快照里每个 geo 图片引用都有条目；这里只负责把字节带进产物。
  const mediaOptions = parseWorkerMediaOptions(process.env, (name) =>
    workerCredentialOf(process.env, name),
  )
  const mediaObjects = await collectMediaObjects(snapshot, mediaOptions)
  const buildInput: ReleaseBuildInput = {
    compileOutput,
    createdAt: edition.modifiedAt,
    ...(mediaObjects.length === 0 ? {} : { mediaObjects }),
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
    siteId,
    verifiedManifest,
  }
}

export const publishPlannedRelease = async (
  context: ProcessorContext,
  input: {
    readonly editionId: number
    readonly operationId: string
    readonly planned: PlannedSiteRelease
    readonly siteId?: number
    readonly store: ArtifactStore
  },
): Promise<PublishReceipt> => {
  const result = await publishRelease({
    actor: { actorId: "geo-foundry-worker" as never, kind: "service" },
    planned: input.planned.plan,
    store: input.store,
    verifiedManifest: input.planned.verifiedManifest,
  })
  // 回执登记的任务站点；旧载荷无 siteId 时回退文章单数站点。
  const siteId =
    input.siteId ?? (await context.client.getEditionInput(input.editionId)).siteId
  await context.client.recordPublishedRelease(siteId, {
    editionId: input.editionId,
    operationId: input.operationId,
    receipt: result.receipt,
  })
  return result.receipt
}
