import pg from "pg"

const INTEGRATION_DATABASE = "geo_foundry_cms_integration"
const INTEGRATION_SCHEMA = "geo_foundry"
const applicationName = "geo-foundry-cms-integration-reset"

const connectionStringOf = (database) => {
  const connection = new URL("postgresql://localhost")
  connection.hostname = process.env.GEO_FOUNDRY_PG_HOST
  connection.port = process.env.GEO_FOUNDRY_PG_PORT
  connection.username = process.env.GEO_FOUNDRY_PG_USER
  connection.password = process.env.GEO_FOUNDRY_PG_PASSWORD
  connection.pathname = `/${database}`
  connection.searchParams.set("application_name", applicationName)
  return connection.toString()
}

const quotedIdentifier = (value) => `"${value.replaceAll('"', '""')}"`

const reset = async () => {
  if (process.env.GEO_FOUNDRY_CMS_CONFIG_MODE !== "integration-test") {
    throw new Error("CMS_INTEGRATION_MODE_REQUIRED")
  }
  if (process.env.GEO_FOUNDRY_PG_BOOTSTRAP_DATABASE !== "postgres") {
    throw new Error("CMS_INTEGRATION_BOOTSTRAP_DATABASE_INVALID")
  }

  const bootstrap = new pg.Client({
    connectionString: connectionStringOf(process.env.GEO_FOUNDRY_PG_BOOTSTRAP_DATABASE),
  })
  await bootstrap.connect()
  try {
    await bootstrap.query(`DROP DATABASE IF EXISTS ${quotedIdentifier(INTEGRATION_DATABASE)}`)
    await bootstrap.query(`CREATE DATABASE ${quotedIdentifier(INTEGRATION_DATABASE)}`)
  } finally {
    await bootstrap.end()
  }

  const integration = new pg.Client({ connectionString: connectionStringOf(INTEGRATION_DATABASE) })
  await integration.connect()
  try {
    await integration.query(`CREATE SCHEMA ${quotedIdentifier(INTEGRATION_SCHEMA)}`)
  } finally {
    await integration.end()
  }
}

reset().catch((error) => {
  const code = error instanceof Error ? error.message : "CMS_INTEGRATION_DATABASE_RESET_FAILED"
  process.stderr.write(`${JSON.stringify({ code })}\n`)
  process.exitCode = 1
})
