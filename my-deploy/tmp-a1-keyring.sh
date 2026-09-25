#!/usr/bin/env bash
# A1 补跑：worker 租户密钥环 + 重启 worker + DB 核对。
set -euo pipefail
CRED=/opt/geo-foundry/credentials

cd /home/ubuntu/project/Binny-GIT/geo-foundry
sudo env -i \
  PATH=/home/ubuntu/.n/bin:/usr/bin:/bin \
  GEO_FOUNDRY_CREDENTIALS_DIR="$CRED" \
  GEO_FOUNDRY_PG_HOST=127.0.0.1 GEO_FOUNDRY_PG_PORT=5432 \
  GEO_FOUNDRY_PG_DATABASE=geo_foundry GEO_FOUNDRY_PG_SCHEMA=geo_foundry \
  GEO_FOUNDRY_PG_BOOTSTRAP_DATABASE=postgres \
  GEO_FOUNDRY_PG_USER="$(sudo cat "$CRED/pg-user")" \
  GEO_FOUNDRY_PG_PASSWORD="$(sudo cat "$CRED/pg-password")" \
  GEO_FOUNDRY_CMS_SECRET="$(sudo cat "$CRED/cms-secret")" \
  GEO_FOUNDRY_S3_ACCESS_KEY="$(sudo cat "$CRED/s3-access-key")" \
  GEO_FOUNDRY_S3_SECRET_KEY="$(sudo cat "$CRED/s3-secret-key")" \
  GEO_FOUNDRY_S3_ENDPOINT=127.0.0.1 GEO_FOUNDRY_S3_PORT=9000 \
  GEO_FOUNDRY_S3_USE_SSL=false GEO_FOUNDRY_S3_FORCE_PATH_STYLE=true \
  GEO_FOUNDRY_S3_SECRET_REF=rustfs-geo-foundry-svc \
  ./node_modules/.bin/tsx apps/cms/scripts/provision-worker-keyring.mjs
sudo chown 1001:1001 "$CRED/content-service-keyring.json"
sudo chmod 600 "$CRED/content-service-keyring.json"
echo "keyring provisioned"

sudo docker restart geo-foundry-worker-mk-dev >/dev/null
sleep 8
bash deploy/smoke/worker-smoke.sh || { echo "WORKER_SMOKE_FAILED"; exit 1; }

PSQL() { sudo docker exec pg-server psql -U gpucloud -d geo_foundry -qAt -c "$1"; }
echo "tenant row: $(PSQL "SELECT id||'|'||name FROM geo_foundry.tenants WHERE id=430")"
echo "site row:   $(PSQL "SELECT id||'|'||tenant_id||'|'||name||'|'||locale||'|'||timezone FROM geo_foundry.sites WHERE id=391")"
echo "domains:    $(PSQL "SELECT role||'|'||hostname FROM geo_foundry.domains WHERE site_id=391 ORDER BY role")"
echo "keyring tenants: $(sudo python3 -c "import json;print(','.join(json.load(open('$CRED/content-service-keyring.json'))['tenants']))")"
echo "KEYRING_DONE"
