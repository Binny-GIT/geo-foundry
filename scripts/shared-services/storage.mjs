import { createHash } from "node:crypto"

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3"

import { PROJECT_NAME, S3_SECRET_REF, SharedServicesError } from "./resources.mjs"

const requestTimeoutMs = 10_000

const sha256 = (value) => createHash("sha256").update(value).digest("hex")
const send = (client, command) =>
  client.send(command, { abortSignal: AbortSignal.timeout(requestTimeoutMs) })

const requireStatus = (output, fallback) => output.$metadata.httpStatusCode ?? fallback

const requireEtag = (output) => {
  if (output.ETag === undefined || output.ETag.length === 0) {
    throw new SharedServicesError(
      "SHARED_SERVICE_S3_ETAG_MISSING",
      "Confirm RustFS returns an ETag for conditional object writes.",
    )
  }
  return output.ETag
}

const expectFailureStatus = async (operation, expectedStatus, code) => {
  try {
    await operation()
  } catch (error) {
    if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === expectedStatus) {
      return expectedStatus
    }
    throw error
  }
  throw new SharedServicesError(
    code,
    `RustFS must reject this operation with HTTP ${expectedStatus}.`,
  )
}

const objectByKind = (resources, kind) => {
  const object = resources.s3.objects.find((candidate) => candidate.kind === kind)
  if (object === undefined) {
    throw new SharedServicesError(
      "SHARED_SERVICE_MANIFEST_MISMATCH",
      "Use an unmodified Geo Foundry run manifest with all required object entries.",
    )
  }
  return object
}

export const createS3ClientConfig = (environment) => ({
  endpoint: `${environment.GEO_FOUNDRY_S3_USE_SSL ? "https" : "http"}://${environment.GEO_FOUNDRY_S3_ENDPOINT}:${environment.GEO_FOUNDRY_S3_PORT}`,
  region: "us-east-1",
  forcePathStyle: environment.GEO_FOUNDRY_S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: environment.GEO_FOUNDRY_S3_ACCESS_KEY,
    secretAccessKey: environment.GEO_FOUNDRY_S3_SECRET_KEY,
  },
})

export const createS3Client = (environment) => new S3Client(createS3ClientConfig(environment))

export const redactEtag = (etag) => `sha256:${sha256(etag).slice(0, 16)}`

export const verifyS3 = async (environment, resources) => {
  const client = createS3Client(environment)
  const probe = objectByKind(resources, "probe")
  const pointer = objectByKind(resources, "pointer")
  const probeBody = Buffer.from(
    JSON.stringify({ project: PROJECT_NAME, runId: resources.redis.key }),
  )
  const pointerV1 = Buffer.from(JSON.stringify({ generation: 1 }))
  const pointerV2 = Buffer.from(JSON.stringify({ generation: 2 }))
  const pointerV3 = Buffer.from(JSON.stringify({ generation: 3 }))

  const probePut = await send(
    client,
    new PutObjectCommand({
      Bucket: resources.s3.bucket,
      Key: probe.key,
      Body: probeBody,
      ContentType: "application/json",
      IfNoneMatch: "*",
    }),
  )
  const probeGet = await send(
    client,
    new GetObjectCommand({ Bucket: resources.s3.bucket, Key: probe.key }),
  )
  if (probeGet.Body === undefined) {
    throw new SharedServicesError(
      "SHARED_SERVICE_S3_READ_EMPTY",
      "Confirm the Geo Foundry RustFS prefix permits object reads.",
    )
  }
  const downloadedProbe = Buffer.from(await probeGet.Body.transformToByteArray())
  if (sha256(downloadedProbe) !== sha256(probeBody)) {
    throw new SharedServicesError(
      "SHARED_SERVICE_S3_HASH_MISMATCH",
      "Confirm RustFS returns the exact object written under the run prefix.",
    )
  }
  const probeHead = await send(
    client,
    new HeadObjectCommand({ Bucket: resources.s3.bucket, Key: probe.key }),
  )

  const pointerCreate = await send(
    client,
    new PutObjectCommand({
      Bucket: resources.s3.bucket,
      Key: pointer.key,
      Body: pointerV1,
      ContentType: "application/json",
      IfNoneMatch: "*",
    }),
  )
  const initialEtag = requireEtag(pointerCreate)
  const createConflictStatus = await expectFailureStatus(
    () =>
      send(
        client,
        new PutObjectCommand({
          Bucket: resources.s3.bucket,
          Key: pointer.key,
          Body: pointerV1,
          ContentType: "application/json",
          IfNoneMatch: "*",
        }),
      ),
    412,
    "SHARED_SERVICE_S3_CONDITIONAL_CREATE_UNSAFE",
  )
  const pointerUpdate = await send(
    client,
    new PutObjectCommand({
      Bucket: resources.s3.bucket,
      Key: pointer.key,
      Body: pointerV2,
      ContentType: "application/json",
      IfMatch: initialEtag,
    }),
  )
  const updatedEtag = requireEtag(pointerUpdate)
  const staleUpdateStatus = await expectFailureStatus(
    () =>
      send(
        client,
        new PutObjectCommand({
          Bucket: resources.s3.bucket,
          Key: pointer.key,
          Body: pointerV3,
          ContentType: "application/json",
          IfMatch: initialEtag,
        }),
      ),
    412,
    "SHARED_SERVICE_S3_POINTER_CAS_UNSAFE",
  )

  const foreignPrefixStatus = await expectFailureStatus(
    () =>
      send(
        client,
        new HeadObjectCommand({
          Bucket: resources.s3.bucket,
          Key: `foreign/${resources.redis.key}/denied.json`,
        }),
      ),
    403,
    "SHARED_SERVICE_S3_FOREIGN_PREFIX_ALLOWED",
  )
  const bucketWideListStatus = await expectFailureStatus(
    () => send(client, new ListObjectsV2Command({ Bucket: resources.s3.bucket, MaxKeys: 1 })),
    403,
    "SHARED_SERVICE_S3_BUCKET_LIST_ALLOWED",
  )

  client.destroy()
  return {
    endpoint: createS3ClientConfig(environment).endpoint,
    bucket: resources.s3.bucket,
    prefix: resources.s3.prefix,
    secretRef: S3_SECRET_REF,
    crud: {
      put: requireStatus(probePut, 200),
      get: requireStatus(probeGet, 200),
      head: requireStatus(probeHead, 200),
      sha256: sha256(probeBody),
    },
    conditionalCreate: {
      created: requireStatus(pointerCreate, 200),
      existing: createConflictStatus,
    },
    pointerUpdate: {
      matched: requireStatus(pointerUpdate, 200),
      stale: staleUpdateStatus,
      initialEtag: redactEtag(initialEtag),
      updatedEtag: redactEtag(updatedEtag),
    },
    denials: { foreignPrefix: foreignPrefixStatus, bucketWideList: bucketWideListStatus },
  }
}

export const cleanupS3 = async (environment, manifest, client = createS3Client(environment)) => {
  const deleted = []
  for (const object of manifest.resources.s3.objects) {
    const output = await send(
      client,
      new DeleteObjectCommand({ Bucket: manifest.resources.s3.bucket, Key: object.key }),
    )
    deleted.push({ key: object.key, status: requireStatus(output, 204) })
  }
  client.destroy()
  return deleted
}
