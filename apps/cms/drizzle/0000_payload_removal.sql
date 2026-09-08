-- Payload 移除后的第一条结构清理迁移（不可逆；执行前必须已有整库备份）。
-- 1) 删除 36 张 block 子表（正文已是 body_markdown 列）与 6 张 Payload 内部表；
-- 2) 删除 0 行的 sites_texts / users_rels / performance_snapshots；
-- 3) _content_editions_v 改名 edition_revisions 并去掉 version_ 前缀；
-- 4) secondaryTopics / sites 两类 hasMany 附表转为数组列。

-- 守卫：所有版本行都已回填 Markdown，block 子表可以安全删除。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM geo_foundry._content_editions_v WHERE version_body_markdown IS NULL) THEN
    RAISE EXCEPTION 'PAYLOAD_REMOVAL_GUARD: versions without body_markdown exist';
  END IF;
END $$;
--> statement-breakpoint

-- 1) block 子表（叶子先删，再删父表）
DROP TABLE IF EXISTS
  geo_foundry.content_editions_blocks_faq_items,
  geo_foundry.content_editions_blocks_list_items,
  geo_foundry.content_editions_blocks_references_items,
  geo_foundry.content_editions_blocks_table_rows_cells,
  geo_foundry.content_editions_blocks_table_rows,
  geo_foundry.content_editions_blocks_table_columns,
  geo_foundry.content_editions_blocks_callout,
  geo_foundry.content_editions_blocks_code,
  geo_foundry.content_editions_blocks_embed,
  geo_foundry.content_editions_blocks_faq,
  geo_foundry.content_editions_blocks_heading,
  geo_foundry.content_editions_blocks_image,
  geo_foundry.content_editions_blocks_list,
  geo_foundry.content_editions_blocks_paragraph,
  geo_foundry.content_editions_blocks_quote,
  geo_foundry.content_editions_blocks_references,
  geo_foundry.content_editions_blocks_table,
  geo_foundry.content_editions_blocks_video,
  geo_foundry._content_editions_v_blocks_faq_items,
  geo_foundry._content_editions_v_blocks_list_items,
  geo_foundry._content_editions_v_blocks_references_items,
  geo_foundry._content_editions_v_blocks_table_rows_cells,
  geo_foundry._content_editions_v_blocks_table_rows,
  geo_foundry._content_editions_v_blocks_table_columns,
  geo_foundry._content_editions_v_blocks_callout,
  geo_foundry._content_editions_v_blocks_code,
  geo_foundry._content_editions_v_blocks_embed,
  geo_foundry._content_editions_v_blocks_faq,
  geo_foundry._content_editions_v_blocks_heading,
  geo_foundry._content_editions_v_blocks_image,
  geo_foundry._content_editions_v_blocks_list,
  geo_foundry._content_editions_v_blocks_paragraph,
  geo_foundry._content_editions_v_blocks_quote,
  geo_foundry._content_editions_v_blocks_references,
  geo_foundry._content_editions_v_blocks_table,
  geo_foundry._content_editions_v_blocks_video
  CASCADE;
--> statement-breakpoint
DROP TYPE IF EXISTS
  geo_foundry.enum__content_editions_v_blocks_callout_tone,
  geo_foundry.enum__content_editions_v_blocks_heading_level,
  geo_foundry.enum__content_editions_v_blocks_list_style,
  geo_foundry.enum_content_editions_blocks_callout_tone,
  geo_foundry.enum_content_editions_blocks_heading_level,
  geo_foundry.enum_content_editions_blocks_list_style;
--> statement-breakpoint

-- Payload 内部表
DROP TABLE IF EXISTS
  geo_foundry.payload_locked_documents_rels,
  geo_foundry.payload_locked_documents,
  geo_foundry.payload_preferences_rels,
  geo_foundry.payload_preferences,
  geo_foundry.payload_kv,
  geo_foundry.payload_migrations
  CASCADE;
--> statement-breakpoint

-- 2) 零使用表
DROP TABLE IF EXISTS geo_foundry.sites_texts, geo_foundry.users_rels, geo_foundry.performance_snapshots CASCADE;
--> statement-breakpoint

