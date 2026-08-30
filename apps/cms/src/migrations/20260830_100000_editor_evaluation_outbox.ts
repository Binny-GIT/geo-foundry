import { type MigrateDownArgs, type MigrateUpArgs, sql } from "@payloadcms/db-postgres"

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TYPE "geo_foundry"."enum_outbox_events_type"
      ADD VALUE IF NOT EXISTS 'evaluation.requested';
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  void db
}
