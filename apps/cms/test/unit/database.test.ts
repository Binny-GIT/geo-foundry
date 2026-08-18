import { describe, expect, it } from "vitest"

import { createPostgresAdapterOptions } from "../../src/config/database"
import { parseCmsEnvironment } from "../../src/config/environment"

describe("Payload PostgreSQL migration policy", () => {
  it("Given production adapter options, when inspected, then push is disabled and migrations are committed", () => {
    const environment = parseCmsEnvironment({ GEO_FOUNDRY_CMS_CONFIG_MODE: "build" })
    const options = createPostgresAdapterOptions(environment, "/committed/migrations")

    expect(options.push).toBe(false)
    expect(options.disableCreateDatabase).toBe(true)
    expect(options.migrationDir).toBe("/committed/migrations")
    expect(options.prodMigrations?.length).toBeGreaterThan(0)
    expect(options.schemaName).toBe("geo_foundry")
  })
})