-- 站点策略的 hasMany 文本改为 jsonb 数组列（原 sites_texts 为 0 行）
ALTER TABLE geo_foundry.sites
  ADD COLUMN content_strategy_target_audience jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN content_strategy_expertise jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN content_strategy_preferred_topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN content_strategy_prohibited_topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN content_strategy_content_angles jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE geo_foundry.sites ALTER COLUMN content_strategy_prohibited_expressions SET DEFAULT '[]'::jsonb;
--> statement-breakpoint
UPDATE geo_foundry.sites SET content_strategy_prohibited_expressions = '[]'::jsonb
  WHERE content_strategy_prohibited_expressions IS NULL;
--> statement-breakpoint
ALTER TABLE geo_foundry.sites ALTER COLUMN content_strategy_prohibited_expressions SET NOT NULL;
--> statement-breakpoint

-- 3) 版本表改名与列改名
ALTER TABLE geo_foundry._content_editions_v RENAME TO edition_revisions;
--> statement-breakpoint
ALTER TABLE geo_foundry.edition_revisions RENAME COLUMN version_content_id TO content_id;
--> statement-breakpoint
ALTER TABLE geo_foundry.edition_revisions RENAME COLUMN version_site_id TO site_id;
--> statement-breakpoint
ALTER TABLE geo_foundry.edition_revisions RENAME COLUMN version_tenant_id TO tenant_id;
--> statement-breakpoint
ALTER TABLE geo_foundry.edition_revisions RENAME COLUMN version_owner_id TO owner_id;
--> statement-breakpoint
ALTER TABLE geo_foundry.edition_revisions RENAME COLUMN version_priority TO priority;
--> statement-breakpoint
ALTER TABLE geo_foundry.edition_revisions RENAME COLUMN version_due_at TO due_at;
--> statement-breakpoint
ALTER TABLE geo_foundry.edition_revisions RENAME COLUMN version_editorial_status TO editorial_status;
--> statement-breakpoint
ALTER TABLE geo_foundry.edition_revisions RENAME COLUMN version_angle TO angle;
--> statement-breakpoint
ALTER TABLE geo_foundry.edition_revisions RENAME COLUMN version_title TO title;
--> statement-breakpoint
ALTER TABLE geo_foundry.edition_revisions RENAME COLUMN version_summary TO summary;
--> statement-breakpoint
ALTER TABLE geo_foundry.edition_revisions RENAME COLUMN version_primary_topic TO primary_topic;
--> statement-breakpoint
ALTER TABLE geo_foundry.edition_revisions RENAME COLUMN version_citations TO citations;
--> statement-breakpoint
ALTER TABLE geo_foundry.edition_revisions RENAME COLUMN version_entities TO entities;
--> statement-breakpoint
ALTER TABLE geo_foundry.edition_revisions RENAME COLUMN version_creation_origin TO creation_origin;
--> statement-breakpoint
ALTER TABLE geo_foundry.edition_revisions RENAME COLUMN version_workflow_status TO workflow_status;
--> statement-breakpoint
ALTER TABLE geo_foundry.edition_revisions RENAME COLUMN version_workflow_revision TO workflow_revision;
--> statement-breakpoint
ALTER TABLE geo_foundry.edition_revisions RENAME COLUMN version_compiled_release TO compiled_release;
--> statement-breakpoint
ALTER TABLE geo_foundry.edition_revisions RENAME COLUMN version_audit_log TO audit_log;
--> statement-breakpoint
ALTER TABLE geo_foundry.edition_revisions RENAME COLUMN version_content_modified_at TO content_modified_at;
--> statement-breakpoint
ALTER TABLE geo_foundry.edition_revisions RENAME COLUMN version_body_markdown TO body_markdown;
--> statement-breakpoint
ALTER TABLE geo_foundry.edition_revisions RENAME COLUMN version__status TO status;
--> statement-breakpoint
-- 文章级时间戳副本（DTO 的 updatedAt/createdAt 来源）；行级 created_at/updated_at 保留。
ALTER TABLE geo_foundry.edition_revisions RENAME COLUMN version_updated_at TO edition_updated_at;
--> statement-breakpoint
ALTER TABLE geo_foundry.edition_revisions RENAME COLUMN version_created_at TO edition_created_at;
--> statement-breakpoint
ALTER TYPE geo_foundry.enum__content_editions_v_version_creation_origin RENAME TO enum_edition_revisions_creation_origin;
--> statement-breakpoint
ALTER TYPE geo_foundry.enum__content_editions_v_version_editorial_status RENAME TO enum_edition_revisions_editorial_status;
--> statement-breakpoint
ALTER TYPE geo_foundry.enum__content_editions_v_version_priority RENAME TO enum_edition_revisions_priority;
--> statement-breakpoint
ALTER TYPE geo_foundry.enum__content_editions_v_version_status RENAME TO enum_edition_revisions_status;
--> statement-breakpoint
ALTER TYPE geo_foundry.enum__content_editions_v_version_workflow_status RENAME TO enum_edition_revisions_workflow_status;
--> statement-breakpoint
ALTER INDEX geo_foundry._content_editions_v_pkey RENAME TO edition_revisions_pkey;
--> statement-breakpoint
ALTER INDEX geo_foundry._content_editions_v_created_at_idx RENAME TO edition_revisions_created_at_idx;
--> statement-breakpoint
ALTER INDEX geo_foundry._content_editions_v_latest_idx RENAME TO edition_revisions_latest_idx;
--> statement-breakpoint
ALTER INDEX geo_foundry._content_editions_v_parent_idx RENAME TO edition_revisions_parent_idx;
--> statement-breakpoint
ALTER INDEX geo_foundry._content_editions_v_updated_at_idx RENAME TO edition_revisions_updated_at_idx;
--> statement-breakpoint
ALTER INDEX geo_foundry._content_editions_v_version_content_modified_at_idx RENAME TO edition_revisions_content_modified_at_idx;
--> statement-breakpoint
ALTER INDEX geo_foundry._content_editions_v_version_due_at_idx RENAME TO edition_revisions_due_at_idx;
--> statement-breakpoint
ALTER INDEX geo_foundry._content_editions_v_version_owner_idx RENAME TO edition_revisions_owner_idx;
--> statement-breakpoint
ALTER INDEX geo_foundry._content_editions_v_version_version__status_idx RENAME TO edition_revisions_status_idx;
--> statement-breakpoint
ALTER INDEX geo_foundry._content_editions_v_version_version_content_idx RENAME TO edition_revisions_content_idx;
--> statement-breakpoint
ALTER INDEX geo_foundry._content_editions_v_version_version_created_at_idx RENAME TO edition_revisions_edition_created_at_idx;
--> statement-breakpoint
ALTER INDEX geo_foundry._content_editions_v_version_version_site_idx RENAME TO edition_revisions_site_idx;
--> statement-breakpoint
ALTER INDEX geo_foundry._content_editions_v_version_version_tenant_idx RENAME TO edition_revisions_tenant_idx;
--> statement-breakpoint
ALTER INDEX geo_foundry._content_editions_v_version_version_updated_at_idx RENAME TO edition_revisions_edition_updated_at_idx;
--> statement-breakpoint
ALTER TABLE geo_foundry.edition_revisions RENAME CONSTRAINT _content_editions_v_parent_id_content_editions_id_fk TO edition_revisions_parent_id_fk;
--> statement-breakpoint
ALTER TABLE geo_foundry.edition_revisions RENAME CONSTRAINT _content_editions_v_version_tenant_id_tenants_id_fk TO edition_revisions_tenant_id_fk;
--> statement-breakpoint
ALTER TABLE geo_foundry.edition_revisions RENAME CONSTRAINT _content_editions_v_version_site_id_sites_id_fk TO edition_revisions_site_id_fk;
--> statement-breakpoint
ALTER TABLE geo_foundry.edition_revisions RENAME CONSTRAINT _content_editions_v_version_owner_id_users_id_fk TO edition_revisions_owner_id_fk;
--> statement-breakpoint
ALTER TABLE geo_foundry.edition_revisions RENAME CONSTRAINT _content_editions_v_version_content_id_contents_id_fk TO edition_revisions_content_id_fk;
--> statement-breakpoint
ALTER SEQUENCE geo_foundry._content_editions_v_id_seq RENAME TO edition_revisions_id_seq;
--> statement-breakpoint

