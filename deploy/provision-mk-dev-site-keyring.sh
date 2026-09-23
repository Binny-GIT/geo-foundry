#!/usr/bin/env bash
# 交付服务站点密钥 keyring 供给（幂等，可重复运行）。
#
# 与 provision-mk-dev-credentials.sh（一次性初始化凭据目录）不同：站点会随
# 业务新增，keyring 必须能增量刷新。规则：
#   - 数据源是数据库里的 active 站点 × active 域名（每个 hostname 一把 key，
#     与 runtime 按 host 鉴权的路由形态一致，canonical 与 alias 各一把）；
#   - 已有 host 的现存 key 原样保留（滚动轮换期内新旧并存，供给新 host 不
#     会使已分发的旧 key 失效）；
#   - 新 host 生成一把 32 字符随机 key，quotaPerMinute 可经
#     SITE_KEYRING_QUOTA_PER_MINUTE 覆盖（默认 60）。
# 已下线站点（domain/site 转 inactive）的 key 不删除：host 不在路由清单里
# 时请求会在 runtime 层 404，keyring 里的残留条目不可达也不可用；删除属于
# 显式吊销操作，另行处理。
set -euo pipefail

CREDENTIALS_DIR="${GEO_FOUNDRY_CREDENTIALS_DIR:-/opt/geo-foundry/credentials}"
QUOTA_PER_MINUTE="${SITE_KEYRING_QUOTA_PER_MINUTE:-60}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-pg-server}"
DATABASE="${GEO_FOUNDRY_PG_DATABASE:-geo_foundry}"
KEYRING_FILE="$CREDENTIALS_DIR/site-keyring.json"

if [[ "$(id -u)" -ne 0 ]]; then
  printf '%s\n' 'MK_DEV_SITE_KEYRING_ROOT_REQUIRED' >&2
  exit 1
fi
if [[ ! -d "$CREDENTIALS_DIR" ]]; then
  printf '%s\n' 'MK_DEV_CREDENTIAL_DIRECTORY_MISSING' >&2
  exit 1
fi
if ! [[ "$QUOTA_PER_MINUTE" =~ ^[1-9][0-9]*$ ]]; then
  printf '%s\n' 'MK_DEV_SITE_KEYRING_QUOTA_INVALID' >&2
  exit 1
fi

postgres_user="$(sudo docker exec "$POSTGRES_CONTAINER" printenv POSTGRES_USER)"
hosts="$(sudo docker exec "$POSTGRES_CONTAINER" psql -U "$postgres_user" -d "$DATABASE" -qAt -c "
  SELECT d.hostname
  FROM geo_foundry.domains d
  JOIN geo_foundry.sites s ON s.id = d.site_id
  WHERE d.status = 'active' AND s.status = 'active'
  ORDER BY 1;
")"

tmp_file="$(mktemp "$CREDENTIALS_DIR/.site-keyring.XXXXXX")"
cleanup() { rm -f -- "$tmp_file"; }
trap cleanup ERR

# hosts 经环境变量传入：stdin 已留给 Python 程序本体（heredoc）。
HOSTS="$hosts" python3 - "$KEYRING_FILE" "$tmp_file" "$QUOTA_PER_MINUTE" <<'PY'
import json
import os
import secrets
import sys

existing_path, tmp_path = sys.argv[1], sys.argv[2]
quota = int(sys.argv[3])
hosts = sorted({line.strip().lower() for line in os.environ.get("HOSTS", "").splitlines() if line.strip()})

sites = {}
if os.path.exists(existing_path):
    with open(existing_path, encoding="utf-8") as handle:
        try:
            existing = json.load(handle).get("sites", {})
        except json.JSONDecodeError:
            sys.exit("MK_DEV_SITE_KEYRING_INVALID: existing file is not parseable JSON")
    if not isinstance(existing, dict):
        sys.exit("MK_DEV_SITE_KEYRING_INVALID: existing file has unexpected shape")
    for host, entry in existing.items():
        if not isinstance(entry, dict) or not isinstance(entry.get("keys"), list):
            sys.exit(f"MK_DEV_SITE_KEYRING_INVALID: host {host} entry has unexpected shape")
        sites[host] = entry["keys"]

added = 0
for host in hosts:
    if host not in sites:
        sites[host] = [
            {
                "expiresAt": None,
                "key": secrets.token_hex(16),
                "quotaPerMinute": quota,
                "status": "active",
            }
        ]
        added += 1

# sort_keys 保证 diff 稳定；keyring 是只增不减的台账，顺序无需保插入序。
document = {"sites": {host: {"keys": sites[host]} for host in sites}}
with open(tmp_path, "w", encoding="utf-8") as handle:
    json.dump(document, handle, indent=2, sort_keys=True)
    handle.write("\n")
print(f"MK_DEV_SITE_KEYRING_HOSTS total={len(sites)} added={added} preserved={len(sites) - added}")
PY

chown 1001:1001 "$tmp_file"
chmod 600 "$tmp_file"
mv -f "$tmp_file" "$KEYRING_FILE"
trap - ERR
printf '%s\n' 'MK_DEV_SITE_KEYRING_PROVISIONED'
