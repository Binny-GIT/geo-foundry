import type { PostgresAdapterArgs } from "@payloadcms/db-postgres"
import { migrations } from "../migrations"
import type { CmsEnvironment } from "./environment"

export const createPostgresAdapterOptions = (
  environment: CmsEnvironment,
  migrationDirectory: string,
): PostgresAdapterArgs => ({
  disableCreateDatabase: true,
  migrationDir: migrationDirectory,
  pool: {
    connectionString: environment.postgres.connectionString,
    max: 10,
  },
  prodMigrations: migrations,
  push: false,
  schemaName: environment.postgres.schema,
})
