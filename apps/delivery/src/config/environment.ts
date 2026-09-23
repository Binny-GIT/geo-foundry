/*
 * 交付服务的环境变量装配。S3 连接相关变量名沿用 apps/worker 的
 * `GEO_FOUNDRY_S3_*` 约定（而不是 examples/site-b-express 那种单示例专属的
 * `GEO_FOUNDRY_SITE_B_S3_*`），因为这里已经是要部署的真实服务，
 * 变量名要能被 deploy/ 的 compose 直接复用（turbo.json 的
 * globalPassThroughEnv 里已经登记了这些变量名）。
 */
import { requiredCredentialOf } from "./credential-file.js"

export type DeliveryS3Options = {
  readonly accessKeyId: string
  readonly bucket: string
  readonly endpointHost: string
  readonly endpointPort: number
  readonly keyPrefix: string
  readonly secretAccessKey: string
  readonly timeoutMs: number
  readonly useSSL: boolean
}

export type DeliveryEnvironment = {
  readonly hostname: string
  readonly port: number
  readonly publicOrigin: string
  readonly s3: DeliveryS3Options
  readonly siteKeyringFile: string
}

const required = (environment: Record<string, string | undefined>, name: string): string => {
  const value = environment[name]?.trim()
  if (value === undefined || value.length === 0) {
    throw new Error(`DELIVERY_ENV_REQUIRED:${name}`)
  }
  return value
}

const positiveIntOf = (value: string, name: string): number => {
  if (!/^\d+$/.test(value)) {
    throw new Error(`DELIVERY_ENV_INVALID:${name}`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`DELIVERY_ENV_INVALID:${name}`)
  }
  return parsed
}

const timeoutMsOf = (value: string): number => {
  const parsed = positiveIntOf(value, "GEO_FOUNDRY_S3_TIMEOUT_MS")
  if (parsed < 100 || parsed > 30_000) {
    throw new Error("DELIVERY_ENV_INVALID:GEO_FOUNDRY_S3_TIMEOUT_MS")
  }
  return parsed
}

export const parseDeliveryS3Options = (
  environment: Record<string, string | undefined>,
): DeliveryS3Options => ({
  accessKeyId: requiredCredentialOf(environment, "GEO_FOUNDRY_S3_ACCESS_KEY"),
  bucket: environment["GEO_FOUNDRY_S3_BUCKET"]?.trim() || "geo-foundry",
  endpointHost: environment["GEO_FOUNDRY_S3_ENDPOINT"]?.trim() || "127.0.0.1",
  endpointPort: positiveIntOf(
    environment["GEO_FOUNDRY_S3_PORT"]?.trim() || "9000",
    "GEO_FOUNDRY_S3_PORT",
  ),
  keyPrefix: (environment["GEO_FOUNDRY_S3_KEY_PREFIX"]?.trim() || "objects").replace(/\/+$/, ""),
  secretAccessKey: requiredCredentialOf(environment, "GEO_FOUNDRY_S3_SECRET_KEY"),
  timeoutMs: timeoutMsOf(environment["GEO_FOUNDRY_S3_TIMEOUT_MS"]?.trim() || "5000"),
  useSSL: environment["GEO_FOUNDRY_S3_USE_SSL"] === "true",
})

export const parseDeliveryEnvironment = (
  environment: Record<string, string | undefined>,
): DeliveryEnvironment => {
  const publicOrigin = required(environment, "GEO_FOUNDRY_DELIVERY_PUBLIC_ORIGIN")
  let normalizedOrigin: string
  try {
    const url = new URL(publicOrigin)
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("invalid origin")
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("invalid origin")
    }
    normalizedOrigin = url.origin
  } catch {
    throw new Error("DELIVERY_ENV_INVALID:GEO_FOUNDRY_DELIVERY_PUBLIC_ORIGIN")
  }
  return {
    hostname: environment["HOSTNAME"]?.trim() || "127.0.0.1",
    port: positiveIntOf(environment["PORT"]?.trim() || "3091", "PORT"),
    publicOrigin: normalizedOrigin,
    s3: parseDeliveryS3Options(environment),
    siteKeyringFile: required(environment, "GEO_FOUNDRY_DELIVERY_SITE_KEYRING_FILE"),
  }
}
