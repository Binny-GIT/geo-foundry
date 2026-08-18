import { type MigrateDownArgs, type MigrateUpArgs, sql } from "@payloadcms/db-postgres"

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "geo_foundry"."media" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"tenant_id" integer NOT NULL,
  	"alt" varchar NOT NULL,
  	"caption" varchar,
  	"prefix" varchar DEFAULT '',
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"url" varchar,
  	"thumbnail_u_r_l" varchar,
  	"filename" varchar,
  	"mime_type" varchar,
  	"filesize" numeric,
  	"width" numeric,
  	"height" numeric,
  	"focal_x" numeric,
  	"focal_y" numeric
  );
  
  ALTER TABLE "geo_foundry"."bootstrap_media" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "geo_foundry"."bootstrap_media" CASCADE;
  DROP INDEX "geo_foundry"."payload_locked_documents_rels_bootstrap_media_id_idx";
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" ADD COLUMN "media_id" integer;
  ALTER TABLE "geo_foundry"."media" ADD CONSTRAINT "media_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "geo_foundry"."tenants"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "media_tenant_idx" ON "geo_foundry"."media" USING btree ("tenant_id");
  CREATE INDEX "media_updated_at_idx" ON "geo_foundry"."media" USING btree ("updated_at");
  CREATE INDEX "media_created_at_idx" ON "geo_foundry"."media" USING btree ("created_at");
  CREATE UNIQUE INDEX "media_filename_idx" ON "geo_foundry"."media" USING btree ("filename");
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "geo_foundry"."media"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_media_id_idx" ON "geo_foundry"."payload_locked_documents_rels" USING btree ("media_id");
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" DROP COLUMN "bootstrap_media_id";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "geo_foundry"."bootstrap_media" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"alt" varchar NOT NULL,
  	"prefix" varchar DEFAULT 'objects/cms-bootstrap/media',
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"url" varchar,
  	"thumbnail_u_r_l" varchar,
  	"filename" varchar,
  	"mime_type" varchar,
  	"filesize" numeric,
  	"width" numeric,
  	"height" numeric,
  	"focal_x" numeric,
  	"focal_y" numeric
  );
  
  ALTER TABLE "geo_foundry"."media" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "geo_foundry"."media" CASCADE;
  DROP INDEX "geo_foundry"."payload_locked_documents_rels_media_id_idx";
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" ADD COLUMN "bootstrap_media_id" integer;
  CREATE INDEX "bootstrap_media_updated_at_idx" ON "geo_foundry"."bootstrap_media" USING btree ("updated_at");
  CREATE INDEX "bootstrap_media_created_at_idx" ON "geo_foundry"."bootstrap_media" USING btree ("created_at");
  CREATE UNIQUE INDEX "bootstrap_media_filename_idx" ON "geo_foundry"."bootstrap_media" USING btree ("filename");
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_bootstrap_media_fk" FOREIGN KEY ("bootstrap_media_id") REFERENCES "geo_foundry"."bootstrap_media"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_bootstrap_media_id_idx" ON "geo_foundry"."payload_locked_documents_rels" USING btree ("bootstrap_media_id");
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" DROP COLUMN "media_id";`)
}
