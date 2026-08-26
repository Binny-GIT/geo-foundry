import { type MigrateDownArgs, type MigrateUpArgs, sql } from "@payloadcms/db-postgres"

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE "geo_foundry"."reviewer_edition_decision_idempotency" (
      "id" serial PRIMARY KEY NOT NULL,
      "unique_key" varchar NOT NULL,
      "tenant_id" integer NOT NULL,
      "endpoint" varchar NOT NULL,
      "idempotency_key" varchar NOT NULL,
      "request_hash" varchar NOT NULL,
      "edition_id" integer NOT NULL,
      "decision_id" varchar NOT NULL,
      "actor_user_id" varchar NOT NULL,
      "request_id" varchar NOT NULL,
      "response_payload" jsonb NOT NULL,
      "replay_count" numeric DEFAULT 0,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );

    ALTER TABLE "geo_foundry"."payload_locked_documents_rels"
      ADD COLUMN "reviewer_edition_decision_idempotency_id" integer;

    ALTER TABLE "geo_foundry"."reviewer_edition_decision_idempotency"
      ADD CONSTRAINT "reviewer_edition_decision_idempotency_tenant_id_tenants_id_fk"
      FOREIGN KEY ("tenant_id") REFERENCES "geo_foundry"."tenants"("id")
      ON DELETE set null ON UPDATE no action;
    ALTER TABLE "geo_foundry"."reviewer_edition_decision_idempotency"
      ADD CONSTRAINT "reviewer_edition_decision_idempotency_edition_id_content_editions_id_fk"
      FOREIGN KEY ("edition_id") REFERENCES "geo_foundry"."content_editions"("id")
      ON DELETE set null ON UPDATE no action;
    ALTER TABLE "geo_foundry"."payload_locked_documents_rels"
      ADD CONSTRAINT "payload_locked_documents_rels_reviewer_edition_decision_idempotency_fk"
      FOREIGN KEY ("reviewer_edition_decision_idempotency_id")
      REFERENCES "geo_foundry"."reviewer_edition_decision_idempotency"("id")
      ON DELETE cascade ON UPDATE no action;

    CREATE UNIQUE INDEX "reviewer_edition_decision_idempotency_unique_key_idx"
      ON "geo_foundry"."reviewer_edition_decision_idempotency" USING btree ("unique_key");
    CREATE INDEX "reviewer_edition_decision_idempotency_tenant_idx"
      ON "geo_foundry"."reviewer_edition_decision_idempotency" USING btree ("tenant_id");
    CREATE INDEX "reviewer_edition_decision_idempotency_idempotency_key_idx"
      ON "geo_foundry"."reviewer_edition_decision_idempotency" USING btree ("idempotency_key");
    CREATE INDEX "reviewer_edition_decision_idempotency_edition_idx"
      ON "geo_foundry"."reviewer_edition_decision_idempotency" USING btree ("edition_id");
    CREATE INDEX "reviewer_edition_decision_idempotency_decision_id_idx"
      ON "geo_foundry"."reviewer_edition_decision_idempotency" USING btree ("decision_id");
    CREATE INDEX "reviewer_edition_decision_idempotency_updated_at_idx"
      ON "geo_foundry"."reviewer_edition_decision_idempotency" USING btree ("updated_at");
    CREATE INDEX "reviewer_edition_decision_idempotency_created_at_idx"
      ON "geo_foundry"."reviewer_edition_decision_idempotency" USING btree ("created_at");
    CREATE INDEX "payload_locked_documents_rels_reviewer_edition_decision_idempotency_id_idx"
      ON "geo_foundry"."payload_locked_documents_rels" USING btree ("reviewer_edition_decision_idempotency_id");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "geo_foundry"."payload_locked_documents_rels"
      DROP CONSTRAINT "payload_locked_documents_rels_reviewer_edition_decision_idempotency_fk";
    DROP INDEX "geo_foundry"."payload_locked_documents_rels_reviewer_edition_decision_idempotency_id_idx";
    ALTER TABLE "geo_foundry"."payload_locked_documents_rels"
      DROP COLUMN "reviewer_edition_decision_idempotency_id";
    DROP TABLE "geo_foundry"."reviewer_edition_decision_idempotency" CASCADE;
  `)
}
