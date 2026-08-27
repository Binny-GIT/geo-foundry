import { type MigrateDownArgs, type MigrateUpArgs, sql } from "@payloadcms/db-postgres"

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE "geo_foundry"."performance_snapshots" (
      "id" serial PRIMARY KEY NOT NULL,
      "import_hash" varchar NOT NULL,
      "tenant_id" integer NOT NULL,
      "site_id" integer NOT NULL,
      "edition_id" integer,
      "url" varchar NOT NULL,
      "source" varchar NOT NULL,
      "observed_at" timestamp(3) with time zone NOT NULL,
      "visits" numeric,
      "engagement" numeric,
      "conversions" numeric,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );

    ALTER TABLE "geo_foundry"."payload_locked_documents_rels"
      ADD COLUMN "performance_snapshots_id" integer;
    ALTER TABLE "geo_foundry"."performance_snapshots"
      ADD CONSTRAINT "performance_snapshots_tenant_id_tenants_id_fk"
      FOREIGN KEY ("tenant_id") REFERENCES "geo_foundry"."tenants"("id") ON DELETE restrict ON UPDATE no action;
    ALTER TABLE "geo_foundry"."performance_snapshots"
      ADD CONSTRAINT "performance_snapshots_site_id_sites_id_fk"
      FOREIGN KEY ("site_id") REFERENCES "geo_foundry"."sites"("id") ON DELETE restrict ON UPDATE no action;
    ALTER TABLE "geo_foundry"."performance_snapshots"
      ADD CONSTRAINT "performance_snapshots_edition_id_content_editions_id_fk"
      FOREIGN KEY ("edition_id") REFERENCES "geo_foundry"."content_editions"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "geo_foundry"."payload_locked_documents_rels"
      ADD CONSTRAINT "payload_locked_documents_rels_performance_snapshots_fk"
      FOREIGN KEY ("performance_snapshots_id") REFERENCES "geo_foundry"."performance_snapshots"("id") ON DELETE cascade ON UPDATE no action;

    CREATE UNIQUE INDEX "performance_snapshots_import_hash_idx" ON "geo_foundry"."performance_snapshots" USING btree ("import_hash");
    CREATE INDEX "performance_snapshots_tenant_idx" ON "geo_foundry"."performance_snapshots" USING btree ("tenant_id");
    CREATE INDEX "performance_snapshots_site_idx" ON "geo_foundry"."performance_snapshots" USING btree ("site_id");
    CREATE INDEX "performance_snapshots_edition_idx" ON "geo_foundry"."performance_snapshots" USING btree ("edition_id");
    CREATE INDEX "performance_snapshots_source_observed_idx" ON "geo_foundry"."performance_snapshots" USING btree ("source", "observed_at");
    CREATE INDEX "performance_snapshots_updated_at_idx" ON "geo_foundry"."performance_snapshots" USING btree ("updated_at");
    CREATE INDEX "performance_snapshots_created_at_idx" ON "geo_foundry"."performance_snapshots" USING btree ("created_at");
    CREATE INDEX "payload_locked_documents_rels_performance_snapshots_id_idx" ON "geo_foundry"."payload_locked_documents_rels" USING btree ("performance_snapshots_id");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "geo_foundry"."payload_locked_documents_rels"
      DROP CONSTRAINT "payload_locked_documents_rels_performance_snapshots_fk";
    DROP INDEX "geo_foundry"."payload_locked_documents_rels_performance_snapshots_id_idx";
    ALTER TABLE "geo_foundry"."payload_locked_documents_rels"
      DROP COLUMN "performance_snapshots_id";
    DROP TABLE "geo_foundry"."performance_snapshots" CASCADE;
  `)
}
