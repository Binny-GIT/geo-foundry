import { type MigrateDownArgs, type MigrateUpArgs, sql } from "@payloadcms/db-postgres"

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "geo_foundry"."enum_users_role" AS ENUM('content-service', 'editor', 'publisher', 'reviewer', 'super-admin', 'tenant-admin');
  CREATE TABLE "geo_foundry"."tenants" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "geo_foundry"."users_sessions" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"created_at" timestamp(3) with time zone,
  	"expires_at" timestamp(3) with time zone NOT NULL
  );
  
  CREATE TABLE "geo_foundry"."users" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"role" "geo_foundry"."enum_users_role" NOT NULL,
  	"tenant_id" integer,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"enable_a_p_i_key" boolean,
  	"api_key" varchar,
  	"api_key_index" varchar,
  	"email" varchar NOT NULL,
  	"reset_password_token" varchar,
  	"reset_password_expiration" timestamp(3) with time zone,
  	"salt" varchar,
  	"hash" varchar,
  	"login_attempts" numeric DEFAULT 0,
  	"lock_until" timestamp(3) with time zone
  );
  
  ALTER TABLE "geo_foundry"."bootstrap_admins_sessions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."bootstrap_admins" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "geo_foundry"."bootstrap_admins_sessions" CASCADE;
  DROP TABLE "geo_foundry"."bootstrap_admins" CASCADE;
  DROP INDEX "geo_foundry"."payload_locked_documents_rels_bootstrap_admins_id_idx";
  DROP INDEX "geo_foundry"."payload_preferences_rels_bootstrap_admins_id_idx";
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" ADD COLUMN "tenants_id" integer;
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" ADD COLUMN "users_id" integer;
  ALTER TABLE "geo_foundry"."payload_preferences_rels" ADD COLUMN "users_id" integer;
  ALTER TABLE "geo_foundry"."users_sessions" ADD CONSTRAINT "users_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "geo_foundry"."tenants"("id") ON DELETE set null ON UPDATE no action;
  CREATE UNIQUE INDEX "tenants_name_idx" ON "geo_foundry"."tenants" USING btree ("name");
  CREATE INDEX "tenants_updated_at_idx" ON "geo_foundry"."tenants" USING btree ("updated_at");
  CREATE INDEX "tenants_created_at_idx" ON "geo_foundry"."tenants" USING btree ("created_at");
  CREATE INDEX "users_sessions_order_idx" ON "geo_foundry"."users_sessions" USING btree ("_order");
  CREATE INDEX "users_sessions_parent_id_idx" ON "geo_foundry"."users_sessions" USING btree ("_parent_id");
  CREATE INDEX "users_tenant_idx" ON "geo_foundry"."users" USING btree ("tenant_id");
  CREATE INDEX "users_updated_at_idx" ON "geo_foundry"."users" USING btree ("updated_at");
  CREATE INDEX "users_created_at_idx" ON "geo_foundry"."users" USING btree ("created_at");
  CREATE UNIQUE INDEX "users_email_idx" ON "geo_foundry"."users" USING btree ("email");
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_tenants_fk" FOREIGN KEY ("tenants_id") REFERENCES "geo_foundry"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "geo_foundry"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "geo_foundry"."users"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_tenants_id_idx" ON "geo_foundry"."payload_locked_documents_rels" USING btree ("tenants_id");
  CREATE INDEX "payload_locked_documents_rels_users_id_idx" ON "geo_foundry"."payload_locked_documents_rels" USING btree ("users_id");
  CREATE INDEX "payload_preferences_rels_users_id_idx" ON "geo_foundry"."payload_preferences_rels" USING btree ("users_id");
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" DROP COLUMN "bootstrap_admins_id";
  ALTER TABLE "geo_foundry"."payload_preferences_rels" DROP COLUMN "bootstrap_admins_id";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "geo_foundry"."bootstrap_admins_sessions" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"created_at" timestamp(3) with time zone,
  	"expires_at" timestamp(3) with time zone NOT NULL
  );
  
  CREATE TABLE "geo_foundry"."bootstrap_admins" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"email" varchar NOT NULL,
  	"reset_password_token" varchar,
  	"reset_password_expiration" timestamp(3) with time zone,
  	"salt" varchar,
  	"hash" varchar,
  	"login_attempts" numeric DEFAULT 0,
  	"lock_until" timestamp(3) with time zone
  );
  
  ALTER TABLE "geo_foundry"."tenants" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."users_sessions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "geo_foundry"."users" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "geo_foundry"."tenants" CASCADE;
  DROP TABLE "geo_foundry"."users_sessions" CASCADE;
  DROP TABLE "geo_foundry"."users" CASCADE;
  DROP INDEX "geo_foundry"."payload_locked_documents_rels_tenants_id_idx";
  DROP INDEX "geo_foundry"."payload_locked_documents_rels_users_id_idx";
  DROP INDEX "geo_foundry"."payload_preferences_rels_users_id_idx";
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" ADD COLUMN "bootstrap_admins_id" integer;
  ALTER TABLE "geo_foundry"."payload_preferences_rels" ADD COLUMN "bootstrap_admins_id" integer;
  ALTER TABLE "geo_foundry"."bootstrap_admins_sessions" ADD CONSTRAINT "bootstrap_admins_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "geo_foundry"."bootstrap_admins"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "bootstrap_admins_sessions_order_idx" ON "geo_foundry"."bootstrap_admins_sessions" USING btree ("_order");
  CREATE INDEX "bootstrap_admins_sessions_parent_id_idx" ON "geo_foundry"."bootstrap_admins_sessions" USING btree ("_parent_id");
  CREATE INDEX "bootstrap_admins_updated_at_idx" ON "geo_foundry"."bootstrap_admins" USING btree ("updated_at");
  CREATE INDEX "bootstrap_admins_created_at_idx" ON "geo_foundry"."bootstrap_admins" USING btree ("created_at");
  CREATE UNIQUE INDEX "bootstrap_admins_email_idx" ON "geo_foundry"."bootstrap_admins" USING btree ("email");
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_bootstrap_admins_fk" FOREIGN KEY ("bootstrap_admins_id") REFERENCES "geo_foundry"."bootstrap_admins"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "geo_foundry"."payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_bootstrap_admins_fk" FOREIGN KEY ("bootstrap_admins_id") REFERENCES "geo_foundry"."bootstrap_admins"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_bootstrap_admins_id_idx" ON "geo_foundry"."payload_locked_documents_rels" USING btree ("bootstrap_admins_id");
  CREATE INDEX "payload_preferences_rels_bootstrap_admins_id_idx" ON "geo_foundry"."payload_preferences_rels" USING btree ("bootstrap_admins_id");
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" DROP COLUMN "tenants_id";
  ALTER TABLE "geo_foundry"."payload_locked_documents_rels" DROP COLUMN "users_id";
  ALTER TABLE "geo_foundry"."payload_preferences_rels" DROP COLUMN "users_id";
  DROP TYPE "geo_foundry"."enum_users_role";`)
}
