import { type MigrateDownArgs, type MigrateUpArgs, sql } from "@payloadcms/db-postgres"

/**
 * Registers the api_usage_dailies collection with Payload's document-locking
 * system: every new collection gets a reference column on the shared
 * payload_locked_documents_rels table.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "geo_foundry"."payload_locked_documents_rels"
      ADD COLUMN IF NOT EXISTS "api_usage_dailies_id" integer;
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_api_usage_dailies_id_idx"
      ON "geo_foundry"."payload_locked_documents_rels" USING btree ("api_usage_dailies_id");
  `)
  await db.execute(sql`
    ALTER TABLE "geo_foundry"."payload_locked_documents_rels"
      DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_api_usage_dailies_id_fk";
  `)
  await db.execute(sql`
    ALTER TABLE "geo_foundry"."payload_locked_documents_rels"
      ADD CONSTRAINT "payload_locked_documents_rels_api_usage_dailies_id_fk"
      FOREIGN KEY ("api_usage_dailies_id") REFERENCES "geo_foundry"."api_usage_dailies"("id")
      ON DELETE cascade ON UPDATE no action;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "geo_foundry"."payload_locked_documents_rels"
      DROP COLUMN IF EXISTS "api_usage_dailies_id" CASCADE;
  `)
}
