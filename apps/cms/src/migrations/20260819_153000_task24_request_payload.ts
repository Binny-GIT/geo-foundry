import { type MigrateDownArgs, type MigrateUpArgs, sql } from "@payloadcms/db-postgres"

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "geo_foundry"."operations" ADD COLUMN "request_payload" jsonb DEFAULT '{}'::jsonb NOT NULL;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "geo_foundry"."operations" DROP COLUMN "request_payload";`)
}
