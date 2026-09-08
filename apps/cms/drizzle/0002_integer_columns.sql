/* 语义为整数的列从 numeric 收口为 integer：Drizzle 不再返回字符串，
 * 消费点无需 Number()/String() 强转。小数语义列（sites.quality_thresholds_*、
 * media.focal_x/focal_y、quality_assessments.overall）保持 numeric；
 * outbox_events 整表将由 pg-boss 批次删除，不在本次范围。 */

ALTER TABLE "geo_foundry"."url_records" ALTER COLUMN "status_code" TYPE integer;--> statement-breakpoint
ALTER TABLE "geo_foundry"."url_records" ALTER COLUMN "revision" TYPE integer;--> statement-breakpoint
ALTER TABLE "geo_foundry"."review_comments" ALTER COLUMN "workflow_revision" TYPE integer;--> statement-breakpoint
ALTER TABLE "geo_foundry"."reviewer_edition_decision_idempotency" ALTER COLUMN "replay_count" TYPE integer;--> statement-breakpoint
ALTER TABLE "geo_foundry"."operations" ALTER COLUMN "attempt" TYPE integer;--> statement-breakpoint
ALTER TABLE "geo_foundry"."operations" ALTER COLUMN "revision" TYPE integer;--> statement-breakpoint
ALTER TABLE "geo_foundry"."idempotency_records" ALTER COLUMN "replay_count" TYPE integer;--> statement-breakpoint
ALTER TABLE "geo_foundry"."content_editions" ALTER COLUMN "workflow_revision" TYPE integer;--> statement-breakpoint
ALTER TABLE "geo_foundry"."edition_revisions" ALTER COLUMN "workflow_revision" TYPE integer;--> statement-breakpoint
ALTER TABLE "geo_foundry"."edition_draft_restore_idempotency" ALTER COLUMN "replay_count" TYPE integer;--> statement-breakpoint
ALTER TABLE "geo_foundry"."users" ALTER COLUMN "login_attempts" TYPE integer;--> statement-breakpoint
ALTER TABLE "geo_foundry"."publication_plans" ALTER COLUMN "attempts" TYPE integer;--> statement-breakpoint
ALTER TABLE "geo_foundry"."publication_plans" ALTER COLUMN "revision" TYPE integer;--> statement-breakpoint
ALTER TABLE "geo_foundry"."releases" ALTER COLUMN "revision" TYPE integer;--> statement-breakpoint
ALTER TABLE "geo_foundry"."source_snapshots" ALTER COLUMN "content_length" TYPE integer;--> statement-breakpoint
ALTER TABLE "geo_foundry"."media" ALTER COLUMN "filesize" TYPE integer;--> statement-breakpoint
ALTER TABLE "geo_foundry"."media" ALTER COLUMN "width" TYPE integer;--> statement-breakpoint
ALTER TABLE "geo_foundry"."media" ALTER COLUMN "height" TYPE integer;
