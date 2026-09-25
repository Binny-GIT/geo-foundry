#!/usr/bin/env bash
# A1：在 mk-dev 应用迁移 0012（psql 单事务 + drizzle 账本行）。
# hash 与 drizzle-orm readMigrationFiles 一致：文件全文 UTF-8 的 sha256。
set -euo pipefail
cd /home/ubuntu/project/Binny-GIT/geo-foundry
FILE=apps/cms/drizzle/0012_edition_sites.sql
HASH=$(sha256sum "$FILE" | cut -d' ' -f1)
WHEN=1788999000012

PSQL() { sudo docker exec pg-server psql -U gpucloud -d geo_foundry -qAt -c "$1"; }

echo "hash=$HASH"
echo "applied_before=$(PSQL 'SELECT count(*) FROM geo_foundry.drizzle_migrations')"

# 单事务：迁移 SQL + 账本行同成败
{
  cat "$FILE"
  echo ""
  echo "INSERT INTO geo_foundry.drizzle_migrations (\"hash\", \"created_at\") VALUES ('$HASH', $WHEN);"
} | sudo docker exec -i pg-server psql -U gpucloud -d geo_foundry -v ON_ERROR_STOP=1 -1 -q

echo "applied_after=$(PSQL 'SELECT count(*) FROM geo_foundry.drizzle_migrations')"
echo "--- 行数与状态分布 ---"
PSQL "SELECT count(*), publish_state FROM geo_foundry.edition_sites GROUP BY publish_state ORDER BY publish_state"
echo "--- published 行抽样 ---"
PSQL "SELECT edition_id, site_id, release_id IS NOT NULL AS has_release, url_record_id IS NOT NULL AS has_url, quality_state, published_at IS NOT NULL AS has_time FROM geo_foundry.edition_sites WHERE publish_state='published' ORDER BY edition_id LIMIT 5"
echo "--- 账本最新行 ---"
PSQL "SELECT id, left(hash,12) AS hash_prefix, created_at FROM geo_foundry.drizzle_migrations ORDER BY created_at DESC LIMIT 1"
echo "APPLY_DONE"
