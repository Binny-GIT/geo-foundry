import { type MigrateDownArgs, type MigrateUpArgs, sql } from "@payloadcms/db-postgres"

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "geo_foundry"."enum_quality_assessments_state" AS ENUM('pending', 'running', 'passed', 'failed', 'error');
  CREATE TABLE "geo_foundry"."quality_assessments" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"edition_id" integer NOT NULL,
  	"site_id" integer NOT NULL,
  	"tenant_id" integer NOT NULL,
  	"state" "geo_foundry"."enum_quality_assessments_state" DEFAULT 'pending' NOT NULL,
  	"input_hash" varchar NOT NULL,
  	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
  	"overall" numeric,
  	"dimensions" jsonb,
  	"model_id" varchar NOT NULL,
  	"prompt_version" varchar NOT NULL,
  	"provider" varchar NOT NULL,
  	"thresholds_hash" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "geo_foundry"."content_editions" ADD COLUMN "workflow_revision" numeric DEFAULT 0;
  ALTER TABLE "geo_foundry"."content_editions" ADD COLUMN "compiled_release" varchar;
  ALTER TABLE "geo_foundry"."content_editions" ADD COLUMN "audit_log" jsonb DEFAULT '[]'::jsonb;
  ALTER TABLE "geo_foundry"."_content_editions_v" ADD COLUMN "version_workflow_revision" numeric DEFAULT 0;
  ALTER TABLE "geo_foundry"."_content_editions_v" ADD COLUMN "version_compiled_release" varchar;
  ALTER TABLE "geo_foundry"."_content_editions_v" ADD COLUMN "version_audit_log" jsonb DEFAULT '[]'::jsonb;
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" ADD COLUMN "quality_assessments_id" integer;
  ALTER TABLE "geo_foundry"."quality_assessments" ADD CONSTRAINT "quality_assessments_edition_id_content_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "geo_foundry"."content_editions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "geo_foundry"."quality_assessments" ADD CONSTRAINT "quality_assessments_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "geo_foundry"."sites"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "geo_foundry"."quality_assessments" ADD CONSTRAINT "quality_assessments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "geo_foundry"."tenants"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "quality_assessments_edition_idx" ON "geo_foundry"."quality_assessments" USING btree ("edition_id");
  CREATE INDEX "quality_assessments_site_idx" ON "geo_foundry"."quality_assessments" USING btree ("site_id");
  CREATE INDEX "quality_assessments_tenant_idx" ON "geo_foundry"."quality_assessments" USING btree ("tenant_id");
  CREATE INDEX "quality_assessments_updated_at_idx" ON "geo_foundry"."quality_assessments" USING btree ("updated_at");
  CREATE INDEX "quality_assessments_created_at_idx" ON "geo_foundry"."quality_assessments" USING btree ("created_at");
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_quality_assessments_fk" FOREIGN KEY ("quality_assessments_id") REFERENCES "geo_foundry"."quality_assessments"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_quality_assessments_id_idx" ON "geo_foundry"."payload_locked_documents_rels" USING btree ("quality_assessments_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "geo_foundry"."quality_assessments" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "geo_foundry"."quality_assessments" CASCADE;
  DROP INDEX "geo_foundry"."payload_locked_documents_rels_quality_assessments_id_idx";
  ALTER TABLE "geo_foundry"."content_editions" DROP COLUMN "workflow_revision";
  ALTER TABLE "geo_foundry"."content_editions" DROP COLUMN "compiled_release";
  ALTER TABLE "geo_foundry"."content_editions" DROP COLUMN "audit_log";
  ALTER TABLE "geo_foundry"."_content_editions_v" DROP COLUMN "version_workflow_revision";
  ALTER TABLE "geo_foundry"."_content_editions_v" DROP COLUMN "version_compiled_release";
  ALTER TABLE "geo_foundry"."_content_editions_v" DROP COLUMN "version_audit_log";
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" DROP COLUMN "quality_assessments_id";
  DROP TYPE "geo_foundry"."enum_quality_assessments_state";`)
}
