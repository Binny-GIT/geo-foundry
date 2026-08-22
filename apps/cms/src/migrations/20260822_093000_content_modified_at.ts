import { type MigrateDownArgs, type MigrateUpArgs, sql } from "@payloadcms/db-postgres"

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "geo_foundry"."content_editions"
      ADD COLUMN "content_modified_at" timestamp(3) with time zone;
    UPDATE "geo_foundry"."content_editions"
      SET "content_modified_at" = "updated_at";
    ALTER TABLE "geo_foundry"."content_editions"
      ALTER COLUMN "content_modified_at" SET NOT NULL;

    ALTER TABLE "geo_foundry"."_content_editions_v"
      ADD COLUMN "version_content_modified_at" timestamp(3) with time zone;
    UPDATE "geo_foundry"."_content_editions_v"
      SET "version_content_modified_at" = "version_updated_at";

    CREATE INDEX "content_editions_content_modified_at_idx"
      ON "geo_foundry"."content_editions" USING btree ("content_modified_at");
    CREATE INDEX "_content_editions_v_version_content_modified_at_idx"
      ON "geo_foundry"."_content_editions_v" USING btree ("version_content_modified_at");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP INDEX "geo_foundry"."content_editions_content_modified_at_idx";
    DROP INDEX "geo_foundry"."_content_editions_v_version_content_modified_at_idx";
    ALTER TABLE "geo_foundry"."_content_editions_v"
      DROP COLUMN "version_content_modified_at";
    ALTER TABLE "geo_foundry"."content_editions"
      DROP COLUMN "content_modified_at";
  `)
}
