import { type MigrateDownArgs, type MigrateUpArgs, sql } from "@payloadcms/db-postgres"

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "geo_foundry"."enum_operations_operation_type" AS ENUM('generate', 'evaluate', 'publish', 'rollback');
  CREATE TYPE "geo_foundry"."enum_operations_state" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');
  CREATE TABLE "geo_foundry"."operations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"operation_id" varchar NOT NULL,
  	"tenant_id" integer NOT NULL,
  	"site_id" integer,
  	"operation_type" "geo_foundry"."enum_operations_operation_type" NOT NULL,
  	"endpoint" varchar NOT NULL,
  	"state" "geo_foundry"."enum_operations_state" DEFAULT 'queued' NOT NULL,
  	"attempt" numeric DEFAULT 1,
  	"revision" numeric DEFAULT 0,
  	"current_stage" varchar,
  	"last_stage_at" timestamp(3) with time zone,
  	"target_ids" jsonb DEFAULT '{}'::jsonb,
  	"result" jsonb,
  	"error" jsonb,
  	"provider_version" varchar,
  	"prompt_version" varchar,
  	"model_id" varchar,
  	"audit_log" jsonb DEFAULT '[]'::jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "geo_foundry"."idempotency_records" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"unique_key" varchar NOT NULL,
  	"tenant_id" integer NOT NULL,
  	"endpoint" varchar NOT NULL,
  	"idempotency_key" varchar NOT NULL,
  	"request_hash" varchar NOT NULL,
  	"operation_id" varchar NOT NULL,
  	"replay_count" numeric DEFAULT 0,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" ADD COLUMN "operations_id" integer;
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" ADD COLUMN "idempotency_records_id" integer;
  ALTER TABLE "geo_foundry"."operations" ADD CONSTRAINT "operations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "geo_foundry"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "geo_foundry"."operations" ADD CONSTRAINT "operations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "geo_foundry"."sites"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "geo_foundry"."idempotency_records" ADD CONSTRAINT "idempotency_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "geo_foundry"."tenants"("id") ON DELETE set null ON UPDATE no action;
  CREATE UNIQUE INDEX "operations_operation_id_idx" ON "geo_foundry"."operations" USING btree ("operation_id");
  CREATE INDEX "operations_tenant_idx" ON "geo_foundry"."operations" USING btree ("tenant_id");
  CREATE INDEX "operations_site_idx" ON "geo_foundry"."operations" USING btree ("site_id");
  CREATE INDEX "operations_updated_at_idx" ON "geo_foundry"."operations" USING btree ("updated_at");
  CREATE INDEX "operations_created_at_idx" ON "geo_foundry"."operations" USING btree ("created_at");
  CREATE UNIQUE INDEX "idempotency_records_unique_key_idx" ON "geo_foundry"."idempotency_records" USING btree ("unique_key");
  CREATE INDEX "idempotency_records_tenant_idx" ON "geo_foundry"."idempotency_records" USING btree ("tenant_id");
  CREATE INDEX "idempotency_records_idempotency_key_idx" ON "geo_foundry"."idempotency_records" USING btree ("idempotency_key");
  CREATE INDEX "idempotency_records_operation_id_idx" ON "geo_foundry"."idempotency_records" USING btree ("operation_id");
  CREATE INDEX "idempotency_records_updated_at_idx" ON "geo_foundry"."idempotency_records" USING btree ("updated_at");
  CREATE INDEX "idempotency_records_created_at_idx" ON "geo_foundry"."idempotency_records" USING btree ("created_at");
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_operations_fk" FOREIGN KEY ("operations_id") REFERENCES "geo_foundry"."operations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_idempotency_records_fk" FOREIGN KEY ("idempotency_records_id") REFERENCES "geo_foundry"."idempotency_records"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_operations_id_idx" ON "geo_foundry"."payload_locked_documents_rels" USING btree ("operations_id");
  CREATE INDEX "payload_locked_documents_rels_idempotency_records_id_idx" ON "geo_foundry"."payload_locked_documents_rels" USING btree ("idempotency_records_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "geo_foundry"."operations" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."idempotency_records" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "geo_foundry"."operations" CASCADE;
  DROP TABLE "geo_foundry"."idempotency_records" CASCADE;
  
  DROP INDEX "geo_foundry"."payload_locked_documents_rels_operations_id_idx";
  DROP INDEX "geo_foundry"."payload_locked_documents_rels_idempotency_records_id_idx";
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" DROP COLUMN "operations_id";
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" DROP COLUMN "idempotency_records_id";
  DROP TYPE "geo_foundry"."enum_operations_operation_type";
  DROP TYPE "geo_foundry"."enum_operations_state";`)
}
