#!/usr/bin/env bash
# A1：应用迁移 0012 并核对回填结果（mk-dev）。
set -euo pipefail
export PATH="/home/ubuntu/.n/bin:$PATH"
cd /home/ubuntu/project/Binny-GIT/geo-foundry
echo "--- 迁移前账本 ---"
sudo docker exec pg-server psql -U gpucloud -d geo_foundry -qAt -c \
  "SELECT count(*) FROM geo_foundry.drizzle_migrations"
pnpm --filter @geo/cms db:migrate 2>&1 | tail -3
echo "--- 迁移后账本 ---"
sudo docker exec pg-server psql -U gpucloud -d geo_foundry -qAt -c \
  "SELECT count(*) FROM geo_foundry.drizzle_migrations"
echo "--- edition_sites 行数与状态分布 ---"
sudo docker exec pg-server psql -U gpucloud -d geo_foundry -qAt -c \
  "SELECT count(*), publish_state FROM geo_foundry.edition_sites GROUP BY publish_state ORDER BY publish_state"
echo "--- published 行抽样（release/URL/质量列是否带上） ---"
sudo docker exec pg-server psql -U gpucloud -d geo_foundry -qAt -c \
  "SELECT edition_id, site_id, release_id IS NOT NULL AS has_release, url_record_id IS NOT NULL AS has_url, quality_state, published_at IS NOT NULL AS has_time
   FROM geo_foundry.edition_sites WHERE publish_state='published' ORDER BY edition_id LIMIT 5"
echo "--- pending 行总数 ---"
sudo docker exec pg-server psql -U gpucloud -d geo_foundry -qAt -c \
  "SELECT count(*) FROM geo_foundry.edition_sites WHERE publish_state='pending'"
echo "MIGRATE_DONE"
