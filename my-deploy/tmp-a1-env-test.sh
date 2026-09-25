#!/usr/bin/env bash
# 验证 /tmp/gf-e2e.env 五个密码都能登录（一次性，不入库）
set -euo pipefail
set -a
. /tmp/gf-e2e.env
set +a

login() { # email var
  local email=$1 var=$2 code
  code=$(curl -s -o /tmp/env-test.json -w '%{http_code}' \
    -X POST http://127.0.0.1:3090/api/users/login \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"${!var}\"}")
  if [ "$code" = "200" ] || [ "$code" = "201" ]; then
    echo "$var login=$code OK"
  else
    echo "$var login=$code FAIL body=$(cat /tmp/env-test.json)"
  fi
}

login gf-editor-test@geo-foundry.dev GF_E2E_EDITOR_PASSWORD
login gf-root-test@geo-foundry.dev GF_E2E_ROOT_PASSWORD
login e2e-scheduled-publisher@geo-foundry.test GF_E2E_PUBLISHER_PASSWORD
login embed-tenant-admin@geo-foundry.test GF_E2E_TENANT_ADMIN_PASSWORD
login nkmed-tenant-admin@geo-foundry.test GF_E2E_NKMED_TENANT_ADMIN_PASSWORD
echo "ENV_TEST_DONE"
