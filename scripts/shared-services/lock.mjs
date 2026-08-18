import { mkdir, open, unlink } from "node:fs/promises"

import { SharedServicesError } from "./resources.mjs"

const lockPath = new URL("../../.omo/evidence/task-2/shared-services.lock", import.meta.url)

export const acquireProjectLock = async (runId) => {
  try {
    await mkdir(new URL(".", lockPath), { recursive: true })
    const handle = await open(lockPath, "wx", 0o600)
    await handle.writeFile(`${runId}\n`, "utf8")
    return async () => {
      await handle.close()
      await unlink(lockPath)
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
