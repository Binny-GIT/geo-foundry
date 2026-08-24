import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

const RUN_ID_PATTERN = /^admin-ui-\d{8}-[a-z0-9]{8,32}$/
const MANIFEST_VERSION = 1

export const TRACKED_COLLECTIONS = new Set([
  "tenants",
  "users",
  "sites",
  "domains",
  "contents",
  "content-editions",
  "media",
  "url-records",
  "quality-assessments",
  "releases",
  "rollback-intents",
  "operations",
  "outbox-events",
  "idempotency-records",
])

const nonEmptyString = (value, code) => {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(code)
  return value.trim()
}

const positiveId = (value, code) => {
  if (!Number.isInteger(value) || value <= 0) throw new Error(code)
  return value
}

export const assertRunId = (runId) => {
  const value = nonEmptyString(runId, "ADMIN_UI_RUN_ID_REQUIRED")
  if (!RUN_ID_PATTERN.test(value)) throw new Error("ADMIN_UI_RUN_ID_INVALID")
  return value
}

export const createRunId = (now = new Date(), random = crypto.randomUUID()) => {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "")
  const suffix = random.replaceAll("-", "").toLowerCase().slice(0, 12)
  return assertRunId(`admin-ui-${date}-${suffix}`)
}

const manifestDirectoryOf = (root, runId) => resolve(root, ".test", "admin-ui-evidence", assertRunId(runId))

export const manifestPathOf = (root, runId) => `${manifestDirectoryOf(root, runId)}/fixture-manifest.json`

const assertManifestPath = (root, filePath) => {
  const allowed = resolve(root, ".test", "admin-ui-evidence")
  const candidate = resolve(filePath)
  if (!candidate.startsWith(`${allowed}/`)) throw new Error("ADMIN_UI_MANIFEST_PATH_FORBIDDEN")
  return candidate
}

export const createFixtureManifest = ({ runId, baseUrl, createdAt = new Date().toISOString() }) => ({
  baseUrl: nonEmptyString(baseUrl, "ADMIN_UI_MANIFEST_BASE_URL_REQUIRED"),
  createdAt: nonEmptyString(createdAt, "ADMIN_UI_MANIFEST_CREATED_AT_REQUIRED"),
  objects: [],
  records: [],
  runId: assertRunId(runId),
  status: "active",
  version: MANIFEST_VERSION,
})

const normalizeRecord = (record, runId) => {
  if (typeof record !== "object" || record === null) throw new Error("ADMIN_UI_MANIFEST_RECORD_INVALID")
  const collection = nonEmptyString(record.collection, "ADMIN_UI_MANIFEST_COLLECTION_REQUIRED")
  if (!TRACKED_COLLECTIONS.has(collection)) throw new Error("ADMIN_UI_MANIFEST_COLLECTION_FORBIDDEN")
  const marker = nonEmptyString(record.marker, "ADMIN_UI_MANIFEST_MARKER_REQUIRED")
  if (!marker.includes(runId)) throw new Error("ADMIN_UI_MANIFEST_MARKER_MISMATCH")
  return {
    collection,
    createdAt: nonEmptyString(record.createdAt, "ADMIN_UI_MANIFEST_RECORD_CREATED_AT_REQUIRED"),
    id: positiveId(record.id, "ADMIN_UI_MANIFEST_RECORD_ID_INVALID"),
    marker,
    ...(typeof record.tenantId === "number" ? { tenantId: positiveId(record.tenantId, "ADMIN_UI_MANIFEST_TENANT_ID_INVALID") } : {}),
    ...(typeof record.parentId === "number" ? { parentId: positiveId(record.parentId, "ADMIN_UI_MANIFEST_PARENT_ID_INVALID") } : {}),
  }
}

