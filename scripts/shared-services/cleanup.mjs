import {
  parseSharedServicesEnvironment,
  SharedServicesEnvironmentError,
} from "../../config/shared-services.schema.ts"
import { parseRunId, writeSafeFailure } from "./cli.mjs"
import { cleanupPostgres, cleanupRedis } from "./data-services.mjs"
import { acquireProjectLock } from "./lock.mjs"
import { assertManifestForRun, manifestPathForRun, readManifest } from "./resources.mjs"
import { cleanupS3 } from "./storage.mjs"

const run = async () => {
  const runId = parseRunId(process.argv.slice(2))
  const environment = parseSharedServicesEnvironment(process.env)
  const releaseLock = await acquireProjectLock(runId)
  try {
    const manifest = assertManifestForRun(await readManifest(runId), runId)
    await cleanupPostgres(environment, manifest)
    await cleanupRedis(environment, manifest)
    const s3 = await cleanupS3(environment, manifest)
    process.stdout.write(
      `${JSON.stringify({
        status: "cleaned",
        runId,
        manifest: manifestPathForRun(runId),
        resources: manifest.resources,
        s3,
      })}\n`,
    )
  } finally {
    await releaseLock()
  }
}

// no-excuse-ok: catch
run().catch((error) => {
  if (error instanceof SharedServicesEnvironmentError) {
    process.stderr.write(
      `${JSON.stringify({
        code: "SHARED_SERVICE_ENV_MISSING",
        variables: error.variables,
        remediation: "Inject the listed GEO_FOUNDRY_* values through the approved secure source.",
      })}\n`,
    )
  } else {
    writeSafeFailure(error)
  }
  process.exitCode = 1
})