-- 4) hasMany 附表 → 数组列
ALTER TABLE geo_foundry.content_editions
  ADD COLUMN secondary_topics text[] NOT NULL DEFAULT '{}',
  ADD COLUMN sites integer[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE geo_foundry.edition_revisions
  ADD COLUMN secondary_topics text[] NOT NULL DEFAULT '{}',
  ADD COLUMN sites integer[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
UPDATE geo_foundry.content_editions e SET secondary_topics = agg.values
FROM (
  SELECT parent_id, array_agg(text ORDER BY "order") AS values
  FROM geo_foundry.content_editions_texts WHERE path = 'secondaryTopics' AND text IS NOT NULL GROUP BY parent_id
) agg WHERE agg.parent_id = e.id;
--> statement-breakpoint
UPDATE geo_foundry.content_editions e SET sites = agg.values
FROM (
  SELECT parent_id, array_agg(sites_id ORDER BY "order") AS values
  FROM geo_foundry.content_editions_rels WHERE path = 'sites' AND sites_id IS NOT NULL GROUP BY parent_id
) agg WHERE agg.parent_id = e.id;
--> statement-breakpoint
UPDATE geo_foundry.edition_revisions v SET secondary_topics = agg.values
FROM (
  SELECT parent_id, array_agg(text ORDER BY "order") AS values
  FROM geo_foundry._content_editions_v_texts WHERE path = 'version.secondaryTopics' AND text IS NOT NULL GROUP BY parent_id
) agg WHERE agg.parent_id = v.id;
--> statement-breakpoint
UPDATE geo_foundry.edition_revisions v SET sites = agg.values
FROM (
  SELECT parent_id, array_agg(sites_id ORDER BY "order") AS values
  FROM geo_foundry._content_editions_v_rels WHERE path = 'version.sites' AND sites_id IS NOT NULL GROUP BY parent_id
) agg WHERE agg.parent_id = v.id;
--> statement-breakpoint

-- 对账：数组元素总数必须等于附表行数
DO $$
DECLARE
  root_texts int; root_rels int; rev_texts int; rev_rels int; a int; b int; c int; d int;
BEGIN
  SELECT count(*) INTO root_texts FROM geo_foundry.content_editions_texts WHERE path='secondaryTopics' AND text IS NOT NULL;
  SELECT count(*) INTO root_rels FROM geo_foundry.content_editions_rels WHERE path='sites' AND sites_id IS NOT NULL;
  SELECT count(*) INTO rev_texts FROM geo_foundry._content_editions_v_texts WHERE path='version.secondaryTopics' AND text IS NOT NULL;
  SELECT count(*) INTO rev_rels FROM geo_foundry._content_editions_v_rels WHERE path='version.sites' AND sites_id IS NOT NULL;
  SELECT coalesce(sum(cardinality(secondary_topics)),0), coalesce(sum(cardinality(sites)),0) INTO a, b FROM geo_foundry.content_editions;
  SELECT coalesce(sum(cardinality(secondary_topics)),0), coalesce(sum(cardinality(sites)),0) INTO c, d FROM geo_foundry.edition_revisions;
  IF a <> root_texts OR b <> root_rels OR c <> rev_texts OR d <> rev_rels THEN
    RAISE EXCEPTION 'PAYLOAD_REMOVAL_GUARD: array backfill mismatch root(%/%,%/%) rev(%/%,%/%)', a, root_texts, b, root_rels, c, rev_texts, d, rev_rels;
  END IF;
END $$;
--> statement-breakpoint
DROP TABLE geo_foundry.content_editions_texts, geo_foundry.content_editions_rels,
  geo_foundry._content_editions_v_texts, geo_foundry._content_editions_v_rels CASCADE;
