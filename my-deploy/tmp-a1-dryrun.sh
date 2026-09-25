#!/usr/bin/env bash
# A1：服务器 pull + 迁移 0012 回填 dry-run（只读，不落库）。
set -euo pipefail
cd /home/ubuntu/project/Binny-GIT/geo-foundry
git pull --ff-only 2>&1 | tail -1
PSQL() { sudo docker exec pg-server psql -U gpucloud -d geo_foundry -qAt -c "$1"; }

echo "--- 当前已应用迁移账本 ---"
PSQL "SELECT count(*) FROM geo_foundry.drizzle_migrations"

echo "--- dry-run：回填将产生的行数与状态分布 ---"
PSQL "
WITH desired AS (
  SELECT ce.id AS edition_id, ce.workflow_status, m.site
  FROM geo_foundry.content_editions ce
  CROSS JOIN LATERAL (
    SELECT DISTINCT x.site FROM (
      SELECT ce.site_id AS site
      UNION ALL
      SELECT unnest(ce.sites)
    ) x WHERE x.site IS NOT NULL
  ) m
)
SELECT
  count(*) AS rows_total,
  count(*) FILTER (WHERE d.workflow_status = 'published' AND ur.state = 'active') AS published,
  count(*) FILTER (WHERE NOT (d.workflow_status = 'published' AND ur.state = 'active')) AS pending
FROM desired d
LEFT JOIN (
  SELECT DISTINCT ON (edition_id, site_id) id, edition_id, site_id, state
  FROM geo_foundry.url_records
  ORDER BY edition_id, site_id, id
) ur ON ur.edition_id = d.edition_id AND ur.site_id = d.site"

echo "--- sanity：无站点文章（将被跳过） ---"
PSQL "SELECT count(*) FROM geo_foundry.content_editions WHERE site_id IS NULL AND array_length(sites, 1) IS NULL"

echo "--- sanity：url_records 同 (edition,site) 多行（应被 DISTINCT ON 去重） ---"
PSQL "SELECT count(*) FROM (
  SELECT edition_id, site_id FROM geo_foundry.url_records
  GROUP BY edition_id, site_id HAVING count(*) > 1) x"

echo "--- sanity：sites[] 里引用了不存在站点 id 的（无 FK，迁移不会失败，仅提示） ---"
PSQL "SELECT count(*) FROM (
  SELECT DISTINCT s.site
  FROM geo_foundry.content_editions ce, unnest(ce.sites) AS s(site)
  WHERE NOT EXISTS (SELECT 1 FROM geo_foundry.sites st WHERE st.id = s.site)
) x"

echo "--- sanity：published 文章但无 active URL（回填会记 pending） ---"
PSQL "SELECT ce.id, ce.site_id FROM geo_foundry.content_editions ce
WHERE ce.workflow_status = 'published'
  AND NOT EXISTS (SELECT 1 FROM geo_foundry.url_records ur
    WHERE ur.edition_id = ce.id AND ur.site_id = ce.site_id AND ur.state = 'active')
ORDER BY ce.id LIMIT 20"

echo "DRYRUN_DONE"
