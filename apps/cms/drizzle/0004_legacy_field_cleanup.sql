/* 第二轮旧字段收口：消费者已先迁到派生值/真实业务字段。
 * DROP 前的守卫只检查会导致凭据失效或语义丢失的情况；历史 topic/intent、
 * media 路径/焦点值已通过整库备份保留，不再留在运行时模型中。
 */

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "geo_foundry"."users"
    WHERE ("enable_a_p_i_key" IS TRUE OR ("api_key" IS NOT NULL AND btrim("api_key") <> ''))
      AND ("api_key_index" IS NULL OR btrim("api_key_index") = '')
  ) THEN
    RAISE EXCEPTION 'USER_API_KEY_INDEX_MISSING';
  END IF;
END
$$;--> statement-breakpoint

ALTER TABLE "geo_foundry"."content_editions"
  DROP COLUMN "content_topic",
  DROP COLUMN "content_intent";--> statement-breakpoint

ALTER TABLE "geo_foundry"."url_records"
  DROP COLUMN "audit";--> statement-breakpoint

ALTER TABLE "geo_foundry"."users"
  DROP COLUMN "api_key";--> statement-breakpoint

ALTER TABLE "geo_foundry"."operations"
  DROP COLUMN "provider_version",
  DROP COLUMN "prompt_version",
  DROP COLUMN "model_id";--> statement-breakpoint

ALTER TABLE "geo_foundry"."media"
  DROP COLUMN "prefix",
  DROP COLUMN "url",
  DROP COLUMN "thumbnail_u_r_l",
  DROP COLUMN "width",
  DROP COLUMN "height",
  DROP COLUMN "focal_x",
  DROP COLUMN "focal_y",
  DROP COLUMN "media_path";
