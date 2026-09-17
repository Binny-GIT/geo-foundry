/* connectors 增加可配置轮询间隔（分钟）。此前硬编码 1 小时，改间隔只能改代码。
 * 默认 60 保持既有行为；CHECK 约束把值域钉在 5 分钟～一周，防误配打爆上游。
 * 存量行由 DEFAULT 回填，无需数据迁移。
 */

ALTER TABLE "geo_foundry"."connectors"
  ADD COLUMN IF NOT EXISTS "poll_interval_minutes" integer DEFAULT 60 NOT NULL;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'geo_foundry'
      AND table_name = 'connectors'
      AND column_name = 'poll_interval_minutes'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'connectors_poll_interval_check'
      AND conrelid = '"geo_foundry"."connectors"'::regclass
  ) THEN
    EXECUTE 'ALTER TABLE "geo_foundry"."connectors"
      ADD CONSTRAINT "connectors_poll_interval_check"
      CHECK ("poll_interval_minutes" >= 5 AND "poll_interval_minutes" <= 10080)';
  END IF;
END $$;
