import { type MigrateDownArgs, type MigrateUpArgs, sql } from "@payloadcms/db-postgres"

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TYPE "geo_foundry"."enum_publication_plans_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'cancelled');

    CREATE TABLE "geo_foundry"."publication_plans" (
      "id" serial PRIMARY KEY NOT NULL,
      "plan_id" varchar NOT NULL,
      "tenant_id" integer NOT NULL,
      "site_id" integer NOT NULL,
      "edition_id" integer NOT NULL,
      "requested_by_id" integer NOT NULL,
      "scheduled_for" timestamp(3) with time zone NOT NULL,
      "timezone" varchar NOT NULL,
      "status" "geo_foundry"."enum_publication_plans_status" DEFAULT 'pending' NOT NULL,
      "operation_id" varchar,
      "claimed_at" timestamp(3) with time zone,
      "claimed_by" varchar,
      "attempts" numeric DEFAULT 0 NOT NULL,
      "last_error" varchar,
      "published_at" timestamp(3) with time zone,
      "release_id" varchar,
      "revision" numeric DEFAULT 0 NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );

    ALTER TABLE "geo_foundry"."payload_locked_documents_rels"
      ADD COLUMN "publication_plans_id" integer;

    ALTER TABLE "geo_foundry"."publication_plans"
      ADD CONSTRAINT "publication_plans_tenant_id_tenants_id_fk"
      FOREIGN KEY ("tenant_id") REFERENCES "geo_foundry"."tenants"("id") ON DELETE restrict ON UPDATE no action;
    ALTER TABLE "geo_foundry"."publication_plans"
      ADD CONSTRAINT "publication_plans_site_id_sites_id_fk"
      FOREIGN KEY ("site_id") REFERENCES "geo_foundry"."sites"("id") ON DELETE restrict ON UPDATE no action;
    ALTER TABLE "geo_foundry"."publication_plans"
      ADD CONSTRAINT "publication_plans_edition_id_content_editions_id_fk"
      FOREIGN KEY ("edition_id") REFERENCES "geo_foundry"."content_editions"("id") ON DELETE restrict ON UPDATE no action;
    ALTER TABLE "geo_foundry"."publication_plans"
      ADD CONSTRAINT "publication_plans_requested_by_id_users_id_fk"
      FOREIGN KEY ("requested_by_id") REFERENCES "geo_foundry"."users"("id") ON DELETE restrict ON UPDATE no action;
    ALTER TABLE "geo_foundry"."payload_locked_documents_rels"
      ADD CONSTRAINT "payload_locked_documents_rels_publication_plans_fk"
      FOREIGN KEY ("publication_plans_id") REFERENCES "geo_foundry"."publication_plans"("id") ON DELETE cascade ON UPDATE no action;

    CREATE UNIQUE INDEX "publication_plans_plan_id_idx" ON "geo_foundry"."publication_plans" USING btree ("plan_id");
    CREATE INDEX "publication_plans_tenant_idx" ON "geo_foundry"."publication_plans" USING btree ("tenant_id");
    CREATE INDEX "publication_plans_site_idx" ON "geo_foundry"."publication_plans" USING btree ("site_id");
    CREATE INDEX "publication_plans_edition_idx" ON "geo_foundry"."publication_plans" USING btree ("edition_id");
    CREATE INDEX "publication_plans_requested_by_idx" ON "geo_foundry"."publication_plans" USING btree ("requested_by_id");
    CREATE INDEX "publication_plans_due_idx" ON "geo_foundry"."publication_plans" USING btree ("status", "scheduled_for");
    CREATE INDEX "publication_plans_operation_idx" ON "geo_foundry"."publication_plans" USING btree ("operation_id");
    CREATE INDEX "publication_plans_updated_at_idx" ON "geo_foundry"."publication_plans" USING btree ("updated_at");
    CREATE INDEX "publication_plans_created_at_idx" ON "geo_foundry"."publication_plans" USING btree ("created_at");
    CREATE INDEX "payload_locked_documents_rels_publication_plans_id_idx"
      ON "geo_foundry"."payload_locked_documents_rels" USING btree ("publication_plans_id");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "geo_foundry"."payload_locked_documents_rels"
      DROP CONSTRAINT "payload_locked_documents_rels_publication_plans_fk";
    DROP INDEX "geo_foundry"."payload_locked_documents_rels_publication_plans_id_idx";
    ALTER TABLE "geo_foundry"."payload_locked_documents_rels"
      DROP COLUMN "publication_plans_id";
    DROP TABLE "geo_foundry"."publication_plans" CASCADE;
    DROP TYPE "geo_foundry"."enum_publication_plans_status";
  `)
}
