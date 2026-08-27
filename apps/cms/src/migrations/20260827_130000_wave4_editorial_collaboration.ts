import { type MigrateDownArgs, type MigrateUpArgs, sql } from "@payloadcms/db-postgres"

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TYPE "geo_foundry"."enum_content_editions_priority" AS ENUM('low', 'normal', 'high', 'urgent');
    CREATE TYPE "geo_foundry"."enum_content_editions_editorial_status" AS ENUM('unassigned', 'assigned', 'in-progress', 'blocked');
    CREATE TYPE "geo_foundry"."enum__content_editions_v_version_priority" AS ENUM('low', 'normal', 'high', 'urgent');
    CREATE TYPE "geo_foundry"."enum__content_editions_v_version_editorial_status" AS ENUM('unassigned', 'assigned', 'in-progress', 'blocked');
    CREATE TYPE "geo_foundry"."enum_article_sources_role" AS ENUM('primary', 'supporting');
    CREATE TYPE "geo_foundry"."enum_review_comments_kind" AS ENUM('comment', 'request-changes');

    ALTER TABLE "geo_foundry"."content_editions"
      ADD COLUMN "owner_id" integer,
      ADD COLUMN "priority" "geo_foundry"."enum_content_editions_priority" DEFAULT 'normal' NOT NULL,
      ADD COLUMN "due_at" timestamp(3) with time zone,
      ADD COLUMN "editorial_status" "geo_foundry"."enum_content_editions_editorial_status" DEFAULT 'unassigned' NOT NULL;

    ALTER TABLE "geo_foundry"."_content_editions_v"
      ADD COLUMN "version_owner_id" integer,
      ADD COLUMN "version_priority" "geo_foundry"."enum__content_editions_v_version_priority" DEFAULT 'normal',
      ADD COLUMN "version_due_at" timestamp(3) with time zone,
      ADD COLUMN "version_editorial_status" "geo_foundry"."enum__content_editions_v_version_editorial_status" DEFAULT 'unassigned';

    CREATE TABLE "geo_foundry"."article_sources" (
      "id" serial PRIMARY KEY NOT NULL,
      "edition_id" integer NOT NULL,
      "intake_item_id" integer NOT NULL,
      "tenant_id" integer NOT NULL,
      "role" "geo_foundry"."enum_article_sources_role" DEFAULT 'supporting' NOT NULL,
      "note" varchar,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );

    CREATE TABLE "geo_foundry"."review_comments" (
      "id" serial PRIMARY KEY NOT NULL,
      "edition_id" integer NOT NULL,
      "tenant_id" integer NOT NULL,
      "author_id" integer NOT NULL,
      "kind" "geo_foundry"."enum_review_comments_kind" DEFAULT 'comment' NOT NULL,
      "body" varchar NOT NULL,
      "workflow_revision" numeric,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );

    ALTER TABLE "geo_foundry"."payload_locked_documents_rels"
      ADD COLUMN "article_sources_id" integer,
      ADD COLUMN "review_comments_id" integer;

    ALTER TABLE "geo_foundry"."content_editions"
      ADD CONSTRAINT "content_editions_owner_id_users_id_fk"
      FOREIGN KEY ("owner_id") REFERENCES "geo_foundry"."users"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "geo_foundry"."_content_editions_v"
      ADD CONSTRAINT "_content_editions_v_version_owner_id_users_id_fk"
      FOREIGN KEY ("version_owner_id") REFERENCES "geo_foundry"."users"("id") ON DELETE set null ON UPDATE no action;

    ALTER TABLE "geo_foundry"."article_sources"
      ADD CONSTRAINT "article_sources_edition_id_content_editions_id_fk"
      FOREIGN KEY ("edition_id") REFERENCES "geo_foundry"."content_editions"("id") ON DELETE restrict ON UPDATE no action;
    ALTER TABLE "geo_foundry"."article_sources"
      ADD CONSTRAINT "article_sources_intake_item_id_intake_items_id_fk"
      FOREIGN KEY ("intake_item_id") REFERENCES "geo_foundry"."intake_items"("id") ON DELETE restrict ON UPDATE no action;
    ALTER TABLE "geo_foundry"."article_sources"
      ADD CONSTRAINT "article_sources_tenant_id_tenants_id_fk"
      FOREIGN KEY ("tenant_id") REFERENCES "geo_foundry"."tenants"("id") ON DELETE restrict ON UPDATE no action;

    ALTER TABLE "geo_foundry"."review_comments"
      ADD CONSTRAINT "review_comments_edition_id_content_editions_id_fk"
      FOREIGN KEY ("edition_id") REFERENCES "geo_foundry"."content_editions"("id") ON DELETE restrict ON UPDATE no action;
    ALTER TABLE "geo_foundry"."review_comments"
      ADD CONSTRAINT "review_comments_tenant_id_tenants_id_fk"
      FOREIGN KEY ("tenant_id") REFERENCES "geo_foundry"."tenants"("id") ON DELETE restrict ON UPDATE no action;
    ALTER TABLE "geo_foundry"."review_comments"
      ADD CONSTRAINT "review_comments_author_id_users_id_fk"
      FOREIGN KEY ("author_id") REFERENCES "geo_foundry"."users"("id") ON DELETE restrict ON UPDATE no action;

    ALTER TABLE "geo_foundry"."payload_locked_documents_rels"
      ADD CONSTRAINT "payload_locked_documents_rels_article_sources_fk"
      FOREIGN KEY ("article_sources_id") REFERENCES "geo_foundry"."article_sources"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "geo_foundry"."payload_locked_documents_rels"
      ADD CONSTRAINT "payload_locked_documents_rels_review_comments_fk"
      FOREIGN KEY ("review_comments_id") REFERENCES "geo_foundry"."review_comments"("id") ON DELETE cascade ON UPDATE no action;

    CREATE INDEX "content_editions_owner_idx" ON "geo_foundry"."content_editions" USING btree ("owner_id");
    CREATE INDEX "content_editions_priority_idx" ON "geo_foundry"."content_editions" USING btree ("priority");
    CREATE INDEX "content_editions_due_at_idx" ON "geo_foundry"."content_editions" USING btree ("due_at");
    CREATE INDEX "content_editions_editorial_status_idx" ON "geo_foundry"."content_editions" USING btree ("editorial_status");
    CREATE INDEX "_content_editions_v_version_owner_idx" ON "geo_foundry"."_content_editions_v" USING btree ("version_owner_id");
    CREATE INDEX "_content_editions_v_version_due_at_idx" ON "geo_foundry"."_content_editions_v" USING btree ("version_due_at");

    CREATE UNIQUE INDEX "article_sources_edition_intake_item_idx"
      ON "geo_foundry"."article_sources" USING btree ("edition_id", "intake_item_id");
    CREATE INDEX "article_sources_tenant_idx" ON "geo_foundry"."article_sources" USING btree ("tenant_id");
    CREATE INDEX "article_sources_edition_idx" ON "geo_foundry"."article_sources" USING btree ("edition_id");
    CREATE INDEX "article_sources_intake_item_idx" ON "geo_foundry"."article_sources" USING btree ("intake_item_id");
    CREATE INDEX "article_sources_role_idx" ON "geo_foundry"."article_sources" USING btree ("role");

    CREATE INDEX "review_comments_tenant_idx" ON "geo_foundry"."review_comments" USING btree ("tenant_id");
    CREATE INDEX "review_comments_edition_idx" ON "geo_foundry"."review_comments" USING btree ("edition_id");
    CREATE INDEX "review_comments_author_idx" ON "geo_foundry"."review_comments" USING btree ("author_id");
    CREATE INDEX "review_comments_kind_idx" ON "geo_foundry"."review_comments" USING btree ("kind");
    CREATE INDEX "review_comments_workflow_revision_idx" ON "geo_foundry"."review_comments" USING btree ("workflow_revision");
    CREATE INDEX "review_comments_created_at_idx" ON "geo_foundry"."review_comments" USING btree ("created_at");

    CREATE INDEX "payload_locked_documents_rels_article_sources_id_idx"
      ON "geo_foundry"."payload_locked_documents_rels" USING btree ("article_sources_id");
    CREATE INDEX "payload_locked_documents_rels_review_comments_id_idx"
      ON "geo_foundry"."payload_locked_documents_rels" USING btree ("review_comments_id");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "geo_foundry"."payload_locked_documents_rels"
      DROP CONSTRAINT "payload_locked_documents_rels_article_sources_fk";
    ALTER TABLE "geo_foundry"."payload_locked_documents_rels"
      DROP CONSTRAINT "payload_locked_documents_rels_review_comments_fk";
    DROP INDEX "geo_foundry"."payload_locked_documents_rels_article_sources_id_idx";
    DROP INDEX "geo_foundry"."payload_locked_documents_rels_review_comments_id_idx";
    ALTER TABLE "geo_foundry"."payload_locked_documents_rels"
      DROP COLUMN "article_sources_id",
      DROP COLUMN "review_comments_id";

    DROP TABLE "geo_foundry"."review_comments" CASCADE;
    DROP TABLE "geo_foundry"."article_sources" CASCADE;

    ALTER TABLE "geo_foundry"."_content_editions_v"
      DROP CONSTRAINT "_content_editions_v_version_owner_id_users_id_fk";
    ALTER TABLE "geo_foundry"."content_editions"
      DROP CONSTRAINT "content_editions_owner_id_users_id_fk";
    DROP INDEX "geo_foundry"."content_editions_owner_idx";
    DROP INDEX "geo_foundry"."content_editions_priority_idx";
    DROP INDEX "geo_foundry"."content_editions_due_at_idx";
    DROP INDEX "geo_foundry"."content_editions_editorial_status_idx";
    DROP INDEX "geo_foundry"."_content_editions_v_version_owner_idx";
    DROP INDEX "geo_foundry"."_content_editions_v_version_due_at_idx";
    ALTER TABLE "geo_foundry"."content_editions"
      DROP COLUMN "owner_id",
      DROP COLUMN "priority",
      DROP COLUMN "due_at",
      DROP COLUMN "editorial_status";
    ALTER TABLE "geo_foundry"."_content_editions_v"
      DROP COLUMN "version_owner_id",
      DROP COLUMN "version_priority",
      DROP COLUMN "version_due_at",
      DROP COLUMN "version_editorial_status";

    DROP TYPE "geo_foundry"."enum_review_comments_kind";
    DROP TYPE "geo_foundry"."enum_article_sources_role";
    DROP TYPE "geo_foundry"."enum__content_editions_v_version_editorial_status";
    DROP TYPE "geo_foundry"."enum__content_editions_v_version_priority";
    DROP TYPE "geo_foundry"."enum_content_editions_editorial_status";
    DROP TYPE "geo_foundry"."enum_content_editions_priority";
  `)
}
