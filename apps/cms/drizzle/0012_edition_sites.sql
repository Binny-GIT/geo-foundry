/* A1 多站交付数据层：edition_sites 把"文章 × 站点"的发布状态记成行。
 * 单站文章行为必须与旧 site_id/sites 数组完全一致（A2 再把读侧切过来）。
 *
 * 回填规则（迁移内一次性完成，ON CONFLICT DO NOTHING 保证幂等）：
 * 每篇文章为 {site_id} ∪ sites[] 各建一行；
 *   - 文章 published 且该站有 active URL → publish_state=published，
 *     带上该站 current release、该站最新评估结论、URL 激活时间；
 *   - 其余 → pending。
 * quality_state 复用 quality_assessments 的枚举（同站最新一条评估的 state）。
 */

CREATE TYPE geo_foundry.enum_edition_sites_publish_state AS ENUM
  ('pending', 'published', 'failed', 'unpublished');

CREATE TABLE IF NOT EXISTS geo_foundry.edition_sites (
  id serial PRIMARY KEY,
  tenant_id integer,
  edition_id integer NOT NULL,
  site_id integer NOT NULL,
  publish_state geo_foundry.enum_edition_sites_publish_state NOT NULL DEFAULT 'pending',
  url_record_id integer,
  release_id varchar,
  quality_state geo_foundry.enum_quality_assessments_state NOT NULL DEFAULT 'pending',
  published_at timestamp(3) with time zone,
  created_at timestamp(3) with time zone NOT NULL DEFAULT now(),
  updated_at timestamp(3) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT edition_sites_edition_site_unique UNIQUE (edition_id, site_id)
);

CREATE INDEX IF NOT EXISTS edition_sites_tenant_idx ON geo_foundry.edition_sites (tenant_id);
CREATE INDEX IF NOT EXISTS edition_sites_site_idx ON geo_foundry.edition_sites (site_id);

INSERT INTO geo_foundry.edition_sites (
  tenant_id,
  edition_id,
  site_id,
  publish_state,
  url_record_id,
  release_id,
  quality_state,
  published_at
)
SELECT
  ce.tenant_id,
  ce.id,
  member.site,
  CASE
    WHEN ce.workflow_status = 'published' AND ur.state = 'active' THEN 'published'
    ELSE 'pending'
  END,
  ur.id,
  CASE
    WHEN ce.workflow_status = 'published' AND ur.state = 'active' THEN
      (SELECT r.release_id
         FROM geo_foundry.releases r
        WHERE r.site_id = member.site AND r.state = 'current'
        ORDER BY r.revision DESC, r.id DESC
        LIMIT 1)
    ELSE NULL
  END,
  COALESCE(
    (SELECT qa.state
       FROM geo_foundry.quality_assessments qa
      WHERE qa.edition_id = ce.id AND qa.site_id = member.site
      ORDER BY qa.id DESC
      LIMIT 1),
    'pending'
  ),
  CASE
    WHEN ce.workflow_status = 'published' AND ur.state = 'active' THEN ur.updated_at
    ELSE NULL
  END
FROM geo_foundry.content_editions ce
CROSS JOIN LATERAL (
  SELECT DISTINCT m.site
  FROM (
    SELECT ce.site_id AS site
    UNION ALL
    SELECT unnest(ce.sites)
  ) m
  WHERE m.site IS NOT NULL
) member
LEFT JOIN (
  SELECT DISTINCT ON (edition_id, site_id) id, edition_id, site_id, state, updated_at
  FROM geo_foundry.url_records
  ORDER BY edition_id, site_id, id
) ur ON ur.edition_id = ce.id AND ur.site_id = member.site
ON CONFLICT ON CONSTRAINT edition_sites_edition_site_unique DO NOTHING;
