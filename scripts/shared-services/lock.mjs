import { mkdir, open, unlink } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

import { SharedServicesError } from "./resources.mjs"

const stateDirectory = () =>
  resolve(process.env.GEO_FOUNDRY_SHARED_SERVICES_STATE_DIR ?? "temp/shared-services")

const lockPath = () => join(stateDirectory(), "geo-foundry-shared-services.lock")

export const acquireProjectLock = async (runId) => {
  const path = lockPath()
  try {
    await mkdir(dirname(path), { recursive: true })
    const handle = await open(path, "wx", 0o600)
    await handle.writeFile(`${runId}\n`, "utf8")
    return async () => {
      await handle.close()
      await unlink(path)
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new SharedServicesError(
        "SHARED_SERVICE_LOCK_COLLISION",
        "Wait for the active Geo Foundry shared-service run to finish before retrying.",
      )
    }
    throw error
  }
}
