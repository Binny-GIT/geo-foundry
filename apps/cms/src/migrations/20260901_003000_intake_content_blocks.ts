import { type MigrateDownArgs, type MigrateUpArgs, sql } from "@payloadcms/db-postgres"

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "geo_foundry"."intake_items"
      ADD COLUMN IF NOT EXISTS "content_blocks" jsonb DEFAULT '[]'::jsonb;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "geo_foundry"."intake_items"
      DROP COLUMN IF EXISTS "content_blocks" CASCADE;
  `)
}
