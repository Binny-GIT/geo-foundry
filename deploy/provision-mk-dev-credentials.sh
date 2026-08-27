#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${MK_DEV_ENV:-/opt/geo-foundry/mk-dev.env}"
CREDENTIALS_DIR="${GEO_FOUNDRY_CREDENTIALS_DIR:-/opt/geo-foundry/credentials}"
PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
NODE_BIN="${NODE_BIN:-/home/ubuntu/.n/n/versions/node/24.18.0/bin}"

if [[ "$(id -u)" -ne 0 ]]; then
  printf '%s\n' 'MK_DEV_CREDENTIAL_PROVISION_ROOT_REQUIRED' >&2
  exit 1
fi
if [[ ! -r "$ENV_FILE" ]]; then
  printf '%s\n' 'MK_DEV_CREDENTIAL_ENV_MISSING' >&2
  exit 1
fi
if [[ -e "$CREDENTIALS_DIR" ]]; then
  printf '%s\n' 'MK_DEV_CREDENTIAL_DIRECTORY_EXISTS' >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
for variable in GEO_FOUNDRY_PG_USER GEO_FOUNDRY_PG_PASSWORD GEO_FOUNDRY_S3_ACCESS_KEY GEO_FOUNDRY_S3_SECRET_KEY PAYLOAD_SECRET; do
  if [[ -z "${!variable:-}" ]]; then
    printf '%s\n' "MK_DEV_CREDENTIAL_SOURCE_MISSING:${variable}" >&2
    exit 1
  fi
done

install -d -m 700 -o 1001 -g 1001 "$CREDENTIALS_DIR"
cleanup() {
  rm -rf -- "$CREDENTIALS_DIR"
}
trap cleanup ERR

write_credential() {
  local destination="$1" value="$2"
  printf '%s\n' "$value" > "$CREDENTIALS_DIR/$destination"
  chown 1001:1001 "$CREDENTIALS_DIR/$destination"
  chmod 600 "$CREDENTIALS_DIR/$destination"
}

write_credential pg-user "$GEO_FOUNDRY_PG_USER"
write_credential pg-password "$GEO_FOUNDRY_PG_PASSWORD"
write_credential s3-access-key "$GEO_FOUNDRY_S3_ACCESS_KEY"
write_credential s3-secret-key "$GEO_FOUNDRY_S3_SECRET_KEY"
write_credential cms-secret "$PAYLOAD_SECRET"

redis_password="$(sed -n 's/^requirepass[[:space:]]\+//p' /home/ubuntu/my-docker-service/redis/redis.conf)"
if [[ -z "$redis_password" ]]; then
  printf '%s\n' 'MK_DEV_REDIS_PASSWORD_SOURCE_MISSING' >&2
  exit 1
fi
write_credential redis-password "$redis_password"

export GEO_FOUNDRY_CREDENTIALS_DIR="$CREDENTIALS_DIR"
export GEO_FOUNDRY_PG_HOST="127.0.0.1"
export GEO_FOUNDRY_PG_BOOTSTRAP_DATABASE="${GEO_FOUNDRY_PG_BOOTSTRAP_DATABASE:-postgres}"
export GEO_FOUNDRY_PG_DATABASE="${GEO_FOUNDRY_PG_DATABASE:-geo_foundry}"
export GEO_FOUNDRY_PG_PORT="${GEO_FOUNDRY_PG_PORT:-5432}"
export GEO_FOUNDRY_PG_SCHEMA="${GEO_FOUNDRY_PG_SCHEMA:-geo_foundry}"
export GEO_FOUNDRY_S3_FORCE_PATH_STYLE="${GEO_FOUNDRY_S3_FORCE_PATH_STYLE:-true}"
export GEO_FOUNDRY_S3_PORT="${GEO_FOUNDRY_S3_PORT:-9000}"
export GEO_FOUNDRY_S3_SECRET_REF="${GEO_FOUNDRY_S3_SECRET_REF:-rustfs-geo-foundry-svc}"
export GEO_FOUNDRY_S3_USE_SSL="${GEO_FOUNDRY_S3_USE_SSL:-false}"
export PATH="$NODE_BIN:$PATH"
cd "$PROJECT_DIR"
./node_modules/.bin/tsx apps/cms/scripts/provision-worker-keyring.mjs
chown 1001:1001 "$CREDENTIALS_DIR/content-service-keyring.json"
chmod 600 "$CREDENTIALS_DIR/content-service-keyring.json"

sed -i \
  -e '/^GEO_FOUNDRY_CREDENTIALS_DIR=/d' \
  -e '/^GEO_FOUNDRY_PG_USER=/d' \
  -e '/^GEO_FOUNDRY_PG_PASSWORD=/d' \
  -e '/^GEO_FOUNDRY_S3_ACCESS_KEY=/d' \
  -e '/^GEO_FOUNDRY_S3_SECRET_KEY=/d' \
  -e '/^PAYLOAD_SECRET=/d' \
  "$ENV_FILE"
printf '\nGEO_FOUNDRY_CREDENTIALS_DIR=%s\n' "$CREDENTIALS_DIR" >> "$ENV_FILE"
chmod 600 "$ENV_FILE"
trap - ERR
printf '%s\n' 'MK_DEV_CREDENTIALS_PROVISIONED'
