import { type MigrateDownArgs, type MigrateUpArgs, sql } from "@payloadcms/db-postgres"

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "geo_foundry"."connectors"
      ADD COLUMN "last_polled_at" timestamp(3) with time zone;
    CREATE INDEX "connectors_last_polled_at_idx" ON "geo_foundry"."connectors" USING btree ("last_polled_at");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP INDEX "geo_foundry"."connectors_last_polled_at_idx";
    ALTER TABLE "geo_foundry"."connectors"
      DROP COLUMN "last_polled_at";
  `)
}
