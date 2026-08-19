import { type MigrateDownArgs, type MigrateUpArgs, sql } from "@payloadcms/db-postgres"

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
  CREATE TABLE "geo_foundry"."embeddings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"embedding_key" varchar NOT NULL,
  	"tenant_id" integer NOT NULL,
  	"site_id" integer NOT NULL,
  	"edition_id" integer NOT NULL,
  	"scope" varchar NOT NULL,
  	"model_id" varchar NOT NULL,
  	"dimension" integer NOT NULL,
  	"input_hash" varchar NOT NULL,
  	"embedding" public.vector(1536) NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	CONSTRAINT "embeddings_scope_check" CHECK ("scope" IN ('content', 'title')),
  	CONSTRAINT "embeddings_dimension_check" CHECK ("dimension" > 0),
  	CONSTRAINT "embeddings_input_hash_check" CHECK ("input_hash" ~ '^[0-9a-f]{64}$')
  );
  ALTER TABLE "geo_foundry"."embeddings" ADD CONSTRAINT "embeddings_tenant_id_tenants_fk" FOREIGN KEY ("tenant_id") REFERENCES "geo_foundry"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."embeddings" ADD CONSTRAINT "embeddings_site_id_sites_fk" FOREIGN KEY ("site_id") REFERENCES "geo_foundry"."sites"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."embeddings" ADD CONSTRAINT "embeddings_edition_id_content_editions_fk" FOREIGN KEY ("edition_id") REFERENCES "geo_foundry"."content_editions"("id") ON DELETE cascade ON UPDATE no action;
  CREATE UNIQUE INDEX "embeddings_embedding_key_idx" ON "geo_foundry"."embeddings" USING btree ("embedding_key");
  CREATE INDEX "embeddings_lookup_idx" ON "geo_foundry"."embeddings" USING btree ("tenant_id", "scope", "model_id", "dimension", "site_id");
  CREATE INDEX "embeddings_edition_idx" ON "geo_foundry"."embeddings" USING btree ("edition_id");
  CREATE INDEX "embeddings_embedding_hnsw_idx" ON "geo_foundry"."embeddings" USING hnsw ("embedding" public.vector_cosine_ops);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DROP INDEX "geo_foundry"."embeddings_embedding_hnsw_idx";
  DROP INDEX "geo_foundry"."embeddings_edition_idx";
  DROP INDEX "geo_foundry"."embeddings_lookup_idx";
  DROP INDEX "geo_foundry"."embeddings_embedding_key_idx";
  ALTER TABLE "geo_foundry"."embeddings" DROP CONSTRAINT "embeddings_edition_id_content_editions_fk";
  ALTER TABLE "geo_foundry"."embeddings" DROP CONSTRAINT "embeddings_site_id_sites_fk";
  ALTER TABLE "geo_foundry"."embeddings" DROP CONSTRAINT "embeddings_tenant_id_tenants_fk";
  DROP TABLE "geo_foundry"."embeddings";`)
}
