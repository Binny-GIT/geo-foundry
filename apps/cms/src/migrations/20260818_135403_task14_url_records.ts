import { type MigrateDownArgs, type MigrateUpArgs, sql } from "@payloadcms/db-postgres"

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "geo_foundry"."enum_url_records_state" AS ENUM('reserved', 'active', 'redirected', 'gone');
  CREATE TABLE "geo_foundry"."url_records" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"site_id" integer NOT NULL,
  	"tenant_id" integer NOT NULL,
  	"content_id" integer NOT NULL,
  	"locale" varchar NOT NULL,
  	"pathname" varchar NOT NULL,
  	"unique_key" varchar NOT NULL,
  	"state" "geo_foundry"."enum_url_records_state" DEFAULT 'reserved' NOT NULL,
  	"canonical_url" varchar,
  	"status_code" numeric,
  	"target_url_id" integer,
  	"revision" numeric DEFAULT 0 NOT NULL,
  	"audit" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" ADD COLUMN "url_records_id" integer;
  ALTER TABLE "geo_foundry"."url_records" ADD CONSTRAINT "url_records_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "geo_foundry"."sites"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "geo_foundry"."url_records" ADD CONSTRAINT "url_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "geo_foundry"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "geo_foundry"."url_records" ADD CONSTRAINT "url_records_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "geo_foundry"."contents"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "geo_foundry"."url_records" ADD CONSTRAINT "url_records_target_url_id_url_records_id_fk" FOREIGN KEY ("target_url_id") REFERENCES "geo_foundry"."url_records"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "url_records_site_idx" ON "geo_foundry"."url_records" USING btree ("site_id");
  CREATE INDEX "url_records_tenant_idx" ON "geo_foundry"."url_records" USING btree ("tenant_id");
  CREATE INDEX "url_records_content_idx" ON "geo_foundry"."url_records" USING btree ("content_id");
  CREATE UNIQUE INDEX "url_records_unique_key_idx" ON "geo_foundry"."url_records" USING btree ("unique_key");
  CREATE INDEX "url_records_target_url_idx" ON "geo_foundry"."url_records" USING btree ("target_url_id");
  CREATE INDEX "url_records_updated_at_idx" ON "geo_foundry"."url_records" USING btree ("updated_at");
  CREATE INDEX "url_records_created_at_idx" ON "geo_foundry"."url_records" USING btree ("created_at");
  CREATE INDEX "site_state_idx" ON "geo_foundry"."url_records" USING btree ("site_id","state");
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_url_records_fk" FOREIGN KEY ("url_records_id") REFERENCES "geo_foundry"."url_records"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_url_records_id_idx" ON "geo_foundry"."payload_locked_documents_rels" USING btree ("url_records_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "geo_foundry"."url_records" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "geo_foundry"."url_records" CASCADE;
  DROP INDEX "geo_foundry"."payload_locked_documents_rels_url_records_id_idx";
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" DROP COLUMN "url_records_id";
  DROP TYPE "geo_foundry"."enum_url_records_state";`)
}
