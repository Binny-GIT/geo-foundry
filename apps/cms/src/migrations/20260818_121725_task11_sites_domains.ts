import { type MigrateDownArgs, type MigrateUpArgs, sql } from "@payloadcms/db-postgres"

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "geo_foundry"."enum_sites_status" AS ENUM('active', 'disabled');
  CREATE TYPE "geo_foundry"."enum_domains_role" AS ENUM('canonical', 'alias');
  CREATE TYPE "geo_foundry"."enum_domains_status" AS ENUM('active', 'disabled');
  CREATE TABLE "geo_foundry"."sites" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"tenant_id" integer NOT NULL,
  	"locale" varchar NOT NULL,
  	"timezone" varchar NOT NULL,
  	"status" "geo_foundry"."enum_sites_status" DEFAULT 'active' NOT NULL,
  	"content_strategy_positioning" varchar,
  	"content_strategy_tone" varchar,
  	"content_strategy_language" varchar,
  	"quality_thresholds_cross_domain_block" numeric DEFAULT 0.92,
  	"quality_thresholds_cross_domain_review" numeric DEFAULT 0.85,
  	"quality_thresholds_same_site_title_block" numeric DEFAULT 0.9,
  	"quality_thresholds_overall_minimum" numeric DEFAULT 80,
  	"quality_thresholds_dimension_minimum" numeric DEFAULT 75,
  	"seo_defaults_title_suffix" varchar,
  	"seo_defaults_default_description" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "geo_foundry"."sites_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "geo_foundry"."domains" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"hostname" varchar NOT NULL,
  	"site_id" integer NOT NULL,
  	"tenant_id" integer NOT NULL,
  	"role" "geo_foundry"."enum_domains_role" DEFAULT 'canonical' NOT NULL,
  	"status" "geo_foundry"."enum_domains_status" DEFAULT 'active' NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" ADD COLUMN "sites_id" integer;
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" ADD COLUMN "domains_id" integer;
  ALTER TABLE "geo_foundry"."sites" ADD CONSTRAINT "sites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "geo_foundry"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "geo_foundry"."sites_texts" ADD CONSTRAINT "sites_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "geo_foundry"."sites"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."domains" ADD CONSTRAINT "domains_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "geo_foundry"."sites"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "geo_foundry"."domains" ADD CONSTRAINT "domains_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "geo_foundry"."tenants"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "sites_tenant_idx" ON "geo_foundry"."sites" USING btree ("tenant_id");
  CREATE INDEX "sites_updated_at_idx" ON "geo_foundry"."sites" USING btree ("updated_at");
  CREATE INDEX "sites_created_at_idx" ON "geo_foundry"."sites" USING btree ("created_at");
  CREATE INDEX "sites_texts_order_parent" ON "geo_foundry"."sites_texts" USING btree ("order","parent_id");
  CREATE UNIQUE INDEX "domains_hostname_idx" ON "geo_foundry"."domains" USING btree ("hostname");
  CREATE INDEX "domains_site_idx" ON "geo_foundry"."domains" USING btree ("site_id");
  CREATE INDEX "domains_tenant_idx" ON "geo_foundry"."domains" USING btree ("tenant_id");
  CREATE INDEX "domains_updated_at_idx" ON "geo_foundry"."domains" USING btree ("updated_at");
  CREATE INDEX "domains_created_at_idx" ON "geo_foundry"."domains" USING btree ("created_at");
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_sites_fk" FOREIGN KEY ("sites_id") REFERENCES "geo_foundry"."sites"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_domains_fk" FOREIGN KEY ("domains_id") REFERENCES "geo_foundry"."domains"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_sites_id_idx" ON "geo_foundry"."payload_locked_documents_rels" USING btree ("sites_id");
  CREATE INDEX "payload_locked_documents_rels_domains_id_idx" ON "geo_foundry"."payload_locked_documents_rels" USING btree ("domains_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "geo_foundry"."sites" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."sites_texts" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."domains" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "geo_foundry"."sites" CASCADE;
  DROP TABLE "geo_foundry"."sites_texts" CASCADE;
  DROP TABLE "geo_foundry"."domains" CASCADE;
  DROP INDEX "geo_foundry"."payload_locked_documents_rels_sites_id_idx";
  DROP INDEX "geo_foundry"."payload_locked_documents_rels_domains_id_idx";
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" DROP COLUMN "sites_id";
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" DROP COLUMN "domains_id";
  DROP TYPE "geo_foundry"."enum_sites_status";
  DROP TYPE "geo_foundry"."enum_domains_role";
  DROP TYPE "geo_foundry"."enum_domains_status";`)
}
