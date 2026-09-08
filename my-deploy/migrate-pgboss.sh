#!/usr/bin/env bash
# pg-boss 切换序列（mk-dev）：守卫 → 备份 → geo_worker 角色 → 停容器 →
# 构建新镜像 → pgboss provision（建 schema/队列/授权）→ 部署 → 应用 0003 → 验证。
# 回退边界：0003 应用前可回滚镜像恢复 BullMQ 路径；之后回滚需恢复备份。
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$PWD"
PROJECT_DIR="$HOME/project/Binny-GIT/geo-foundry"
PG="sudo docker exec pg-server psql -U gpucloud -d geo_foundry -qAt"
STAMP=$(date +%y%m%d-%H%M)

echo "== 1. 守卫"
PENDING=$($PG -c "SELECT count(*) FROM geo_foundry.outbox_events WHERE status='pending'")
NONTERM=$($PG -c "SELECT count(*) FROM geo_foundry.operations WHERE state IN ('queued','running')")
RUNNING_PLANS=$($PG -c "SELECT count(*) FROM geo_foundry.publication_plans WHERE status='running'")
[ "$PENDING" = "0" ] && [ "$NONTERM" = "0" ] && [ "$RUNNING_PLANS" = "0" ] \
  || { echo "GUARD_FAILED pending=$PENDING nonterm=$NONTERM running_plans=$RUNNING_PLANS"; exit 1; }
echo "guards ok (pending=0 nonterm=0 plans=0)"

echo "== 2. 整库备份"
sudo docker exec pg-server pg_dump -U gpucloud -d geo_foundry | gzip > "$HOME/mysql_backup/$STAMP-mk-dev-geo_foundry-pre-pgboss.sql.gz"
ls -la "$HOME/mysql_backup/$STAMP-mk-dev-geo_foundry-pre-pgboss.sql.gz"

echo "== 3. geo_worker 受限角色 + worker-pg-url 凭据"
WPW="$(head -c 32 /dev/urandom | base64 | tr -d '=+/' | head -c 32)"
sudo docker exec pg-server psql -U gpucloud -d postgres -q <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geo_worker') THEN
    CREATE ROLE geo_worker LOGIN PASSWORD '$WPW';
  ELSE
    ALTER ROLE geo_worker LOGIN PASSWORD '$WPW';
  END IF;
END \$\$;
SQL
printf '%s\n' "postgres://geo_worker:$WPW@host.docker.internal:5432/geo_foundry" | sudo tee /opt/geo-foundry/credentials/worker-pg-url >/dev/null
sudo chown 1001:1001 /opt/geo-foundry/credentials/worker-pg-url
sudo chmod 600 /opt/geo-foundry/credentials/worker-pg-url
echo "worker-pg-url written"

echo "== 4. 停旧容器（CMS+Worker 同批切换，协议不兼容不能混跑）"
cd "$PROJECT_DIR/deploy" 2>/dev/null || cd "$REPO/deploy"
sudo docker stop geo-foundry-worker-mk-dev geo-foundry-cms-mk-dev >/dev/null 2>&1 || true

echo "== 5. 拉取并构建新镜像"
cd "$PROJECT_DIR"
git pull -q
make image-build 2>&1 | tail -1

echo "== 6. pgboss provision（建 schema/队列 + 授权 geo_worker）"
cd apps/cms
GEO_FOUNDRY_PG_SECRET_REF=pg-server-mk-dev-existing-auth GEO_FOUNDRY_S3_SECRET_REF=rustfs-geo-foundry-svc \
  /home/ubuntu/.local/bin/geo-foundry-cms-secure env PATH=/home/ubuntu/.n/n/versions/node/24.18.0/bin:$PATH \
  pnpm --filter @geo/cms pgboss:provision 2>&1 | tail -2

echo "== 7. 部署新镜像"
SHA=$(git rev-parse --short HEAD)
sudo sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=mk-dev-$SHA/" /opt/geo-foundry/mk-dev.env
sudo env PATH="$PATH" make deploy-mk-dev 2>&1 | tail -4
sudo docker ps --format '{{.Names}} {{.Image}}' | grep geo-foundry

echo "== 8. 应用 0003（drop outbox；回退边界）"
cd apps/cms
GEO_FOUNDRY_PG_SECRET_REF=pg-server-mk-dev-existing-auth GEO_FOUNDRY_S3_SECRET_REF=rustfs-geo-foundry-svc \
  /home/ubuntu/.local/bin/geo-foundry-cms-secure env PATH=/home/ubuntu/.n/n/versions/node/24.18.0/bin:$PATH \
  pnpm --filter @geo/cms db:migrate 2>&1 | tail -1
$PG -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='geo_foundry' AND table_name='outbox_events'"
$PG -c "SELECT count(*) FROM pgboss.queue"

echo "== 切换完成。手动步骤：8 套 E2E + worker-business-smoke；24h 后移除 redis-server 容器。"
