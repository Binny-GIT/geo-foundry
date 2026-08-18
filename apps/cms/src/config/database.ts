import type { PostgresAdapterArgs } from "@payloadcms/db-postgres"

import type { CmsEnvironment } from "./environment"
import { migrations } from "../migrations"

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
