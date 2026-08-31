import { type MigrateDownArgs, type MigrateUpArgs, sql } from "@payloadcms/db-postgres"

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "geo_foundry"."performance_snapshots"
      ADD COLUMN IF NOT EXISTS "city" varchar;
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "performance_snapshots_city_idx"
      ON "geo_foundry"."performance_snapshots" USING btree ("city");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "geo_foundry"."performance_snapshots"
      DROP COLUMN IF EXISTS "city" CASCADE;
  `)
}
