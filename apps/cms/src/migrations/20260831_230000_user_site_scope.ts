import { type MigrateDownArgs, type MigrateUpArgs, sql } from "@payloadcms/db-postgres"

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "geo_foundry"."users_rels" (
      "id" serial PRIMARY KEY NOT NULL,
      "order" integer,
      "parent_id" integer NOT NULL,
      "path" varchar NOT NULL,
      "sites_id" integer
    );
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "users_rels_order_idx"
      ON "geo_foundry"."users_rels" USING btree ("order");
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "users_rels_parent_idx"
      ON "geo_foundry"."users_rels" USING btree ("parent_id");
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "users_rels_path_idx"
      ON "geo_foundry"."users_rels" USING btree ("path");
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "users_rels_sites_id_idx"
      ON "geo_foundry"."users_rels" USING btree ("sites_id");
  `)
  await db.execute(sql`
    ALTER TABLE "geo_foundry"."users_rels"
      DROP CONSTRAINT IF EXISTS "users_rels_parent_fk";
  `)
  await db.execute(sql`
    ALTER TABLE "geo_foundry"."users_rels"
      ADD CONSTRAINT "users_rels_parent_fk"
      FOREIGN KEY ("parent_id") REFERENCES "geo_foundry"."users"("id")
      ON DELETE cascade ON UPDATE no action;
  `)
  await db.execute(sql`
    ALTER TABLE "geo_foundry"."users_rels"
      DROP CONSTRAINT IF EXISTS "users_rels_sites_fk";
  `)
  await db.execute(sql`
    ALTER TABLE "geo_foundry"."users_rels"
      ADD CONSTRAINT "users_rels_sites_fk"
      FOREIGN KEY ("sites_id") REFERENCES "geo_foundry"."sites"("id")
      ON DELETE cascade ON UPDATE no action;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE IF EXISTS "geo_foundry"."users_rels" CASCADE;
  `)
}
