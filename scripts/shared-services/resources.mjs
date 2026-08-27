import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { z } from "zod"

export const PROJECT_NAME = "geo-foundry"
export const PROJECT_DATABASE = "geo_foundry"
export const PROJECT_SCHEMA = "geo_foundry"
export const PROJECT_BUCKET = "geo-foundry"
export const S3_SECRET_REF = "rustfs-geo-foundry-svc"

const runIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{2,47}$/)
const objectResourceSchema = z
  .object({
    kind: z.union([z.literal("probe"), z.literal("pointer")]),
    key: z.string(),
  })
  .strict()
const manifestSchema = z
  .object({
    version: z.literal(2),
    project: z.literal(PROJECT_NAME),
    runId: runIdSchema,
    resources: z
      .object({
        postgres: z
          .object({
            database: z.literal(PROJECT_DATABASE),
            schema: z.literal(PROJECT_SCHEMA),
            table: z.string(),
          })
          .strict(),
        redis: z.object({ key: z.string() }).strict(),
        s3: z
          .object({
            bucket: z.literal(PROJECT_BUCKET),
            prefix: z.string(),
            objects: z.array(objectResourceSchema).length(2),
          })
          .strict(),
      })
      .strict(),
  })
  .strict()

export class SharedServicesError extends Error {
  constructor(code, remediation) {
    super(code)
    this.name = "SharedServicesError"
    this.code = code
    this.remediation = remediation
  }
}

export const assertRunId = (runId) => {
  const parsed = runIdSchema.safeParse(runId)
  if (!parsed.success) {
    throw new SharedServicesError(
      "SHARED_SERVICE_RUN_ID_INVALID",
      "Use a lowercase, hyphen-delimited run ID between 3 and 48 characters.",
    )
  }
  return parsed.data
}

export const s3PrefixForRun = (runId) => `objects/${assertRunId(runId)}/`

export const assertPermittedS3Key = (runId, key) => {
  const prefix = s3PrefixForRun(runId)
  if (!key.startsWith(prefix) || key === prefix) {
    throw new SharedServicesError(
      "SHARED_SERVICE_FOREIGN_PREFIX",
      "Cleanup may access only object keys from the matching Geo Foundry run prefix.",
    )
  }
  return key
}

export const resourcesForRun = (runId) => {
  const verifiedRunId = assertRunId(runId)
  const prefix = s3PrefixForRun(verifiedRunId)
  return {
    postgres: {
      database: PROJECT_DATABASE,
      schema: PROJECT_SCHEMA,
      table: `shared_service_probe_${verifiedRunId.replaceAll("-", "_")}`,
    },
    redis: { key: `${PROJECT_NAME}:${verifiedRunId}:connectivity` },
    s3: {
      bucket: PROJECT_BUCKET,
      prefix,
      objects: [
        { kind: "probe", key: `${prefix}connectivity.json` },
        { kind: "pointer", key: `${prefix}pointer/current.json` },
      ],
    },
  }
}

export const createManifest = (runId) => ({
  version: 2,
  project: PROJECT_NAME,
  runId: assertRunId(runId),
  resources: resourcesForRun(runId),
})

const stateDirectory = () =>
  resolve(process.env.GEO_FOUNDRY_SHARED_SERVICES_STATE_DIR ?? "temp/shared-services")

export const manifestPathForRun = (runId) =>
  join(stateDirectory(), "manifests", `${assertRunId(runId)}.json`)

export const writeManifest = async (manifest) => {
  const parsed = manifestSchema.parse(manifest)
  const path = manifestPathForRun(parsed.runId)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
  return path
}

const parseManifest = (manifest) => {
  const parsed = manifestSchema.safeParse(manifest)
  if (!parsed.success) {
    throw new SharedServicesError(
      "SHARED_SERVICE_MANIFEST_MISMATCH",
      "Use the matching --run-id and an unmodified Geo Foundry run manifest.",
    )
  }
  return parsed.data
}

export const readManifest = async (runId) => {
  const path = manifestPathForRun(runId)
  const contents = await readFile(path, "utf8")
  return parseManifest(JSON.parse(contents))
}

export const assertManifestForRun = (manifest, runId) => {
  const parsed = parseManifest(manifest)
  if (parsed.runId !== runId) {
    throw new SharedServicesError(
      "SHARED_SERVICE_MANIFEST_MISMATCH",
      "Use the matching --run-id and an unmodified Geo Foundry run manifest.",
    )
  }
  for (const object of parsed.resources.s3.objects) {
    assertPermittedS3Key(runId, object.key)
  }
  const expected = createManifest(runId)
  if (JSON.stringify(parsed.resources) !== JSON.stringify(expected.resources)) {
    throw new SharedServicesError(
      "SHARED_SERVICE_MANIFEST_MISMATCH",
      "Use the matching --run-id and an unmodified Geo Foundry run manifest.",
    )
  }
  return parsed
}