const normalizeObject = (object, runId) => {
  if (typeof object !== "object" || object === null) throw new Error("ADMIN_UI_MANIFEST_OBJECT_INVALID")
  const key = nonEmptyString(object.key, "ADMIN_UI_MANIFEST_OBJECT_KEY_REQUIRED")
  if (!key.includes(runId)) throw new Error("ADMIN_UI_MANIFEST_OBJECT_KEY_MISMATCH")
  return {
    bucket: nonEmptyString(object.bucket, "ADMIN_UI_MANIFEST_OBJECT_BUCKET_REQUIRED"),
    createdAt: nonEmptyString(object.createdAt, "ADMIN_UI_MANIFEST_OBJECT_CREATED_AT_REQUIRED"),
    key,
  }
}

export const validateManifest = (candidate) => {
  if (typeof candidate !== "object" || candidate === null) throw new Error("ADMIN_UI_MANIFEST_INVALID")
  const runId = assertRunId(candidate.runId)
  if (candidate.version !== MANIFEST_VERSION) throw new Error("ADMIN_UI_MANIFEST_VERSION_UNSUPPORTED")
  if (!["active", "cleanup-failed", "cleaned"].includes(candidate.status)) {
    throw new Error("ADMIN_UI_MANIFEST_STATUS_INVALID")
  }
  if (!Array.isArray(candidate.records) || !Array.isArray(candidate.objects)) {
    throw new Error("ADMIN_UI_MANIFEST_ENTRIES_INVALID")
  }
  const records = candidate.records.map((record) => normalizeRecord(record, runId))
  const objects = candidate.objects.map((object) => normalizeObject(object, runId))
  const identities = new Set()
  for (const record of records) {
    const identity = `${record.collection}:${record.id}`
    if (identities.has(identity)) throw new Error("ADMIN_UI_MANIFEST_RECORD_DUPLICATE")
    identities.add(identity)
  }
  const keys = new Set()
  for (const object of objects) {
    if (keys.has(object.key)) throw new Error("ADMIN_UI_MANIFEST_OBJECT_DUPLICATE")
    keys.add(object.key)
  }
  return {
    baseUrl: nonEmptyString(candidate.baseUrl, "ADMIN_UI_MANIFEST_BASE_URL_REQUIRED"),
    createdAt: nonEmptyString(candidate.createdAt, "ADMIN_UI_MANIFEST_CREATED_AT_REQUIRED"),
    objects,
    records,
    runId,
    status: candidate.status,
    version: MANIFEST_VERSION,
    ...(typeof candidate.cleanedAt === "string" ? { cleanedAt: candidate.cleanedAt } : {}),
  }
}

export const trackRecord = (manifest, record) => {
  const normalized = validateManifest(manifest)
  if (normalized.status !== "active") throw new Error("ADMIN_UI_MANIFEST_NOT_ACTIVE")
  const entry = normalizeRecord(record, normalized.runId)
  if (normalized.records.some((item) => item.collection === entry.collection && item.id === entry.id)) {
    throw new Error("ADMIN_UI_MANIFEST_RECORD_DUPLICATE")
  }
  return { ...normalized, records: [...normalized.records, entry] }
}

export const trackObject = (manifest, object) => {
  const normalized = validateManifest(manifest)
  if (normalized.status !== "active") throw new Error("ADMIN_UI_MANIFEST_NOT_ACTIVE")
  const entry = normalizeObject(object, normalized.runId)
  if (normalized.objects.some((item) => item.key === entry.key)) {
    throw new Error("ADMIN_UI_MANIFEST_OBJECT_DUPLICATE")
  }
  return { ...normalized, objects: [...normalized.objects, entry] }
}

export const markCleanup = (manifest, status, cleanedAt = new Date().toISOString()) => {
  const normalized = validateManifest(manifest)
  if (!["cleanup-failed", "cleaned"].includes(status)) throw new Error("ADMIN_UI_CLEANUP_STATUS_INVALID")
  return { ...normalized, cleanedAt, status }
}

export const writeManifest = async ({ root, manifest, path = manifestPathOf(root, manifest.runId) }) => {
  const normalized = validateManifest(manifest)
  const target = assertManifestPath(root, path)
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
  await rename(temporary, target)
  return target
}

export const readManifest = async ({ root, path }) => {
  const target = assertManifestPath(root, path)
  return validateManifest(JSON.parse(await readFile(target, "utf8")))
}
