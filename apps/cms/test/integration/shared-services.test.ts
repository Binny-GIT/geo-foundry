import { getPayload } from "payload"
import pg from "pg"
import { describe, expect, it } from "vitest"

import config from "../../src/payload.config"
import { parseCmsEnvironment } from "../../src/config/environment"
import { checkRuntimeReadiness } from "../../src/readiness/runtime-readiness"

const expectedTables = [
  "_content_editions_v",
  "_content_editions_v_blocks_callout",
  "_content_editions_v_blocks_code",
  "_content_editions_v_blocks_embed",
  "_content_editions_v_blocks_faq",
  "_content_editions_v_blocks_faq_items",
  "_content_editions_v_blocks_heading",
  "_content_editions_v_blocks_image",
  "_content_editions_v_blocks_list",
  "_content_editions_v_blocks_list_items",
  "_content_editions_v_blocks_paragraph",
  "_content_editions_v_blocks_quote",
  "_content_editions_v_blocks_references",
  "_content_editions_v_blocks_references_items",
  "_content_editions_v_blocks_table",
  "_content_editions_v_blocks_table_columns",
  "_content_editions_v_blocks_table_rows",
  "_content_editions_v_blocks_table_rows_cells",
  "_content_editions_v_blocks_video",
  "_content_editions_v_texts",
  "content_editions",
  "content_editions_blocks_callout",
  "content_editions_blocks_code",
  "content_editions_blocks_embed",
  "content_editions_blocks_faq",
  "content_editions_blocks_faq_items",
  "content_editions_blocks_heading",
  "content_editions_blocks_image",
  "content_editions_blocks_list",
  "content_editions_blocks_list_items",
  "content_editions_blocks_paragraph",
  "content_editions_blocks_quote",
  "content_editions_blocks_references",
  "content_editions_blocks_references_items",
  "content_editions_blocks_table",
  "content_editions_blocks_table_columns",
  "content_editions_blocks_table_rows",
  "content_editions_blocks_table_rows_cells",
  "content_editions_blocks_video",
  "content_editions_texts",
  "contents",
  "domains",
  "media",
  "payload_kv",
  "payload_locked_documents",
  "payload_locked_documents_rels",
  "payload_migrations",
  "payload_preferences",
  "payload_preferences_rels",
  "sites",
  "sites_texts",
  "tenants",
  "users",
  "users_sessions",
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
    const users = await payload.count({ collection: "users" })
    expect(users.totalDocs).toBeGreaterThanOrEqual(0)
    await payload.destroy()
  })

  it("Given two migration passes, when the live schema is inspected, then one record per migration and schema-qualified tables exist", async () => {
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
      const publicTables = await client.query<{ count: string }>(
        "SELECT count(*) AS count FROM information_schema.tables WHERE table_schema = 'public'",
      )

      expect(tables.rows.map(({ table_name }) => table_name)).toEqual([...expectedTables])
      expect(Number(migrations.rows[0]?.count)).toBeGreaterThanOrEqual(2)
      expect(Number(publicTables.rows[0]?.count)).toBe(0)
    } finally {
      await client.end()
    }
  })
})
