#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "create" && "${1:-}" != "cleanup" ]]; then
  printf '%s\n' 'usage: prepare-verify-credentials.sh create|cleanup <directory>' >&2
  exit 64
fi
if [[ -z "${2:-}" || "${2}" != /tmp/geo-foundry-verify-credentials-* ]]; then
  printf '%s\n' 'VERIFY_CREDENTIAL_DIRECTORY_INVALID' >&2
  exit 64
fi

command="$1"
directory="$2"
if [[ "$command" == "cleanup" ]]; then
  sudo -n rm -rf -- "$directory"
  exit 0
fi

sudo -n install -d -m 700 -o 1001 -g 1001 "$directory"
for name in cms-secret content-service-keyring.json pg-password pg-user redis-password s3-access-key s3-secret-key; do
  printf 'verify-placeholder-credential-value-%s-0123456789\n' "$name" |
    sudo -n tee "$directory/$name" >/dev/null
  sudo -n chown 1001:1001 "$directory/$name"
  sudo -n chmod 600 "$directory/$name"
done
