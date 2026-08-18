import { getPayload } from "payload"
import pg from "pg"
import { describe, expect, it } from "vitest"

import config from "../../src/payload.config"
import { parseCmsEnvironment } from "../../src/config/environment"
import { checkRuntimeReadiness } from "../../src/readiness/runtime-readiness"

const expectedTables = [
  "bootstrap_admins",
  "bootstrap_admins_sessions",
  "bootstrap_media",
  "payload_kv",
  "payload_locked_documents",
  "payload_locked_documents_rels",
  "payload_migrations",
  "payload_preferences",
  "payload_preferences_rels",
] as const

describe("CMS shared-service integration", () => {
  it("Given checked-in migrations and shared services, when CMS boots, then dependencies are ready", async () => {
    const readiness = await checkRuntimeReadiness(process.env)

    expect(readiness).toEqual({
      configuration: { status: "ready" },
      dependencies: {
        postgres: { status: "ready" },
        rustfs: { status: "ready" },
      },
      status: "ready",
    })

    const payload = await getPayload({ config })
    const administrators = await payload.count({ collection: "bootstrap-admins" })
    expect(administrators.totalDocs).toBeGreaterThanOrEqual(0)
    await payload.destroy()
  })

  it("Given two migration passes, when the live schema is inspected, then one record and exactly nine tables exist", async () => {
    const environment = parseCmsEnvironment(process.env)
    const client = new pg.Client({ connectionString: environment.postgres.connectionString })
    await client.connect()
    try {
      const tables = await client.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name",
        [environment.postgres.schema],
      )
      const migrations = await client.query<{ count: string }>(
        'SELECT count(*) AS count FROM "geo_foundry"."payload_migrations"',
      )

      expect(tables.rows.map(({ table_name }) => table_name)).toEqual(expectedTables)
      expect(migrations.rows[0]?.count).toBe("1")
    } finally {
      await client.end()
    }
  })
})
