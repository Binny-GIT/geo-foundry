import { type MigrateDownArgs, type MigrateUpArgs, sql } from "@payloadcms/db-postgres"

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "geo_foundry"."enum_contents_created_by" AS ENUM('ai', 'human', 'hybrid');
  CREATE TYPE "geo_foundry"."enum_content_editions_blocks_heading_level" AS ENUM('2', '3', '4', '5', '6');
  CREATE TYPE "geo_foundry"."enum_content_editions_blocks_list_style" AS ENUM('ordered', 'unordered');
  CREATE TYPE "geo_foundry"."enum_content_editions_blocks_callout_tone" AS ENUM('info', 'success', 'warning', 'danger');
  CREATE TYPE "geo_foundry"."enum_content_editions_creation_origin" AS ENUM('ai', 'human', 'hybrid');
  CREATE TYPE "geo_foundry"."enum_content_editions_workflow_status" AS ENUM('draft', 'generating', 'review', 'approved', 'compiled', 'published', 'archived');
  CREATE TYPE "geo_foundry"."enum_content_editions_status" AS ENUM('draft', 'published');
  CREATE TYPE "geo_foundry"."enum__content_editions_v_blocks_heading_level" AS ENUM('2', '3', '4', '5', '6');
  CREATE TYPE "geo_foundry"."enum__content_editions_v_blocks_list_style" AS ENUM('ordered', 'unordered');
  CREATE TYPE "geo_foundry"."enum__content_editions_v_blocks_callout_tone" AS ENUM('info', 'success', 'warning', 'danger');
  CREATE TYPE "geo_foundry"."enum__content_editions_v_version_creation_origin" AS ENUM('ai', 'human', 'hybrid');
  CREATE TYPE "geo_foundry"."enum__content_editions_v_version_workflow_status" AS ENUM('draft', 'generating', 'review', 'approved', 'compiled', 'published', 'archived');
  CREATE TYPE "geo_foundry"."enum__content_editions_v_version_status" AS ENUM('draft', 'published');
  CREATE TABLE "geo_foundry"."contents" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"topic" varchar NOT NULL,
  	"intent" varchar NOT NULL,
  	"tenant_id" integer NOT NULL,
  	"created_by" "geo_foundry"."enum_contents_created_by" DEFAULT 'human' NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "geo_foundry"."content_editions_blocks_paragraph" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"text" varchar,
  	"extensions" jsonb,
  	"block_name" varchar
  );
  
  CREATE TABLE "geo_foundry"."content_editions_blocks_heading" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"level" "geo_foundry"."enum_content_editions_blocks_heading_level",
  	"text" varchar,
  	"extensions" jsonb,
  	"block_name" varchar
  );
  
  CREATE TABLE "geo_foundry"."content_editions_blocks_image" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"src" varchar,
  	"alt" varchar,
  	"caption" varchar,
  	"width" numeric,
  	"height" numeric,
  	"extensions" jsonb,
  	"block_name" varchar
  );
  
  CREATE TABLE "geo_foundry"."content_editions_blocks_quote" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"text" varchar,
  	"attribution" varchar,
  	"cite_url" varchar,
  	"extensions" jsonb,
  	"block_name" varchar
  );
  
  CREATE TABLE "geo_foundry"."content_editions_blocks_list_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "geo_foundry"."content_editions_blocks_list" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"style" "geo_foundry"."enum_content_editions_blocks_list_style",
  	"extensions" jsonb,
  	"block_name" varchar
  );
  
  CREATE TABLE "geo_foundry"."content_editions_blocks_table_columns" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "geo_foundry"."content_editions_blocks_table_rows_cells" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "geo_foundry"."content_editions_blocks_table_rows" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "geo_foundry"."content_editions_blocks_table" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"caption" varchar,
  	"extensions" jsonb,
  	"block_name" varchar
  );
  
  CREATE TABLE "geo_foundry"."content_editions_blocks_faq_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"question" varchar,
  	"answer" varchar
  );
  
  CREATE TABLE "geo_foundry"."content_editions_blocks_faq" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"extensions" jsonb,
  	"block_name" varchar
  );
  
  CREATE TABLE "geo_foundry"."content_editions_blocks_callout" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"tone" "geo_foundry"."enum_content_editions_blocks_callout_tone",
  	"title" varchar,
  	"text" varchar,
  	"extensions" jsonb,
  	"block_name" varchar
  );
  
  CREATE TABLE "geo_foundry"."content_editions_blocks_code" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"language" varchar,
  	"code" varchar,
  	"caption" varchar,
  	"extensions" jsonb,
  	"block_name" varchar
  );
  
  CREATE TABLE "geo_foundry"."content_editions_blocks_video" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"src" varchar,
  	"title" varchar,
  	"poster" varchar,
  	"transcript" varchar,
  	"extensions" jsonb,
  	"block_name" varchar
  );
  
  CREATE TABLE "geo_foundry"."content_editions_blocks_embed" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"provider" varchar,
  	"url" varchar,
  	"title" varchar,
  	"extensions" jsonb,
  	"block_name" varchar
  );
  
  CREATE TABLE "geo_foundry"."content_editions_blocks_references_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"citation_id" varchar,
  	"label" varchar
  );
  
  CREATE TABLE "geo_foundry"."content_editions_blocks_references" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"extensions" jsonb,
  	"block_name" varchar
  );
  
  CREATE TABLE "geo_foundry"."content_editions" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"content_id" integer,
  	"site_id" integer,
  	"tenant_id" integer,
  	"angle" varchar,
  	"title" varchar,
  	"summary" varchar,
  	"primary_topic" varchar,
  	"citations" jsonb,
  	"entities" jsonb,
  	"creation_origin" "geo_foundry"."enum_content_editions_creation_origin" DEFAULT 'human',
  	"workflow_status" "geo_foundry"."enum_content_editions_workflow_status" DEFAULT 'draft',
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "geo_foundry"."enum_content_editions_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "geo_foundry"."content_editions_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "geo_foundry"."_content_editions_v_blocks_paragraph" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"text" varchar,
  	"extensions" jsonb,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "geo_foundry"."_content_editions_v_blocks_heading" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"level" "geo_foundry"."enum__content_editions_v_blocks_heading_level",
  	"text" varchar,
  	"extensions" jsonb,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "geo_foundry"."_content_editions_v_blocks_image" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"src" varchar,
  	"alt" varchar,
  	"caption" varchar,
  	"width" numeric,
  	"height" numeric,
  	"extensions" jsonb,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "geo_foundry"."_content_editions_v_blocks_quote" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"text" varchar,
  	"attribution" varchar,
  	"cite_url" varchar,
  	"extensions" jsonb,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "geo_foundry"."_content_editions_v_blocks_list_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"text" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "geo_foundry"."_content_editions_v_blocks_list" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"style" "geo_foundry"."enum__content_editions_v_blocks_list_style",
  	"extensions" jsonb,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "geo_foundry"."_content_editions_v_blocks_table_columns" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"text" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "geo_foundry"."_content_editions_v_blocks_table_rows_cells" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"text" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "geo_foundry"."_content_editions_v_blocks_table_rows" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_uuid" varchar
  );
  
  CREATE TABLE "geo_foundry"."_content_editions_v_blocks_table" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"caption" varchar,
  	"extensions" jsonb,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "geo_foundry"."_content_editions_v_blocks_faq_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"question" varchar,
  	"answer" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "geo_foundry"."_content_editions_v_blocks_faq" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"extensions" jsonb,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "geo_foundry"."_content_editions_v_blocks_callout" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"tone" "geo_foundry"."enum__content_editions_v_blocks_callout_tone",
  	"title" varchar,
  	"text" varchar,
  	"extensions" jsonb,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "geo_foundry"."_content_editions_v_blocks_code" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"language" varchar,
  	"code" varchar,
  	"caption" varchar,
  	"extensions" jsonb,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "geo_foundry"."_content_editions_v_blocks_video" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"src" varchar,
  	"title" varchar,
  	"poster" varchar,
  	"transcript" varchar,
  	"extensions" jsonb,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "geo_foundry"."_content_editions_v_blocks_embed" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"provider" varchar,
  	"url" varchar,
  	"title" varchar,
  	"extensions" jsonb,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "geo_foundry"."_content_editions_v_blocks_references_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"citation_id" varchar,
  	"label" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "geo_foundry"."_content_editions_v_blocks_references" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"extensions" jsonb,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "geo_foundry"."_content_editions_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_content_id" integer,
  	"version_site_id" integer,
  	"version_tenant_id" integer,
  	"version_angle" varchar,
  	"version_title" varchar,
  	"version_summary" varchar,
  	"version_primary_topic" varchar,
  	"version_citations" jsonb,
  	"version_entities" jsonb,
  	"version_creation_origin" "geo_foundry"."enum__content_editions_v_version_creation_origin" DEFAULT 'human',
  	"version_workflow_status" "geo_foundry"."enum__content_editions_v_version_workflow_status" DEFAULT 'draft',
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "geo_foundry"."enum__content_editions_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "geo_foundry"."_content_editions_v_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" ADD COLUMN "contents_id" integer;
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" ADD COLUMN "content_editions_id" integer;
  ALTER TABLE "geo_foundry"."contents" ADD CONSTRAINT "contents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "geo_foundry"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "geo_foundry"."content_editions_blocks_paragraph" ADD CONSTRAINT "content_editions_blocks_paragraph_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."content_editions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."content_editions_blocks_heading" ADD CONSTRAINT "content_editions_blocks_heading_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."content_editions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."content_editions_blocks_image" ADD CONSTRAINT "content_editions_blocks_image_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."content_editions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."content_editions_blocks_quote" ADD CONSTRAINT "content_editions_blocks_quote_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."content_editions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."content_editions_blocks_list_items" ADD CONSTRAINT "content_editions_blocks_list_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."content_editions_blocks_list"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."content_editions_blocks_list" ADD CONSTRAINT "content_editions_blocks_list_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."content_editions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."content_editions_blocks_table_columns" ADD CONSTRAINT "content_editions_blocks_table_columns_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."content_editions_blocks_table"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."content_editions_blocks_table_rows_cells" ADD CONSTRAINT "content_editions_blocks_table_rows_cells_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."content_editions_blocks_table_rows"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."content_editions_blocks_table_rows" ADD CONSTRAINT "content_editions_blocks_table_rows_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."content_editions_blocks_table"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."content_editions_blocks_table" ADD CONSTRAINT "content_editions_blocks_table_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."content_editions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."content_editions_blocks_faq_items" ADD CONSTRAINT "content_editions_blocks_faq_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."content_editions_blocks_faq"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."content_editions_blocks_faq" ADD CONSTRAINT "content_editions_blocks_faq_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."content_editions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."content_editions_blocks_callout" ADD CONSTRAINT "content_editions_blocks_callout_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."content_editions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."content_editions_blocks_code" ADD CONSTRAINT "content_editions_blocks_code_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."content_editions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."content_editions_blocks_video" ADD CONSTRAINT "content_editions_blocks_video_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."content_editions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."content_editions_blocks_embed" ADD CONSTRAINT "content_editions_blocks_embed_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."content_editions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."content_editions_blocks_references_items" ADD CONSTRAINT "content_editions_blocks_references_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."content_editions_blocks_references"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."content_editions_blocks_references" ADD CONSTRAINT "content_editions_blocks_references_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."content_editions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."content_editions" ADD CONSTRAINT "content_editions_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "geo_foundry"."contents"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "geo_foundry"."content_editions" ADD CONSTRAINT "content_editions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "geo_foundry"."sites"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "geo_foundry"."content_editions" ADD CONSTRAINT "content_editions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "geo_foundry"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "geo_foundry"."content_editions_texts" ADD CONSTRAINT "content_editions_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "geo_foundry"."content_editions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_paragraph" ADD CONSTRAINT "_content_editions_v_blocks_paragraph_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."_content_editions_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_heading" ADD CONSTRAINT "_content_editions_v_blocks_heading_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."_content_editions_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_image" ADD CONSTRAINT "_content_editions_v_blocks_image_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."_content_editions_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_quote" ADD CONSTRAINT "_content_editions_v_blocks_quote_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."_content_editions_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_list_items" ADD CONSTRAINT "_content_editions_v_blocks_list_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."_content_editions_v_blocks_list"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_list" ADD CONSTRAINT "_content_editions_v_blocks_list_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."_content_editions_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_table_columns" ADD CONSTRAINT "_content_editions_v_blocks_table_columns_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."_content_editions_v_blocks_table"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_table_rows_cells" ADD CONSTRAINT "_content_editions_v_blocks_table_rows_cells_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."_content_editions_v_blocks_table_rows"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_table_rows" ADD CONSTRAINT "_content_editions_v_blocks_table_rows_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."_content_editions_v_blocks_table"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_table" ADD CONSTRAINT "_content_editions_v_blocks_table_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."_content_editions_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_faq_items" ADD CONSTRAINT "_content_editions_v_blocks_faq_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."_content_editions_v_blocks_faq"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_faq" ADD CONSTRAINT "_content_editions_v_blocks_faq_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."_content_editions_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_callout" ADD CONSTRAINT "_content_editions_v_blocks_callout_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."_content_editions_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_code" ADD CONSTRAINT "_content_editions_v_blocks_code_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."_content_editions_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_video" ADD CONSTRAINT "_content_editions_v_blocks_video_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."_content_editions_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_embed" ADD CONSTRAINT "_content_editions_v_blocks_embed_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."_content_editions_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_references_items" ADD CONSTRAINT "_content_editions_v_blocks_references_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."_content_editions_v_blocks_references"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_references" ADD CONSTRAINT "_content_editions_v_blocks_references_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."_content_editions_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."_content_editions_v" ADD CONSTRAINT "_content_editions_v_parent_id_content_editions_id_fk" FOREIGN KEY ("parent_id") REFERENCES "geo_foundry"."content_editions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "geo_foundry"."_content_editions_v" ADD CONSTRAINT "_content_editions_v_version_content_id_contents_id_fk" FOREIGN KEY ("version_content_id") REFERENCES "geo_foundry"."contents"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "geo_foundry"."_content_editions_v" ADD CONSTRAINT "_content_editions_v_version_site_id_sites_id_fk" FOREIGN KEY ("version_site_id") REFERENCES "geo_foundry"."sites"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "geo_foundry"."_content_editions_v" ADD CONSTRAINT "_content_editions_v_version_tenant_id_tenants_id_fk" FOREIGN KEY ("version_tenant_id") REFERENCES "geo_foundry"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "geo_foundry"."_content_editions_v_texts" ADD CONSTRAINT "_content_editions_v_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "geo_foundry"."_content_editions_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "contents_tenant_idx" ON "geo_foundry"."contents" USING btree ("tenant_id");
  CREATE INDEX "contents_updated_at_idx" ON "geo_foundry"."contents" USING btree ("updated_at");
  CREATE INDEX "contents_created_at_idx" ON "geo_foundry"."contents" USING btree ("created_at");
  CREATE INDEX "content_editions_blocks_paragraph_order_idx" ON "geo_foundry"."content_editions_blocks_paragraph" USING btree ("_order");
  CREATE INDEX "content_editions_blocks_paragraph_parent_id_idx" ON "geo_foundry"."content_editions_blocks_paragraph" USING btree ("_parent_id");
  CREATE INDEX "content_editions_blocks_paragraph_path_idx" ON "geo_foundry"."content_editions_blocks_paragraph" USING btree ("_path");
  CREATE INDEX "content_editions_blocks_heading_order_idx" ON "geo_foundry"."content_editions_blocks_heading" USING btree ("_order");
  CREATE INDEX "content_editions_blocks_heading_parent_id_idx" ON "geo_foundry"."content_editions_blocks_heading" USING btree ("_parent_id");
  CREATE INDEX "content_editions_blocks_heading_path_idx" ON "geo_foundry"."content_editions_blocks_heading" USING btree ("_path");
  CREATE INDEX "content_editions_blocks_image_order_idx" ON "geo_foundry"."content_editions_blocks_image" USING btree ("_order");
  CREATE INDEX "content_editions_blocks_image_parent_id_idx" ON "geo_foundry"."content_editions_blocks_image" USING btree ("_parent_id");
  CREATE INDEX "content_editions_blocks_image_path_idx" ON "geo_foundry"."content_editions_blocks_image" USING btree ("_path");
  CREATE INDEX "content_editions_blocks_quote_order_idx" ON "geo_foundry"."content_editions_blocks_quote" USING btree ("_order");
  CREATE INDEX "content_editions_blocks_quote_parent_id_idx" ON "geo_foundry"."content_editions_blocks_quote" USING btree ("_parent_id");
  CREATE INDEX "content_editions_blocks_quote_path_idx" ON "geo_foundry"."content_editions_blocks_quote" USING btree ("_path");
  CREATE INDEX "content_editions_blocks_list_items_order_idx" ON "geo_foundry"."content_editions_blocks_list_items" USING btree ("_order");
  CREATE INDEX "content_editions_blocks_list_items_parent_id_idx" ON "geo_foundry"."content_editions_blocks_list_items" USING btree ("_parent_id");
  CREATE INDEX "content_editions_blocks_list_order_idx" ON "geo_foundry"."content_editions_blocks_list" USING btree ("_order");
  CREATE INDEX "content_editions_blocks_list_parent_id_idx" ON "geo_foundry"."content_editions_blocks_list" USING btree ("_parent_id");
  CREATE INDEX "content_editions_blocks_list_path_idx" ON "geo_foundry"."content_editions_blocks_list" USING btree ("_path");
  CREATE INDEX "content_editions_blocks_table_columns_order_idx" ON "geo_foundry"."content_editions_blocks_table_columns" USING btree ("_order");
  CREATE INDEX "content_editions_blocks_table_columns_parent_id_idx" ON "geo_foundry"."content_editions_blocks_table_columns" USING btree ("_parent_id");
  CREATE INDEX "content_editions_blocks_table_rows_cells_order_idx" ON "geo_foundry"."content_editions_blocks_table_rows_cells" USING btree ("_order");
  CREATE INDEX "content_editions_blocks_table_rows_cells_parent_id_idx" ON "geo_foundry"."content_editions_blocks_table_rows_cells" USING btree ("_parent_id");
  CREATE INDEX "content_editions_blocks_table_rows_order_idx" ON "geo_foundry"."content_editions_blocks_table_rows" USING btree ("_order");
  CREATE INDEX "content_editions_blocks_table_rows_parent_id_idx" ON "geo_foundry"."content_editions_blocks_table_rows" USING btree ("_parent_id");
  CREATE INDEX "content_editions_blocks_table_order_idx" ON "geo_foundry"."content_editions_blocks_table" USING btree ("_order");
  CREATE INDEX "content_editions_blocks_table_parent_id_idx" ON "geo_foundry"."content_editions_blocks_table" USING btree ("_parent_id");
  CREATE INDEX "content_editions_blocks_table_path_idx" ON "geo_foundry"."content_editions_blocks_table" USING btree ("_path");
  CREATE INDEX "content_editions_blocks_faq_items_order_idx" ON "geo_foundry"."content_editions_blocks_faq_items" USING btree ("_order");
  CREATE INDEX "content_editions_blocks_faq_items_parent_id_idx" ON "geo_foundry"."content_editions_blocks_faq_items" USING btree ("_parent_id");
  CREATE INDEX "content_editions_blocks_faq_order_idx" ON "geo_foundry"."content_editions_blocks_faq" USING btree ("_order");
  CREATE INDEX "content_editions_blocks_faq_parent_id_idx" ON "geo_foundry"."content_editions_blocks_faq" USING btree ("_parent_id");
  CREATE INDEX "content_editions_blocks_faq_path_idx" ON "geo_foundry"."content_editions_blocks_faq" USING btree ("_path");
  CREATE INDEX "content_editions_blocks_callout_order_idx" ON "geo_foundry"."content_editions_blocks_callout" USING btree ("_order");
  CREATE INDEX "content_editions_blocks_callout_parent_id_idx" ON "geo_foundry"."content_editions_blocks_callout" USING btree ("_parent_id");
  CREATE INDEX "content_editions_blocks_callout_path_idx" ON "geo_foundry"."content_editions_blocks_callout" USING btree ("_path");
  CREATE INDEX "content_editions_blocks_code_order_idx" ON "geo_foundry"."content_editions_blocks_code" USING btree ("_order");
  CREATE INDEX "content_editions_blocks_code_parent_id_idx" ON "geo_foundry"."content_editions_blocks_code" USING btree ("_parent_id");
  CREATE INDEX "content_editions_blocks_code_path_idx" ON "geo_foundry"."content_editions_blocks_code" USING btree ("_path");
  CREATE INDEX "content_editions_blocks_video_order_idx" ON "geo_foundry"."content_editions_blocks_video" USING btree ("_order");
  CREATE INDEX "content_editions_blocks_video_parent_id_idx" ON "geo_foundry"."content_editions_blocks_video" USING btree ("_parent_id");
  CREATE INDEX "content_editions_blocks_video_path_idx" ON "geo_foundry"."content_editions_blocks_video" USING btree ("_path");
  CREATE INDEX "content_editions_blocks_embed_order_idx" ON "geo_foundry"."content_editions_blocks_embed" USING btree ("_order");
  CREATE INDEX "content_editions_blocks_embed_parent_id_idx" ON "geo_foundry"."content_editions_blocks_embed" USING btree ("_parent_id");
  CREATE INDEX "content_editions_blocks_embed_path_idx" ON "geo_foundry"."content_editions_blocks_embed" USING btree ("_path");
  CREATE INDEX "content_editions_blocks_references_items_order_idx" ON "geo_foundry"."content_editions_blocks_references_items" USING btree ("_order");
  CREATE INDEX "content_editions_blocks_references_items_parent_id_idx" ON "geo_foundry"."content_editions_blocks_references_items" USING btree ("_parent_id");
  CREATE INDEX "content_editions_blocks_references_order_idx" ON "geo_foundry"."content_editions_blocks_references" USING btree ("_order");
  CREATE INDEX "content_editions_blocks_references_parent_id_idx" ON "geo_foundry"."content_editions_blocks_references" USING btree ("_parent_id");
  CREATE INDEX "content_editions_blocks_references_path_idx" ON "geo_foundry"."content_editions_blocks_references" USING btree ("_path");
  CREATE INDEX "content_editions_content_idx" ON "geo_foundry"."content_editions" USING btree ("content_id");
  CREATE INDEX "content_editions_site_idx" ON "geo_foundry"."content_editions" USING btree ("site_id");
  CREATE INDEX "content_editions_tenant_idx" ON "geo_foundry"."content_editions" USING btree ("tenant_id");
  CREATE INDEX "content_editions_updated_at_idx" ON "geo_foundry"."content_editions" USING btree ("updated_at");
  CREATE INDEX "content_editions_created_at_idx" ON "geo_foundry"."content_editions" USING btree ("created_at");
  CREATE INDEX "content_editions__status_idx" ON "geo_foundry"."content_editions" USING btree ("_status");
  CREATE INDEX "content_editions_texts_order_parent" ON "geo_foundry"."content_editions_texts" USING btree ("order","parent_id");
  CREATE INDEX "_content_editions_v_blocks_paragraph_order_idx" ON "geo_foundry"."_content_editions_v_blocks_paragraph" USING btree ("_order");
  CREATE INDEX "_content_editions_v_blocks_paragraph_parent_id_idx" ON "geo_foundry"."_content_editions_v_blocks_paragraph" USING btree ("_parent_id");
  CREATE INDEX "_content_editions_v_blocks_paragraph_path_idx" ON "geo_foundry"."_content_editions_v_blocks_paragraph" USING btree ("_path");
  CREATE INDEX "_content_editions_v_blocks_heading_order_idx" ON "geo_foundry"."_content_editions_v_blocks_heading" USING btree ("_order");
  CREATE INDEX "_content_editions_v_blocks_heading_parent_id_idx" ON "geo_foundry"."_content_editions_v_blocks_heading" USING btree ("_parent_id");
  CREATE INDEX "_content_editions_v_blocks_heading_path_idx" ON "geo_foundry"."_content_editions_v_blocks_heading" USING btree ("_path");
  CREATE INDEX "_content_editions_v_blocks_image_order_idx" ON "geo_foundry"."_content_editions_v_blocks_image" USING btree ("_order");
  CREATE INDEX "_content_editions_v_blocks_image_parent_id_idx" ON "geo_foundry"."_content_editions_v_blocks_image" USING btree ("_parent_id");
  CREATE INDEX "_content_editions_v_blocks_image_path_idx" ON "geo_foundry"."_content_editions_v_blocks_image" USING btree ("_path");
  CREATE INDEX "_content_editions_v_blocks_quote_order_idx" ON "geo_foundry"."_content_editions_v_blocks_quote" USING btree ("_order");
  CREATE INDEX "_content_editions_v_blocks_quote_parent_id_idx" ON "geo_foundry"."_content_editions_v_blocks_quote" USING btree ("_parent_id");
  CREATE INDEX "_content_editions_v_blocks_quote_path_idx" ON "geo_foundry"."_content_editions_v_blocks_quote" USING btree ("_path");
  CREATE INDEX "_content_editions_v_blocks_list_items_order_idx" ON "geo_foundry"."_content_editions_v_blocks_list_items" USING btree ("_order");
  CREATE INDEX "_content_editions_v_blocks_list_items_parent_id_idx" ON "geo_foundry"."_content_editions_v_blocks_list_items" USING btree ("_parent_id");
  CREATE INDEX "_content_editions_v_blocks_list_order_idx" ON "geo_foundry"."_content_editions_v_blocks_list" USING btree ("_order");
  CREATE INDEX "_content_editions_v_blocks_list_parent_id_idx" ON "geo_foundry"."_content_editions_v_blocks_list" USING btree ("_parent_id");
  CREATE INDEX "_content_editions_v_blocks_list_path_idx" ON "geo_foundry"."_content_editions_v_blocks_list" USING btree ("_path");
  CREATE INDEX "_content_editions_v_blocks_table_columns_order_idx" ON "geo_foundry"."_content_editions_v_blocks_table_columns" USING btree ("_order");
  CREATE INDEX "_content_editions_v_blocks_table_columns_parent_id_idx" ON "geo_foundry"."_content_editions_v_blocks_table_columns" USING btree ("_parent_id");
  CREATE INDEX "_content_editions_v_blocks_table_rows_cells_order_idx" ON "geo_foundry"."_content_editions_v_blocks_table_rows_cells" USING btree ("_order");
  CREATE INDEX "_content_editions_v_blocks_table_rows_cells_parent_id_idx" ON "geo_foundry"."_content_editions_v_blocks_table_rows_cells" USING btree ("_parent_id");
  CREATE INDEX "_content_editions_v_blocks_table_rows_order_idx" ON "geo_foundry"."_content_editions_v_blocks_table_rows" USING btree ("_order");
  CREATE INDEX "_content_editions_v_blocks_table_rows_parent_id_idx" ON "geo_foundry"."_content_editions_v_blocks_table_rows" USING btree ("_parent_id");
  CREATE INDEX "_content_editions_v_blocks_table_order_idx" ON "geo_foundry"."_content_editions_v_blocks_table" USING btree ("_order");
  CREATE INDEX "_content_editions_v_blocks_table_parent_id_idx" ON "geo_foundry"."_content_editions_v_blocks_table" USING btree ("_parent_id");
  CREATE INDEX "_content_editions_v_blocks_table_path_idx" ON "geo_foundry"."_content_editions_v_blocks_table" USING btree ("_path");
  CREATE INDEX "_content_editions_v_blocks_faq_items_order_idx" ON "geo_foundry"."_content_editions_v_blocks_faq_items" USING btree ("_order");
  CREATE INDEX "_content_editions_v_blocks_faq_items_parent_id_idx" ON "geo_foundry"."_content_editions_v_blocks_faq_items" USING btree ("_parent_id");
  CREATE INDEX "_content_editions_v_blocks_faq_order_idx" ON "geo_foundry"."_content_editions_v_blocks_faq" USING btree ("_order");
  CREATE INDEX "_content_editions_v_blocks_faq_parent_id_idx" ON "geo_foundry"."_content_editions_v_blocks_faq" USING btree ("_parent_id");
  CREATE INDEX "_content_editions_v_blocks_faq_path_idx" ON "geo_foundry"."_content_editions_v_blocks_faq" USING btree ("_path");
  CREATE INDEX "_content_editions_v_blocks_callout_order_idx" ON "geo_foundry"."_content_editions_v_blocks_callout" USING btree ("_order");
  CREATE INDEX "_content_editions_v_blocks_callout_parent_id_idx" ON "geo_foundry"."_content_editions_v_blocks_callout" USING btree ("_parent_id");
  CREATE INDEX "_content_editions_v_blocks_callout_path_idx" ON "geo_foundry"."_content_editions_v_blocks_callout" USING btree ("_path");
  CREATE INDEX "_content_editions_v_blocks_code_order_idx" ON "geo_foundry"."_content_editions_v_blocks_code" USING btree ("_order");
  CREATE INDEX "_content_editions_v_blocks_code_parent_id_idx" ON "geo_foundry"."_content_editions_v_blocks_code" USING btree ("_parent_id");
  CREATE INDEX "_content_editions_v_blocks_code_path_idx" ON "geo_foundry"."_content_editions_v_blocks_code" USING btree ("_path");
  CREATE INDEX "_content_editions_v_blocks_video_order_idx" ON "geo_foundry"."_content_editions_v_blocks_video" USING btree ("_order");
  CREATE INDEX "_content_editions_v_blocks_video_parent_id_idx" ON "geo_foundry"."_content_editions_v_blocks_video" USING btree ("_parent_id");
  CREATE INDEX "_content_editions_v_blocks_video_path_idx" ON "geo_foundry"."_content_editions_v_blocks_video" USING btree ("_path");
  CREATE INDEX "_content_editions_v_blocks_embed_order_idx" ON "geo_foundry"."_content_editions_v_blocks_embed" USING btree ("_order");
  CREATE INDEX "_content_editions_v_blocks_embed_parent_id_idx" ON "geo_foundry"."_content_editions_v_blocks_embed" USING btree ("_parent_id");
  CREATE INDEX "_content_editions_v_blocks_embed_path_idx" ON "geo_foundry"."_content_editions_v_blocks_embed" USING btree ("_path");
  CREATE INDEX "_content_editions_v_blocks_references_items_order_idx" ON "geo_foundry"."_content_editions_v_blocks_references_items" USING btree ("_order");
  CREATE INDEX "_content_editions_v_blocks_references_items_parent_id_idx" ON "geo_foundry"."_content_editions_v_blocks_references_items" USING btree ("_parent_id");
  CREATE INDEX "_content_editions_v_blocks_references_order_idx" ON "geo_foundry"."_content_editions_v_blocks_references" USING btree ("_order");
  CREATE INDEX "_content_editions_v_blocks_references_parent_id_idx" ON "geo_foundry"."_content_editions_v_blocks_references" USING btree ("_parent_id");
  CREATE INDEX "_content_editions_v_blocks_references_path_idx" ON "geo_foundry"."_content_editions_v_blocks_references" USING btree ("_path");
  CREATE INDEX "_content_editions_v_parent_idx" ON "geo_foundry"."_content_editions_v" USING btree ("parent_id");
  CREATE INDEX "_content_editions_v_version_version_content_idx" ON "geo_foundry"."_content_editions_v" USING btree ("version_content_id");
  CREATE INDEX "_content_editions_v_version_version_site_idx" ON "geo_foundry"."_content_editions_v" USING btree ("version_site_id");
  CREATE INDEX "_content_editions_v_version_version_tenant_idx" ON "geo_foundry"."_content_editions_v" USING btree ("version_tenant_id");
  CREATE INDEX "_content_editions_v_version_version_updated_at_idx" ON "geo_foundry"."_content_editions_v" USING btree ("version_updated_at");
  CREATE INDEX "_content_editions_v_version_version_created_at_idx" ON "geo_foundry"."_content_editions_v" USING btree ("version_created_at");
  CREATE INDEX "_content_editions_v_version_version__status_idx" ON "geo_foundry"."_content_editions_v" USING btree ("version__status");
  CREATE INDEX "_content_editions_v_created_at_idx" ON "geo_foundry"."_content_editions_v" USING btree ("created_at");
  CREATE INDEX "_content_editions_v_updated_at_idx" ON "geo_foundry"."_content_editions_v" USING btree ("updated_at");
  CREATE INDEX "_content_editions_v_latest_idx" ON "geo_foundry"."_content_editions_v" USING btree ("latest");
  CREATE INDEX "_content_editions_v_texts_order_parent" ON "geo_foundry"."_content_editions_v_texts" USING btree ("order","parent_id");
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_contents_fk" FOREIGN KEY ("contents_id") REFERENCES "geo_foundry"."contents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_content_editions_fk" FOREIGN KEY ("content_editions_id") REFERENCES "geo_foundry"."content_editions"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_contents_id_idx" ON "geo_foundry"."payload_locked_documents_rels" USING btree ("contents_id");
  CREATE INDEX "payload_locked_documents_rels_content_editions_id_idx" ON "geo_foundry"."payload_locked_documents_rels" USING btree ("content_editions_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "geo_foundry"."contents" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."content_editions_blocks_paragraph" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."content_editions_blocks_heading" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."content_editions_blocks_image" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."content_editions_blocks_quote" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."content_editions_blocks_list_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."content_editions_blocks_list" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."content_editions_blocks_table_columns" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."content_editions_blocks_table_rows_cells" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."content_editions_blocks_table_rows" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."content_editions_blocks_table" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."content_editions_blocks_faq_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."content_editions_blocks_faq" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."content_editions_blocks_callout" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."content_editions_blocks_code" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."content_editions_blocks_video" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."content_editions_blocks_embed" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."content_editions_blocks_references_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."content_editions_blocks_references" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."content_editions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."content_editions_texts" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_paragraph" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_heading" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_image" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_quote" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_list_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_list" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_table_columns" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_table_rows_cells" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_table_rows" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_table" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_faq_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_faq" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_callout" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_code" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_video" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_embed" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_references_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."_content_editions_v_blocks_references" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."_content_editions_v" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."_content_editions_v_texts" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "geo_foundry"."contents" CASCADE;
  DROP TABLE "geo_foundry"."content_editions_blocks_paragraph" CASCADE;
  DROP TABLE "geo_foundry"."content_editions_blocks_heading" CASCADE;
  DROP TABLE "geo_foundry"."content_editions_blocks_image" CASCADE;
  DROP TABLE "geo_foundry"."content_editions_blocks_quote" CASCADE;
  DROP TABLE "geo_foundry"."content_editions_blocks_list_items" CASCADE;
  DROP TABLE "geo_foundry"."content_editions_blocks_list" CASCADE;
  DROP TABLE "geo_foundry"."content_editions_blocks_table_columns" CASCADE;
  DROP TABLE "geo_foundry"."content_editions_blocks_table_rows_cells" CASCADE;
  DROP TABLE "geo_foundry"."content_editions_blocks_table_rows" CASCADE;
  DROP TABLE "geo_foundry"."content_editions_blocks_table" CASCADE;
  DROP TABLE "geo_foundry"."content_editions_blocks_faq_items" CASCADE;
  DROP TABLE "geo_foundry"."content_editions_blocks_faq" CASCADE;
  DROP TABLE "geo_foundry"."content_editions_blocks_callout" CASCADE;
  DROP TABLE "geo_foundry"."content_editions_blocks_code" CASCADE;
  DROP TABLE "geo_foundry"."content_editions_blocks_video" CASCADE;
  DROP TABLE "geo_foundry"."content_editions_blocks_embed" CASCADE;
  DROP TABLE "geo_foundry"."content_editions_blocks_references_items" CASCADE;
  DROP TABLE "geo_foundry"."content_editions_blocks_references" CASCADE;
  DROP TABLE "geo_foundry"."content_editions" CASCADE;
  DROP TABLE "geo_foundry"."content_editions_texts" CASCADE;
  DROP TABLE "geo_foundry"."_content_editions_v_blocks_paragraph" CASCADE;
  DROP TABLE "geo_foundry"."_content_editions_v_blocks_heading" CASCADE;
  DROP TABLE "geo_foundry"."_content_editions_v_blocks_image" CASCADE;
  DROP TABLE "geo_foundry"."_content_editions_v_blocks_quote" CASCADE;
  DROP TABLE "geo_foundry"."_content_editions_v_blocks_list_items" CASCADE;
  DROP TABLE "geo_foundry"."_content_editions_v_blocks_list" CASCADE;
  DROP TABLE "geo_foundry"."_content_editions_v_blocks_table_columns" CASCADE;
  DROP TABLE "geo_foundry"."_content_editions_v_blocks_table_rows_cells" CASCADE;
  DROP TABLE "geo_foundry"."_content_editions_v_blocks_table_rows" CASCADE;
  DROP TABLE "geo_foundry"."_content_editions_v_blocks_table" CASCADE;
  DROP TABLE "geo_foundry"."_content_editions_v_blocks_faq_items" CASCADE;
  DROP TABLE "geo_foundry"."_content_editions_v_blocks_faq" CASCADE;
  DROP TABLE "geo_foundry"."_content_editions_v_blocks_callout" CASCADE;
  DROP TABLE "geo_foundry"."_content_editions_v_blocks_code" CASCADE;
  DROP TABLE "geo_foundry"."_content_editions_v_blocks_video" CASCADE;
  DROP TABLE "geo_foundry"."_content_editions_v_blocks_embed" CASCADE;
  DROP TABLE "geo_foundry"."_content_editions_v_blocks_references_items" CASCADE;
  DROP TABLE "geo_foundry"."_content_editions_v_blocks_references" CASCADE;
  DROP TABLE "geo_foundry"."_content_editions_v" CASCADE;
  DROP TABLE "geo_foundry"."_content_editions_v_texts" CASCADE;
  DROP INDEX "geo_foundry"."payload_locked_documents_rels_contents_id_idx";
  DROP INDEX "geo_foundry"."payload_locked_documents_rels_content_editions_id_idx";
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" DROP COLUMN "contents_id";
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" DROP COLUMN "content_editions_id";
  DROP TYPE "geo_foundry"."enum_contents_created_by";
  DROP TYPE "geo_foundry"."enum_content_editions_blocks_heading_level";
  DROP TYPE "geo_foundry"."enum_content_editions_blocks_list_style";
  DROP TYPE "geo_foundry"."enum_content_editions_blocks_callout_tone";
  DROP TYPE "geo_foundry"."enum_content_editions_creation_origin";
  DROP TYPE "geo_foundry"."enum_content_editions_workflow_status";
  DROP TYPE "geo_foundry"."enum_content_editions_status";
  DROP TYPE "geo_foundry"."enum__content_editions_v_blocks_heading_level";
  DROP TYPE "geo_foundry"."enum__content_editions_v_blocks_list_style";
  DROP TYPE "geo_foundry"."enum__content_editions_v_blocks_callout_tone";
  DROP TYPE "geo_foundry"."enum__content_editions_v_version_creation_origin";
  DROP TYPE "geo_foundry"."enum__content_editions_v_version_workflow_status";
  DROP TYPE "geo_foundry"."enum__content_editions_v_version_status";`)
}
