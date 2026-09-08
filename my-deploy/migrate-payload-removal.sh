#!/usr/bin/env bash
# Payload 移除上线序列（mk-dev 宿主机执行，需 IMAGE_TAG 参数，如 mk-dev-86e5696）：
# 1. 守卫：outbox pending=0、非终态 operation=0；
# 2. 迁移前整库备份（~/mysql_backup）；
# 3. 停 cms/worker 容器（旧镜像仍依赖旧表结构）；
# 4. 宿主机执行 drizzle 迁移（geo-foundry-cms-secure pnpm db:migrate）；
# 5. 对账：表数、核心不变量；
# 6. 切 IMAGE_TAG 并部署新镜像。
set -euo pipefail
TAG="${1:?usage: migrate-payload-removal.sh mk-dev-<sha>}"
PSQL() { sudo docker exec pg-server psql -U gpucloud -d geo_foundry -qAt -c "$1"; }
cd /home/ubuntu/project/Binny-GIT/geo-foundry

echo "== 1. guards"
PENDING=$(PSQL "SELECT count(*) FROM geo_foundry.outbox_events WHERE status='pending'")
NONTERM=$(PSQL "SELECT count(*) FROM geo_foundry.operations WHERE state IN ('queued','running')")
NULLMD=$(PSQL "SELECT count(*) FROM geo_foundry._content_editions_v WHERE version_body_markdown IS NULL")
echo "outbox_pending=$PENDING nonterminal_ops=$NONTERM null_markdown=$NULLMD"
[ "$PENDING" = 0 ] && [ "$NONTERM" = 0 ] && [ "$NULLMD" = 0 ] || { echo "GUARD_FAILED"; exit 1; }
BEFORE_EDITIONS=$(PSQL "SELECT count(*) FROM geo_foundry.content_editions")
BEFORE_LATEST=$(PSQL "SELECT count(*) FROM geo_foundry._content_editions_v WHERE latest")
BEFORE_URLS=$(PSQL "SELECT count(*) FROM geo_foundry.url_records")
BEFORE_URL_ACTIVE=$(PSQL "SELECT count(*) FROM geo_foundry.url_records WHERE state='active'")
BEFORE_PUBLISHED=$(PSQL "SELECT count(*) FROM geo_foundry._content_editions_v WHERE latest AND version_workflow_status='published'")
BEFORE_TOPICS=$(PSQL "SELECT count(*) FROM geo_foundry._content_editions_v_texts WHERE path='version.secondaryTopics' AND text IS NOT NULL")
BEFORE_USERS=$(PSQL "SELECT count(*) FROM geo_foundry.users")

echo "== 2. backup"
STAMP=$(date +%y%m%d-%H%M)
F=~/mysql_backup/$STAMP-mk-dev-geo_foundry-pre-migration.dump
sudo docker exec pg-server pg_dump -U gpucloud -d geo_foundry -Fc -f /tmp/pre-migration.dump
sudo docker cp pg-server:/tmp/pre-migration.dump "$F" && sudo chown ubuntu:ubuntu "$F"
ls -la "$F"

echo "== 3. stop containers"
sudo docker stop geo-foundry-cms-mk-dev geo-foundry-worker-mk-dev

echo "== 4. migrate"
/home/ubuntu/.local/bin/geo-foundry-cms-secure pnpm --filter @geo/cms db:migrate

echo "== 5. reconcile"
TABLES=$(PSQL "SELECT count(*) FROM pg_tables WHERE schemaname='geo_foundry'")
AFTER_EDITIONS=$(PSQL "SELECT count(*) FROM geo_foundry.content_editions")
AFTER_LATEST=$(PSQL "SELECT count(*) FROM geo_foundry.edition_revisions WHERE latest")
AFTER_URLS=$(PSQL "SELECT count(*) FROM geo_foundry.url_records")
AFTER_URL_ACTIVE=$(PSQL "SELECT count(*) FROM geo_foundry.url_records WHERE state='active'")
AFTER_PUBLISHED=$(PSQL "SELECT count(*) FROM geo_foundry.edition_revisions WHERE latest AND workflow_status='published'")
AFTER_TOPICS=$(PSQL "SELECT coalesce(sum(cardinality(secondary_topics)),0) FROM geo_foundry.edition_revisions")
AFTER_USERS=$(PSQL "SELECT count(*) FROM geo_foundry.users")
URL_SITE_MISMATCH=$(PSQL "SELECT count(*) FROM geo_foundry.url_records u JOIN geo_foundry.edition_revisions v ON v.parent_id=u.edition_id AND v.latest WHERE v.site_id<>u.site_id")
APPLIED=$(PSQL "SELECT count(*) FROM geo_foundry.drizzle_migrations")
echo "tables=$TABLES applied_migrations=$APPLIED"
echo "editions $BEFORE_EDITIONS->$AFTER_EDITIONS latest $BEFORE_LATEST->$AFTER_LATEST published $BEFORE_PUBLISHED->$AFTER_PUBLISHED"
echo "urls $BEFORE_URLS->$AFTER_URLS active $BEFORE_URL_ACTIVE->$AFTER_URL_ACTIVE url_site_mismatch=$URL_SITE_MISMATCH"
echo "topics $BEFORE_TOPICS->$AFTER_TOPICS users $BEFORE_USERS->$AFTER_USERS"
if [ "$TABLES" != 26 ] || [ "$APPLIED" != 2 ] || [ "$BEFORE_EDITIONS" != "$AFTER_EDITIONS" ] || [ "$BEFORE_LATEST" != "$AFTER_LATEST" ] \
  || [ "$BEFORE_URLS" != "$AFTER_URLS" ] || [ "$BEFORE_URL_ACTIVE" != "$AFTER_URL_ACTIVE" ] || [ "$BEFORE_PUBLISHED" != "$AFTER_PUBLISHED" ] \
  || [ "$BEFORE_TOPICS" != "$AFTER_TOPICS" ] || [ "$BEFORE_USERS" != "$AFTER_USERS" ] || [ "$URL_SITE_MISMATCH" != 0 ]; then
  echo "RECONCILE_FAILED — 数据库已迁移，回退只能从 $F 整库恢复"; exit 1
fi

echo "== 6. deploy $TAG"
sudo bash -c "sed -i s/^IMAGE_TAG=.*/IMAGE_TAG=$TAG/ /opt/geo-foundry/mk-dev.env && grep ^IMAGE_TAG /opt/geo-foundry/mk-dev.env"
sudo env PATH="$PATH" make deploy-mk-dev
docker ps --filter name=geo-foundry --format '{{.Names}} {{.Image}} {{.Status}}'
echo "MIGRATION_DEPLOY_DONE backup=$F"
