/* 工作流与聚合不变量收口：workflow_status 成为文章唯一状态真相；
 * latest 和 API usage 业务键由数据库强制，避免并发写入产生双 current/重复计数。
 */

DO $$
DECLARE
  invalid_latest_count integer;
  duplicate_usage_count integer;
  null_usage_count integer;
BEGIN
  SELECT count(*) INTO invalid_latest_count
  FROM (
    SELECT "parent_id"
    FROM "geo_foundry"."edition_revisions"
    GROUP BY "parent_id"
    HAVING count(*) FILTER (WHERE "latest" IS TRUE) <> 1
  ) broken;
  IF invalid_latest_count <> 0 THEN
    RAISE EXCEPTION 'EDITION_LATEST_INVARIANT_FAILED:%', invalid_latest_count;
  END IF;

  SELECT count(*) INTO duplicate_usage_count
  FROM (
    SELECT "tenant_id", "date", "route", "site_id"
    FROM "geo_foundry"."api_usage_dailies"
    GROUP BY "tenant_id", "date", "route", "site_id"
    HAVING count(*) > 1
  ) duplicated;
  IF duplicate_usage_count <> 0 THEN
    RAISE EXCEPTION 'API_USAGE_DUPLICATE_KEYS:%', duplicate_usage_count;
  END IF;

  SELECT count(*) INTO null_usage_count
  FROM "geo_foundry"."api_usage_dailies"
  WHERE "tenant_id" IS NULL OR "date" IS NULL OR "route" IS NULL OR "site_id" IS NULL;
  IF null_usage_count <> 0 THEN
    RAISE EXCEPTION 'API_USAGE_NULL_KEY:%', null_usage_count;
  END IF;
END
$$;--> statement-breakpoint

DROP INDEX IF EXISTS "geo_foundry"."content_editions_content_modified_at_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "geo_foundry"."edition_revisions_content_modified_at_idx";--> statement-breakpoint

ALTER TABLE "geo_foundry"."content_editions"
  DROP COLUMN "_status";--> statement-breakpoint
ALTER TABLE "geo_foundry"."edition_revisions"
  DROP COLUMN "status";--> statement-breakpoint

DROP TYPE IF EXISTS "geo_foundry"."enum_content_editions_status";--> statement-breakpoint
DROP TYPE IF EXISTS "geo_foundry"."enum_edition_revisions_status";--> statement-breakpoint

UPDATE "geo_foundry"."edition_revisions"
SET "latest" = FALSE
WHERE "latest" IS NULL;--> statement-breakpoint
ALTER TABLE "geo_foundry"."edition_revisions"
  ALTER COLUMN "latest" SET DEFAULT FALSE,
  ALTER COLUMN "latest" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "edition_revisions_one_latest_per_parent_idx"
  ON "geo_foundry"."edition_revisions" ("parent_id")
  WHERE "latest" IS TRUE;--> statement-breakpoint

ALTER TABLE "geo_foundry"."api_usage_dailies"
  ALTER COLUMN "count" SET DEFAULT 0,
  ALTER COLUMN "count" SET NOT NULL,
  ALTER COLUMN "date" SET NOT NULL,
  ALTER COLUMN "route" SET NOT NULL,
  ALTER COLUMN "site_id" SET NOT NULL,
  ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_usage_dailies_site_idx"
  ON "geo_foundry"."api_usage_dailies" ("site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_usage_dailies_tenant_date_route_site_idx"
  ON "geo_foundry"."api_usage_dailies" ("tenant_id", "date", "route", "site_id");
