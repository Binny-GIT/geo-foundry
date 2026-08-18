import { mkdir, open, unlink } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"

const runIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{2,47}$/)

export type SharedServiceNamespace = {
  readonly postgres: {
    readonly database: "geo_foundry"
    readonly schema: "geo_foundry"
    readonly tablePrefix: string
  }
  readonly redis: {
    readonly prefix: string
  }
  readonly runId: string
  readonly s3: {
    readonly bucket: "geo-foundry"
    readonly prefix: string
  }
}

export type SharedServiceLockOptions = {
  readonly directory: string
  readonly runId: string
}

export class SharedServiceTestLockError extends Error {
  override readonly name = "SharedServiceTestLockError"

  constructor(readonly code: "SHARED_SERVICE_LOCK_COLLISION" | "SHARED_SERVICE_RUN_ID_INVALID") {
    super(code)
  }
}

const parseRunId = (runId: string): string => {
  const parsed = runIdSchema.safeParse(runId)
  if (!parsed.success) {
    throw new SharedServiceTestLockError("SHARED_SERVICE_RUN_ID_INVALID")
  }
  return parsed.data
}

export const deriveSharedServiceNamespace = (runId: string): SharedServiceNamespace => {
  const verifiedRunId = parseRunId(runId)
  return Object.freeze({
    postgres: Object.freeze({
      database: "geo_foundry",
      schema: "geo_foundry",
      tablePrefix: `test_${verifiedRunId.replaceAll("-", "_")}_`,
    }),
    redis: Object.freeze({ prefix: `geo-foundry:${verifiedRunId}:` }),
    runId: verifiedRunId,
    s3: Object.freeze({ bucket: "geo-foundry", prefix: `objects/${verifiedRunId}/` }),
  })
}

export const acquireSharedServiceLock = async (
  options: SharedServiceLockOptions,
): Promise<() => Promise<void>> => {
  const runId = parseRunId(options.runId)
  await mkdir(options.directory, { recursive: true })
  const lockPath = join(options.directory, "geo-foundry-shared-services.lock")
  try {
    const handle = await open(lockPath, "wx", 0o600)
    await handle.writeFile(`${runId}\n`, "utf8")
    return async () => {
      await handle.close()
      await unlink(lockPath)
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new SharedServiceTestLockError("SHARED_SERVICE_LOCK_COLLISION")
    }
    throw error
  }
}
