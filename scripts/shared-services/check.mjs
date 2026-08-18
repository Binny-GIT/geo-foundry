import {
  parseSharedServicesEnvironment,
  SharedServicesEnvironmentError,
} from "../../config/shared-services.schema.ts"
import { parseRunId, writeSafeFailure } from "./cli.mjs"
import { provisionProjectDatabase, verifyPostgres, verifyRedis } from "./data-services.mjs"
import { acquireProjectLock } from "./lock.mjs"
import { createManifest, resourcesForRun, writeManifest } from "./resources.mjs"
import { verifyS3 } from "./storage.mjs"

const run = async () => {
  const runId = parseRunId(process.argv.slice(2))
  const environment = parseSharedServicesEnvironment(process.env)
  const releaseLock = await acquireProjectLock(runId)
  try {
    const resources = resourcesForRun(runId)
    await writeManifest(createManifest(runId))
    await provisionProjectDatabase(environment)
    const postgres = await verifyPostgres(environment, resources)
    const redis = await verifyRedis(environment, resources)
    const s3 = await verifyS3(environment, resources)
    process.stdout.write(`${JSON.stringify({ status: "ok", runId, postgres, redis, s3 })}\n`)
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
