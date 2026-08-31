import { type MigrateDownArgs, type MigrateUpArgs, sql } from "@payloadcms/db-postgres"

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "geo_foundry"."enum_api_usage_dailies_route" AS ENUM ('articles', 'article');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "geo_foundry"."api_usage_dailies" (
      "id" serial PRIMARY KEY NOT NULL,
      "count" integer DEFAULT 0,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "date" varchar,
      "route" "geo_foundry"."enum_api_usage_dailies_route",
      "site_id" integer,
      "tenant_id" integer,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "api_usage_dailies_created_at_idx"
      ON "geo_foundry"."api_usage_dailies" USING btree ("created_at");
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "api_usage_dailies_updated_at_idx"
      ON "geo_foundry"."api_usage_dailies" USING btree ("updated_at");
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "api_usage_dailies_date_idx"
      ON "geo_foundry"."api_usage_dailies" USING btree ("date");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE IF EXISTS "geo_foundry"."api_usage_dailies" CASCADE;
  `)
  await db.execute(sql`
    DROP TYPE IF EXISTS "geo_foundry"."enum_api_usage_dailies_route";
  `)
}
