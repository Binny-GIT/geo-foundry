import { type MigrateDownArgs, type MigrateUpArgs, sql } from "@payloadcms/db-postgres"

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TYPE "geo_foundry"."enum_releases_state" AS ENUM('building', 'validated', 'uploaded', 'current', 'superseded', 'rolled_back', 'failed');
    CREATE TABLE "geo_foundry"."releases" (
      "id" serial PRIMARY KEY NOT NULL,
      "release_id" varchar NOT NULL,
      "manifest_sha256" varchar NOT NULL,
      "runtime_site_id" varchar NOT NULL,
      "tenant_id" integer NOT NULL,
      "site_id" integer NOT NULL,
      "state" "geo_foundry"."enum_releases_state" DEFAULT 'uploaded' NOT NULL,
      "revision" numeric DEFAULT 0 NOT NULL,
      "operation_id" varchar,
      "receipt" jsonb,
      "audit_log" jsonb DEFAULT '[]'::jsonb,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );
    CREATE TABLE "geo_foundry"."rollback_intents" (
      "id" serial PRIMARY KEY NOT NULL,
      "intent_id" varchar NOT NULL,
      "tenant_id" integer NOT NULL,
      "site_id" integer NOT NULL,
      "runtime_site_id" varchar NOT NULL,
      "target_release_id" varchar NOT NULL,
      "expected_manifest_sha256" varchar NOT NULL,
      "expected_current_release_id" varchar NOT NULL,
      "expected_current_manifest_sha256" varchar NOT NULL,
      "from_release_id" varchar NOT NULL,
      "from_manifest_sha256" varchar NOT NULL,
      "reason" varchar,
      "approved_by" jsonb NOT NULL,
      "operation_id" varchar,
      "consumed_at" timestamp(3) with time zone,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );
    ALTER TABLE "geo_foundry"."payload_locked_documents_rels" ADD COLUMN "releases_id" integer;
    ALTER TABLE "geo_foundry"."payload_locked_documents_rels" ADD COLUMN "rollback_intents_id" integer;
    ALTER TABLE "geo_foundry"."releases" ADD CONSTRAINT "releases_tenant_id_tenants_fk" FOREIGN KEY ("tenant_id") REFERENCES "geo_foundry"."tenants"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "geo_foundry"."releases" ADD CONSTRAINT "releases_site_id_sites_fk" FOREIGN KEY ("site_id") REFERENCES "geo_foundry"."sites"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "geo_foundry"."rollback_intents" ADD CONSTRAINT "rollback_intents_tenant_id_tenants_fk" FOREIGN KEY ("tenant_id") REFERENCES "geo_foundry"."tenants"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "geo_foundry"."rollback_intents" ADD CONSTRAINT "rollback_intents_site_id_sites_fk" FOREIGN KEY ("site_id") REFERENCES "geo_foundry"."sites"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "geo_foundry"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_releases_fk" FOREIGN KEY ("releases_id") REFERENCES "geo_foundry"."releases"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "geo_foundry"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_rollback_intents_fk" FOREIGN KEY ("rollback_intents_id") REFERENCES "geo_foundry"."rollback_intents"("id") ON DELETE cascade ON UPDATE no action;
    CREATE UNIQUE INDEX "releases_release_id_idx" ON "geo_foundry"."releases" USING btree ("release_id");
    CREATE INDEX "releases_tenant_idx" ON "geo_foundry"."releases" USING btree ("tenant_id");
    CREATE INDEX "releases_site_idx" ON "geo_foundry"."releases" USING btree ("site_id");
    CREATE INDEX "releases_runtime_site_idx" ON "geo_foundry"."releases" USING btree ("runtime_site_id");
    CREATE UNIQUE INDEX "rollback_intents_intent_id_idx" ON "geo_foundry"."rollback_intents" USING btree ("intent_id");
    CREATE INDEX "rollback_intents_tenant_idx" ON "geo_foundry"."rollback_intents" USING btree ("tenant_id");
    CREATE INDEX "rollback_intents_site_idx" ON "geo_foundry"."rollback_intents" USING btree ("site_id");
    CREATE INDEX "rollback_intents_operation_idx" ON "geo_foundry"."rollback_intents" USING btree ("operation_id");
    CREATE INDEX "payload_locked_documents_rels_releases_id_idx" ON "geo_foundry"."payload_locked_documents_rels" USING btree ("releases_id");
    CREATE INDEX "payload_locked_documents_rels_rollback_intents_id_idx" ON "geo_foundry"."payload_locked_documents_rels" USING btree ("rollback_intents_id");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE "geo_foundry"."rollback_intents" CASCADE;
    DROP TABLE "geo_foundry"."releases" CASCADE;
    DROP INDEX "geo_foundry"."payload_locked_documents_rels_releases_id_idx";
    DROP INDEX "geo_foundry"."payload_locked_documents_rels_rollback_intents_id_idx";
    ALTER TABLE "geo_foundry"."payload_locked_documents_rels" DROP COLUMN "releases_id";
    ALTER TABLE "geo_foundry"."payload_locked_documents_rels" DROP COLUMN "rollback_intents_id";
    DROP TYPE "geo_foundry"."enum_releases_state";
  `)
}
