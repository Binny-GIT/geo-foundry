import pg from "pg"

const runIdPattern = /^todo39-[a-z0-9]{20}$/
const schema = "geo_foundry"
const ownershipCommentOf = (runId) => `geo-foundry-fault:${runId}`

const fail = (code) => {
  throw new Error(code)
}

const runIdOf = () => {
  const runId = process.env.GEO_FOUNDRY_FAULT_RUN_ID
  if (runId === undefined || !runIdPattern.test(runId)) {
    fail("CMS_FAULT_RUN_ID_INVALID")
  }
  return runId
}

const databaseOf = (runId) => `geo_foundry_fault_${runId.slice("todo39-".length)}`

const quotedIdentifier = (value) => `"${value.replaceAll('"', '""')}"`
const quotedLiteral = (value) => `'${value.replaceAll("'", "''")}'`

const connectionStringOf = (database, applicationName) => {
  const connection = new URL("postgresql://localhost")
  connection.hostname = process.env.GEO_FOUNDRY_PG_HOST ?? ""
  connection.port = process.env.GEO_FOUNDRY_PG_PORT ?? ""
  connection.username = process.env.GEO_FOUNDRY_PG_USER ?? ""
  connection.password = process.env.GEO_FOUNDRY_PG_PASSWORD ?? ""
  connection.pathname = `/${database}`
  connection.searchParams.set("application_name", applicationName)
  return connection.toString()
}

const assertEnvironment = () => {
  if (process.env.GEO_FOUNDRY_CMS_CONFIG_MODE !== "fault-test") {
    fail("CMS_FAULT_MODE_REQUIRED")
  }
  if (process.env.GEO_FOUNDRY_PG_BOOTSTRAP_DATABASE !== "postgres") {
    fail("CMS_FAULT_BOOTSTRAP_DATABASE_INVALID")
  }
  for (const variable of [
    "GEO_FOUNDRY_PG_HOST",
    "GEO_FOUNDRY_PG_PORT",
    "GEO_FOUNDRY_PG_USER",
    "GEO_FOUNDRY_PG_PASSWORD",
  ]) {
    if ((process.env[variable] ?? "").trim().length === 0) {
      fail("CMS_FAULT_POSTGRES_CONFIG_INVALID")
    }
  }
}

const create = async (runId, database) => {
  const bootstrap = new pg.Client({
    connectionString: connectionStringOf("postgres", `geo-foundry-fault-create-${runId}`),
  })
  await bootstrap.connect()
  try {
    const existing = await bootstrap.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      database,
    ])
    if (existing.rowCount !== 0) {
      fail("CMS_FAULT_DATABASE_EXISTS")
    }
    await bootstrap.query(`CREATE DATABASE ${quotedIdentifier(database)}`)
    await bootstrap.query(
      `COMMENT ON DATABASE ${quotedIdentifier(database)} IS ${quotedLiteral(ownershipCommentOf(runId))}`,
    )
  } finally {
    await bootstrap.end()
  }

  const faultDatabase = new pg.Client({
    connectionString: connectionStringOf(database, `geo-foundry-fault-schema-${runId}`),
  })
  await faultDatabase.connect()
  try {
    await faultDatabase.query(`CREATE SCHEMA ${quotedIdentifier(schema)}`)
  } finally {
    await faultDatabase.end()
  }
}

const cleanup = async (runId, database) => {
  const bootstrap = new pg.Client({
    connectionString: connectionStringOf("postgres", `geo-foundry-fault-cleanup-${runId}`),
  })
  await bootstrap.connect()
  try {
    const result = await bootstrap.query(
      "SELECT pg_catalog.shobj_description(oid, 'pg_database') AS comment FROM pg_database WHERE datname = $1",
      [database],
    )
    if (result.rowCount === 0) {
      return
    }
    if (result.rows[0]?.comment !== ownershipCommentOf(runId)) {
      fail("CMS_FAULT_DATABASE_OWNERSHIP_INVALID")
    }
    await bootstrap.query(`DROP DATABASE ${quotedIdentifier(database)}`)
  } finally {
    await bootstrap.end()
  }
}

const main = async () => {
  const action = process.argv[2]
  if (action !== "create" && action !== "cleanup") {
    fail("CMS_FAULT_DATABASE_ACTION_INVALID")
  }
  assertEnvironment()
  const runId = runIdOf()
  const database = databaseOf(runId)
  if (action === "create") {
    await create(runId, database)
  } else {
    await cleanup(runId, database)
  }
}

main().catch((error) => {
  const code = error instanceof Error ? error.message : "CMS_FAULT_DATABASE_FAILED"
  process.stderr.write(`${JSON.stringify({ code })}\n`)
  process.exitCode = 1
})
