-- 合并 contents 到 content_editions：产品已裁定不存在"一个 content 多站点多版本"，
-- content 身份并入文章。url_records 改为按 edition 归属；contents 表与枚举删除。

-- 1) 文章根行直接持有 content 的 topic / intent（历史值只读保留）
ALTER TABLE geo_foundry.content_editions
  ADD COLUMN content_topic varchar,
  ADD COLUMN content_intent varchar;
--> statement-breakpoint
UPDATE geo_foundry.content_editions e SET content_topic = c.topic, content_intent = c.intent
FROM geo_foundry.contents c WHERE c.id = e.content_id;
--> statement-breakpoint

-- 2) url_records.content_id → edition_id：同站点优先、非归档优先、最近更新优先
ALTER TABLE geo_foundry.url_records ADD COLUMN edition_id integer;
--> statement-breakpoint
UPDATE geo_foundry.url_records u SET edition_id = pick.edition_id
FROM (
  SELECT DISTINCT ON (u2.id) u2.id AS url_id, e.id AS edition_id
  FROM geo_foundry.url_records u2
  JOIN geo_foundry.content_editions e ON e.content_id = u2.content_id
  JOIN geo_foundry.edition_revisions v ON v.parent_id = e.id AND v.latest
  ORDER BY u2.id,
    (v.site_id = u2.site_id) DESC,
    (v.workflow_status <> 'archived') DESC,
    v.edition_updated_at DESC NULLS LAST,
    e.id DESC
) pick WHERE pick.url_id = u.id;
--> statement-breakpoint
DO $$
DECLARE missing int;
BEGIN
  SELECT count(*) INTO missing FROM geo_foundry.url_records WHERE edition_id IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION 'CONTENTS_MERGE_GUARD: % url_records without edition mapping', missing;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE geo_foundry.url_records ALTER COLUMN edition_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE geo_foundry.url_records
  ADD CONSTRAINT url_records_edition_id_fk FOREIGN KEY (edition_id)
  REFERENCES geo_foundry.content_editions(id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX url_records_edition_idx ON geo_foundry.url_records USING btree (edition_id);
--> statement-breakpoint
ALTER TABLE geo_foundry.url_records DROP COLUMN content_id;
--> statement-breakpoint

-- 3) 删除 content 外键列与 contents 表
ALTER TABLE geo_foundry.content_editions DROP COLUMN content_id;
--> statement-breakpoint
ALTER TABLE geo_foundry.edition_revisions DROP COLUMN content_id;
--> statement-breakpoint
DROP TABLE geo_foundry.contents CASCADE;
--> statement-breakpoint
DROP TYPE IF EXISTS geo_foundry.enum_contents_created_by;
