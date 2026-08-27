import {
  type MigrateDownArgs,
  type MigrateUpArgs,
  sql,
} from "@payloadcms/db-postgres";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TYPE "geo_foundry"."enum_connectors_type" AS ENUM('manual', 'url', 'webhook', 'rss');
    CREATE TYPE "geo_foundry"."enum_connectors_status" AS ENUM('active', 'disabled');
    CREATE TYPE "geo_foundry"."enum_intake_items_channel" AS ENUM('manual', 'url', 'webhook', 'rss');
    CREATE TYPE "geo_foundry"."enum_intake_items_status" AS ENUM('new', 'fetching', 'ready', 'failed', 'ignored', 'duplicate', 'adopted', 'merged');
    CREATE TYPE "geo_foundry"."enum_intake_items_duplicate_status" AS ENUM('unknown', 'unique', 'suspected', 'duplicate');
    CREATE TYPE "geo_foundry"."enum_source_snapshots_kind" AS ENUM('raw-response', 'extracted-content');

    CREATE TABLE "geo_foundry"."connectors" (
      "id" serial PRIMARY KEY NOT NULL,
      "name" varchar NOT NULL,
      "type" "geo_foundry"."enum_connectors_type" NOT NULL,
      "status" "geo_foundry"."enum_connectors_status" DEFAULT 'active' NOT NULL,
      "site_id" integer NOT NULL,
      "tenant_id" integer NOT NULL,
      "source_endpoint" varchar,
      "secret_reference" varchar,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );

    CREATE TABLE "geo_foundry"."intake_items" (
      "id" serial PRIMARY KEY NOT NULL,
      "connector_id" integer,
      "tenant_id" integer NOT NULL,
      "channel" "geo_foundry"."enum_intake_items_channel" DEFAULT 'manual' NOT NULL,
      "title" varchar NOT NULL,
      "summary" varchar,
      "source_url" varchar,
      "normalized_url" varchar,
      "status" "geo_foundry"."enum_intake_items_status" DEFAULT 'new' NOT NULL,
      "duplicate_status" "geo_foundry"."enum_intake_items_duplicate_status" DEFAULT 'unknown' NOT NULL,
      "content_hash" varchar,
      "snapshot_id" integer,
      "duplicate_of_id" integer,
      "merged_into_id" integer,
      "suggested_site_id" integer,
      "assigned_to_id" integer,
      "received_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "adopted_edition_id" integer,
      "failure_code" varchar,
      "failure_reason" varchar,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );

    CREATE TABLE "geo_foundry"."source_snapshots" (
      "id" serial PRIMARY KEY NOT NULL,
      "intake_item_id" integer NOT NULL,
      "tenant_id" integer NOT NULL,
      "kind" "geo_foundry"."enum_source_snapshots_kind" NOT NULL,
      "storage_key" varchar NOT NULL,
      "content_hash" varchar NOT NULL,
      "content_type" varchar,
      "content_length" numeric,
      "captured_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );

    ALTER TABLE "geo_foundry"."sites"
      ADD COLUMN "content_strategy_cta" varchar,
      ADD COLUMN "content_strategy_prohibited_expressions" jsonb;

    ALTER TABLE "geo_foundry"."payload_locked_documents_rels"
      ADD COLUMN "connectors_id" integer,
      ADD COLUMN "intake_items_id" integer,
      ADD COLUMN "source_snapshots_id" integer;

    ALTER TABLE "geo_foundry"."connectors"
      ADD CONSTRAINT "connectors_site_id_sites_id_fk"
      FOREIGN KEY ("site_id") REFERENCES "geo_foundry"."sites"("id") ON DELETE restrict ON UPDATE no action;
    ALTER TABLE "geo_foundry"."connectors"
      ADD CONSTRAINT "connectors_tenant_id_tenants_id_fk"
      FOREIGN KEY ("tenant_id") REFERENCES "geo_foundry"."tenants"("id") ON DELETE restrict ON UPDATE no action;

    ALTER TABLE "geo_foundry"."intake_items"
      ADD CONSTRAINT "intake_items_connector_id_connectors_id_fk"
      FOREIGN KEY ("connector_id") REFERENCES "geo_foundry"."connectors"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "geo_foundry"."intake_items"
      ADD CONSTRAINT "intake_items_tenant_id_tenants_id_fk"
      FOREIGN KEY ("tenant_id") REFERENCES "geo_foundry"."tenants"("id") ON DELETE restrict ON UPDATE no action;
    ALTER TABLE "geo_foundry"."intake_items"
      ADD CONSTRAINT "intake_items_snapshot_id_source_snapshots_id_fk"
      FOREIGN KEY ("snapshot_id") REFERENCES "geo_foundry"."source_snapshots"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "geo_foundry"."intake_items"
      ADD CONSTRAINT "intake_items_duplicate_of_id_intake_items_id_fk"
      FOREIGN KEY ("duplicate_of_id") REFERENCES "geo_foundry"."intake_items"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "geo_foundry"."intake_items"
      ADD CONSTRAINT "intake_items_merged_into_id_intake_items_id_fk"
      FOREIGN KEY ("merged_into_id") REFERENCES "geo_foundry"."intake_items"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "geo_foundry"."intake_items"
      ADD CONSTRAINT "intake_items_suggested_site_id_sites_id_fk"
      FOREIGN KEY ("suggested_site_id") REFERENCES "geo_foundry"."sites"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "geo_foundry"."intake_items"
      ADD CONSTRAINT "intake_items_assigned_to_id_users_id_fk"
      FOREIGN KEY ("assigned_to_id") REFERENCES "geo_foundry"."users"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "geo_foundry"."intake_items"
      ADD CONSTRAINT "intake_items_adopted_edition_id_content_editions_id_fk"
      FOREIGN KEY ("adopted_edition_id") REFERENCES "geo_foundry"."content_editions"("id") ON DELETE set null ON UPDATE no action;

    ALTER TABLE "geo_foundry"."source_snapshots"
      ADD CONSTRAINT "source_snapshots_intake_item_id_intake_items_id_fk"
      FOREIGN KEY ("intake_item_id") REFERENCES "geo_foundry"."intake_items"("id") ON DELETE restrict ON UPDATE no action;
    ALTER TABLE "geo_foundry"."source_snapshots"
      ADD CONSTRAINT "source_snapshots_tenant_id_tenants_id_fk"
      FOREIGN KEY ("tenant_id") REFERENCES "geo_foundry"."tenants"("id") ON DELETE restrict ON UPDATE no action;

    ALTER TABLE "geo_foundry"."payload_locked_documents_rels"
      ADD CONSTRAINT "payload_locked_documents_rels_connectors_fk"
      FOREIGN KEY ("connectors_id") REFERENCES "geo_foundry"."connectors"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "geo_foundry"."payload_locked_documents_rels"
      ADD CONSTRAINT "payload_locked_documents_rels_intake_items_fk"
      FOREIGN KEY ("intake_items_id") REFERENCES "geo_foundry"."intake_items"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "geo_foundry"."payload_locked_documents_rels"
      ADD CONSTRAINT "payload_locked_documents_rels_source_snapshots_fk"
      FOREIGN KEY ("source_snapshots_id") REFERENCES "geo_foundry"."source_snapshots"("id") ON DELETE cascade ON UPDATE no action;

    CREATE INDEX "connectors_site_idx" ON "geo_foundry"."connectors" USING btree ("site_id");
    CREATE INDEX "connectors_tenant_idx" ON "geo_foundry"."connectors" USING btree ("tenant_id");
    CREATE INDEX "connectors_updated_at_idx" ON "geo_foundry"."connectors" USING btree ("updated_at");
    CREATE INDEX "connectors_created_at_idx" ON "geo_foundry"."connectors" USING btree ("created_at");

    CREATE INDEX "intake_items_connector_idx" ON "geo_foundry"."intake_items" USING btree ("connector_id");
    CREATE INDEX "intake_items_tenant_idx" ON "geo_foundry"."intake_items" USING btree ("tenant_id");
    CREATE INDEX "intake_items_channel_idx" ON "geo_foundry"."intake_items" USING btree ("channel");
    CREATE INDEX "intake_items_title_idx" ON "geo_foundry"."intake_items" USING btree ("title");
    CREATE INDEX "intake_items_source_url_idx" ON "geo_foundry"."intake_items" USING btree ("source_url");
    CREATE INDEX "intake_items_normalized_url_idx" ON "geo_foundry"."intake_items" USING btree ("normalized_url");
    CREATE INDEX "intake_items_status_idx" ON "geo_foundry"."intake_items" USING btree ("status");
    CREATE INDEX "intake_items_duplicate_status_idx" ON "geo_foundry"."intake_items" USING btree ("duplicate_status");
    CREATE INDEX "intake_items_content_hash_idx" ON "geo_foundry"."intake_items" USING btree ("content_hash");
    CREATE INDEX "intake_items_snapshot_idx" ON "geo_foundry"."intake_items" USING btree ("snapshot_id");
    CREATE INDEX "intake_items_duplicate_of_idx" ON "geo_foundry"."intake_items" USING btree ("duplicate_of_id");
    CREATE INDEX "intake_items_merged_into_idx" ON "geo_foundry"."intake_items" USING btree ("merged_into_id");
    CREATE INDEX "intake_items_suggested_site_idx" ON "geo_foundry"."intake_items" USING btree ("suggested_site_id");
    CREATE INDEX "intake_items_assigned_to_idx" ON "geo_foundry"."intake_items" USING btree ("assigned_to_id");
    CREATE INDEX "intake_items_received_at_idx" ON "geo_foundry"."intake_items" USING btree ("received_at");
    CREATE INDEX "intake_items_adopted_edition_idx" ON "geo_foundry"."intake_items" USING btree ("adopted_edition_id");
    CREATE INDEX "intake_items_updated_at_idx" ON "geo_foundry"."intake_items" USING btree ("updated_at");
    CREATE INDEX "intake_items_created_at_idx" ON "geo_foundry"."intake_items" USING btree ("created_at");

    CREATE UNIQUE INDEX "source_snapshots_storage_key_idx" ON "geo_foundry"."source_snapshots" USING btree ("storage_key");
    CREATE INDEX "source_snapshots_intake_item_idx" ON "geo_foundry"."source_snapshots" USING btree ("intake_item_id");
    CREATE INDEX "source_snapshots_tenant_idx" ON "geo_foundry"."source_snapshots" USING btree ("tenant_id");
    CREATE INDEX "source_snapshots_content_hash_idx" ON "geo_foundry"."source_snapshots" USING btree ("content_hash");
    CREATE INDEX "source_snapshots_captured_at_idx" ON "geo_foundry"."source_snapshots" USING btree ("captured_at");
    CREATE INDEX "source_snapshots_updated_at_idx" ON "geo_foundry"."source_snapshots" USING btree ("updated_at");
    CREATE INDEX "source_snapshots_created_at_idx" ON "geo_foundry"."source_snapshots" USING btree ("created_at");

    CREATE INDEX "payload_locked_documents_rels_connectors_id_idx" ON "geo_foundry"."payload_locked_documents_rels" USING btree ("connectors_id");
    CREATE INDEX "payload_locked_documents_rels_intake_items_id_idx" ON "geo_foundry"."payload_locked_documents_rels" USING btree ("intake_items_id");
    CREATE INDEX "payload_locked_documents_rels_source_snapshots_id_idx" ON "geo_foundry"."payload_locked_documents_rels" USING btree ("source_snapshots_id");
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "geo_foundry"."payload_locked_documents_rels"
      DROP CONSTRAINT "payload_locked_documents_rels_connectors_fk";
    ALTER TABLE "geo_foundry"."payload_locked_documents_rels"
      DROP CONSTRAINT "payload_locked_documents_rels_intake_items_fk";
    ALTER TABLE "geo_foundry"."payload_locked_documents_rels"
      DROP CONSTRAINT "payload_locked_documents_rels_source_snapshots_fk";
    DROP INDEX "geo_foundry"."payload_locked_documents_rels_connectors_id_idx";
    DROP INDEX "geo_foundry"."payload_locked_documents_rels_intake_items_id_idx";
    DROP INDEX "geo_foundry"."payload_locked_documents_rels_source_snapshots_id_idx";
    ALTER TABLE "geo_foundry"."payload_locked_documents_rels"
      DROP COLUMN "connectors_id",
      DROP COLUMN "intake_items_id",
      DROP COLUMN "source_snapshots_id";

    DROP TABLE "geo_foundry"."source_snapshots" CASCADE;
    DROP TABLE "geo_foundry"."intake_items" CASCADE;
    DROP TABLE "geo_foundry"."connectors" CASCADE;

    ALTER TABLE "geo_foundry"."sites"
      DROP COLUMN "content_strategy_cta",
      DROP COLUMN "content_strategy_prohibited_expressions";

    DROP TYPE "geo_foundry"."enum_source_snapshots_kind";
    DROP TYPE "geo_foundry"."enum_intake_items_duplicate_status";
    DROP TYPE "geo_foundry"."enum_intake_items_status";
    DROP TYPE "geo_foundry"."enum_intake_items_channel";
    DROP TYPE "geo_foundry"."enum_connectors_status";
    DROP TYPE "geo_foundry"."enum_connectors_type";
  `);
}
