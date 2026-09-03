import { type MigrateDownArgs, type MigrateUpArgs, sql } from "@payloadcms/db-postgres"

/*
 * 2026-09 自由多站点：content-editions 新增 hasMany `sites` 分配字段。
 * 单选 site 保持主表列（发布链路主站点），多选 sites 走 rels 表。
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "geo_foundry"."content_editions_rels" (
      "id" serial PRIMARY KEY NOT NULL,
      "order" integer,
      "parent_id" integer NOT NULL,
      "path" varchar NOT NULL,
      "sites_id" integer
    );
  `)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "geo_foundry"."_content_editions_v_rels" (
      "id" serial PRIMARY KEY NOT NULL,
      "order" integer,
      "parent_id" integer NOT NULL,
      "path" varchar NOT NULL,
      "sites_id" integer
    );
  `)
  await db.execute(sql`
    ALTER TABLE "geo_foundry"."content_editions_rels"
      DROP CONSTRAINT IF EXISTS "content_editions_rels_parent_fk";
    ALTER TABLE "geo_foundry"."content_editions_rels"
      ADD CONSTRAINT "content_editions_rels_parent_fk" FOREIGN KEY ("parent_id")
      REFERENCES "geo_foundry"."content_editions"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "geo_foundry"."content_editions_rels"
      DROP CONSTRAINT IF EXISTS "content_editions_rels_sites_fk";
    ALTER TABLE "geo_foundry"."content_editions_rels"
      ADD CONSTRAINT "content_editions_rels_sites_fk" FOREIGN KEY ("sites_id")
      REFERENCES "geo_foundry"."sites"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "geo_foundry"."_content_editions_v_rels"
      DROP CONSTRAINT IF EXISTS "_content_editions_v_rels_parent_fk";
    ALTER TABLE "geo_foundry"."_content_editions_v_rels"
      ADD CONSTRAINT "_content_editions_v_rels_parent_fk" FOREIGN KEY ("parent_id")
      REFERENCES "geo_foundry"."_content_editions_v"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "geo_foundry"."_content_editions_v_rels"
      DROP CONSTRAINT IF EXISTS "_content_editions_v_rels_sites_fk";
    ALTER TABLE "geo_foundry"."_content_editions_v_rels"
      ADD CONSTRAINT "_content_editions_v_rels_sites_fk" FOREIGN KEY ("sites_id")
      REFERENCES "geo_foundry"."sites"("id") ON DELETE cascade ON UPDATE no action;
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "content_editions_rels_order_idx"
      ON "geo_foundry"."content_editions_rels" USING btree ("order");
    CREATE INDEX IF NOT EXISTS "content_editions_rels_parent_idx"
      ON "geo_foundry"."content_editions_rels" USING btree ("parent_id");
    CREATE INDEX IF NOT EXISTS "content_editions_rels_path_idx"
      ON "geo_foundry"."content_editions_rels" USING btree ("path");
    CREATE INDEX IF NOT EXISTS "content_editions_rels_sites_id_idx"
      ON "geo_foundry"."content_editions_rels" USING btree ("sites_id");
    CREATE INDEX IF NOT EXISTS "_content_editions_v_rels_order_idx"
      ON "geo_foundry"."_content_editions_v_rels" USING btree ("order");
    CREATE INDEX IF NOT EXISTS "_content_editions_v_rels_parent_idx"
      ON "geo_foundry"."_content_editions_v_rels" USING btree ("parent_id");
    CREATE INDEX IF NOT EXISTS "_content_editions_v_rels_path_idx"
      ON "geo_foundry"."_content_editions_v_rels" USING btree ("path");
    CREATE INDEX IF NOT EXISTS "_content_editions_v_rels_sites_id_idx"
      ON "geo_foundry"."_content_editions_v_rels" USING btree ("sites_id");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE IF EXISTS "geo_foundry"."content_editions_rels" CASCADE;
    DROP TABLE IF EXISTS "geo_foundry"."_content_editions_v_rels" CASCADE;
  `)
}
