/* pg-boss 同事务入队替代 outbox 后，删除整套 outbox 存储。
 * 前置守卫：无 pending 行才允许应用（切换脚本保证）。 */

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'geo_foundry' AND table_name = 'outbox_events') THEN
    IF (SELECT count(*) FROM geo_foundry.outbox_events WHERE status = 'pending') > 0 THEN
      RAISE EXCEPTION 'OUTBOX_PENDING_ROWS_EXIST';
    END IF;
  END IF;
END
$$;--> statement-breakpoint
DROP TABLE IF EXISTS "geo_foundry"."outbox_events";--> statement-breakpoint
DROP TYPE IF EXISTS "geo_foundry"."enum_outbox_events_type";--> statement-breakpoint
DROP TYPE IF EXISTS "geo_foundry"."enum_outbox_events_aggregate_type";--> statement-breakpoint
DROP TYPE IF EXISTS "geo_foundry"."enum_outbox_events_status";
