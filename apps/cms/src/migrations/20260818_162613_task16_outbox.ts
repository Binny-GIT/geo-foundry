import { type MigrateDownArgs, type MigrateUpArgs, sql } from "@payloadcms/db-postgres"

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "geo_foundry"."enum_outbox_events_type" AS ENUM('edition.transitioned', 'edition.draft-written', 'assessment.recorded', 'edition.compile-recorded', 'publish.requested');
  CREATE TYPE "geo_foundry"."enum_outbox_events_aggregate_type" AS ENUM('edition');
  CREATE TYPE "geo_foundry"."enum_outbox_events_status" AS ENUM('pending', 'dispatched');
  CREATE TABLE "geo_foundry"."outbox_events" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"event_id" varchar NOT NULL,
  	"type" "geo_foundry"."enum_outbox_events_type" NOT NULL,
  	"aggregate_type" "geo_foundry"."enum_outbox_events_aggregate_type" DEFAULT 'edition' NOT NULL,
  	"aggregate_id" numeric NOT NULL,
  	"tenant_id" integer NOT NULL,
  	"event_payload" jsonb NOT NULL,
  	"operation_id" varchar,
  	"request_id" varchar,
  	"status" "geo_foundry"."enum_outbox_events_status" DEFAULT 'pending' NOT NULL,
  	"attempts" numeric DEFAULT 0,
  	"last_error" varchar,
  	"dispatched_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" ADD COLUMN "outbox_events_id" integer;
  ALTER TABLE "geo_foundry"."outbox_events" ADD CONSTRAINT "outbox_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "geo_foundry"."tenants"("id") ON DELETE set null ON UPDATE no action;
  CREATE UNIQUE INDEX "outbox_events_event_id_idx" ON "geo_foundry"."outbox_events" USING btree ("event_id");
  CREATE INDEX "outbox_events_aggregate_id_idx" ON "geo_foundry"."outbox_events" USING btree ("aggregate_id");
  CREATE INDEX "outbox_events_tenant_idx" ON "geo_foundry"."outbox_events" USING btree ("tenant_id");
  CREATE INDEX "outbox_events_operation_id_idx" ON "geo_foundry"."outbox_events" USING btree ("operation_id");
  CREATE INDEX "outbox_events_status_idx" ON "geo_foundry"."outbox_events" USING btree ("status");
  CREATE INDEX "outbox_events_updated_at_idx" ON "geo_foundry"."outbox_events" USING btree ("updated_at");
  CREATE INDEX "outbox_events_created_at_idx" ON "geo_foundry"."outbox_events" USING btree ("created_at");
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_outbox_events_fk" FOREIGN KEY ("outbox_events_id") REFERENCES "geo_foundry"."outbox_events"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_outbox_events_id_idx" ON "geo_foundry"."payload_locked_documents_rels" USING btree ("outbox_events_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "geo_foundry"."outbox_events" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "geo_foundry"."outbox_events" CASCADE;
  DROP INDEX "geo_foundry"."payload_locked_documents_rels_outbox_events_id_idx";
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" DROP COLUMN "outbox_events_id";
  DROP TYPE "geo_foundry"."enum_outbox_events_type";
  DROP TYPE "geo_foundry"."enum_outbox_events_aggregate_type";
  DROP TYPE "geo_foundry"."enum_outbox_events_status";`)
}
