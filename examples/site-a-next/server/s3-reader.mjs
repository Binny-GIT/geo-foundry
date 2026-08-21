import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3"

const physicalKey = (prefix, key) => `${prefix}/${key}`
const etagOf = (value) => value === undefined ? '"-"' : `"${value.replaceAll('"', "")}"`

const notFound = (error) =>
  typeof error === "object" &&
  error !== null &&
  (("name" in error && (error.name === "NotFound" || error.name === "NoSuchKey")) ||
    ("$metadata" in error &&
      typeof error.$metadata === "object" &&
      error.$metadata !== null &&
      "httpStatusCode" in error.$metadata &&
      error.$metadata.httpStatusCode === 404))

export const createSiteAObjectReader = (environment) => {
  const client = new S3Client({
    credentials: { accessKeyId: environment.accessKey, secretAccessKey: environment.secretKey },
    endpoint: environment.endpoint,
    forcePathStyle: true,
    region: "rustfs",
  })
  return Object.freeze({
    async head(key) {
      try {
        const output = await client.send(
          new HeadObjectCommand({ Bucket: environment.bucket, Key: physicalKey(environment.keyPrefix, key) }),
          { abortSignal: AbortSignal.timeout(environment.timeoutMs) },
        )
        return {
          bytes: output.ContentLength ?? 0,
          contentType: output.ContentType ?? "application/octet-stream",
          etag: etagOf(output.ETag),
        }
      } catch (error) {
        if (notFound(error)) return null
        throw error
      }
    },
    async read(key) {
      try {
        const output = await client.send(
          new GetObjectCommand({ Bucket: environment.bucket, Key: physicalKey(environment.keyPrefix, key) }),
          { abortSignal: AbortSignal.timeout(environment.timeoutMs) },
        )
        const body = await output.Body?.transformToByteArray()
        if (body === undefined) throw new Error("SITE_A_S3_BODY_MISSING")
        return {
          body: new Uint8Array(body),
          bytes: body.byteLength,
          contentType: output.ContentType ?? "application/octet-stream",
          etag: etagOf(output.ETag),
        }
      } catch (error) {
        if (notFound(error)) return null
        throw error
      }
    },
    destroy() {
      client.destroy()
    },
  })
}
