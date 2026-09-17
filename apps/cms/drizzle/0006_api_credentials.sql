/* 集成密钥表：Console 自助签发给外部 AI/自动化工具的 API Key。
 * 明文永不落库，只保存 HMAC-SHA256 索引与展示用前缀；吊销为软删除，
 * 保留审计痕迹。users.api_key_index 不受影响，继续服务 Worker keyring。
 */

CREATE TABLE IF NOT EXISTS "geo_foundry"."api_credentials" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "name" varchar NOT NULL,
  "key_prefix" varchar NOT NULL,
  "key_index" varchar NOT NULL,
  "created_by_id" integer NOT NULL,
  "last_used_at" timestamp(3) with time zone,
  "revoked_at" timestamp(3) with time zone,
  "expires_at" timestamp(3) with time zone,
  "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "api_credentials_key_index_idx"
  ON "geo_foundry"."api_credentials" USING btree ("key_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_credentials_tenant_idx"
  ON "geo_foundry"."api_credentials" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_credentials_user_idx"
  ON "geo_foundry"."api_credentials" USING btree ("user_id");
