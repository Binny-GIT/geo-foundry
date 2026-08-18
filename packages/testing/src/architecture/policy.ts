export const PLANNED_PACKAGE_DIRECTORIES = [
  "compiler",
  "content-client",
  "domain",
  "publisher",
  "quality-rules",
  "render-core",
  "render-react",
  "runtime",
  "schema",
  "testing",
] as const

export const SERVING_PLANE_PACKAGES = new Set([
  "@geo/render-core",
  "@geo/render-react",
  "@geo/runtime",
])

export const CONTROL_PLANE_PACKAGES = new Set([
  "@geo/compiler",
  "@geo/content-client",
  "@geo/publisher",
  "@geo/quality-rules",
])

const runtimeForbiddenPackageNames = new Set([
  "@geo/compiler",
  "@geo/content-client",
  "@geo/publisher",
  "@geo/quality-rules",
  "ai",
  "bullmq",
  "ioredis",
  "openai",
  "payload",
  "pg",
  "postgres",
  "redis",
])

const runtimeForbiddenPrefixes = [
  "@ai-sdk/",
  "@geo/ai",
  "@geo/cms",
  "@geo/db",
  "@geo/queue",
  "@payloadcms/",
] as const

export function isRuntimeForbiddenPackage(packageName: string): boolean {
  return (
    runtimeForbiddenPackageNames.has(packageName) ||
    runtimeForbiddenPrefixes.some((prefix) => packageName.startsWith(prefix))
  )
}
