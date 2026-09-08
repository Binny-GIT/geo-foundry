#!/usr/bin/env bash
# 密码哈希升级 E2E：把测试账号降级为旧 PBKDF2 哈希 → 登录 → 断言同请求内
# 重哈希为 $scrypt$ 前缀 → 新格式二次登录 → 错误密码 401。只动测试账号。
set -uo pipefail
BASE=http://127.0.0.1:3090
TS=$(date +%s)
PASS=(); FAIL=()
ok() { PASS+=("$1"); echo "PASS: $1"; }
bad() { FAIL+=("$1"); echo "FAIL: $1"; }
EDPW="${GF_E2E_EDITOR_PASSWORD:?}"

PSQL() { sudo docker exec pg-server psql -U gpucloud -d geo_foundry -qAt -c "$1"; }
Q() { PSQL "SELECT $1"; }

# 1. 用与 Payload 兼容的参数现算旧哈希并写回测试账号
LEGACY=$(node -e '
const crypto = require("node:crypto")
const salt = crypto.randomBytes(32).toString("hex")
crypto.pbkdf2(process.argv[1], salt, 25000, 512, "sha256", (e, raw) => {
  if (e) throw e
  console.log(salt + "|" + raw.toString("hex"))
})' "$EDPW")
LSALT=${LEGACY%%|*}; LHASH=${LEGACY##*|}
PSQL "UPDATE geo_foundry.users SET salt='$LSALT', hash='$LHASH', login_attempts=0, lock_until=NULL WHERE email='gf-editor-test@geo-foundry.dev'" >/dev/null
FMT=$(Q "substring(hash for 8) FROM geo_foundry.users WHERE email='gf-editor-test@geo-foundry.dev'")
[ "$FMT" != "\$scrypt\$" ] && ok "downgraded to legacy pbkdf2" || bad "downgrade failed fmt=$FMT"

# 2. 旧哈希登录成功 → 同请求重哈希
S=$(curl -s -w '\n%{http_code}' -X POST $BASE/api/users/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"gf-editor-test@geo-foundry.dev\",\"password\":\"$EDPW\"}")
[ "$(echo "$S" | tail -1)" = "200" ] && ok "legacy login 200" || bad "legacy login $(echo "$S"|tail -2)"
HASH=$(Q "hash FROM geo_foundry.users WHERE email='gf-editor-test@geo-foundry.dev'")
case "$HASH" in
  \$scrypt\$*) ok "rehashed to scrypt in same request";;
  *) bad "hash not upgraded: ${HASH:0:20}...";;
esac

# 3. 新格式再次登录成功
S=$(curl -s -w '\n%{http_code}' -X POST $BASE/api/users/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"gf-editor-test@geo-foundry.dev\",\"password\":\"$EDPW\"}")
[ "$(echo "$S" | tail -1)" = "200" ] && ok "scrypt login 200" || bad "scrypt login $(echo "$S"|tail -2)"

# 4. 错误密码 401
S=$(curl -s -w '\n%{http_code}' -X POST $BASE/api/users/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"gf-editor-test@geo-foundry.dev\",\"password\":\"definitely-wrong-$TS\"}")
[ "$(echo "$S" | tail -1)" = "401" ] && ok "wrong password 401" || bad "wrong pw $(echo "$S"|tail -2)"

# 5. 改密走 scrypt：改过去再改回来
J=/tmp/scrypt-e.jar
curl -s -o /dev/null -X POST $BASE/api/users/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"gf-editor-test@geo-foundry.dev\",\"password\":\"$EDPW\"}" -c "$J"
S=$(curl -s -w '\n%{http_code}' -X POST $BASE/api/account/password -b "$J" \
  -H 'Content-Type: application/json' \
  -d "{\"currentPassword\":\"$EDPW\",\"newPassword\":\"tmp-pw-$TS\"}")
[ "$(echo "$S" | tail -1)" = "200" ] && ok "password change 200" || bad "change $(echo "$S"|tail -2)"
HASH2=$(Q "substring(hash for 8) FROM geo_foundry.users WHERE email='gf-editor-test@geo-foundry.dev'")
[ "$HASH2" = "\$scrypt\$" ] && ok "changed hash is scrypt" || bad "changed hash=$HASH2"
curl -s -o /dev/null -X POST $BASE/api/users/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"gf-editor-test@geo-foundry.dev\",\"password\":\"tmp-pw-$TS\"}" -c "$J"
S=$(curl -s -w '\n%{http_code}' -X POST $BASE/api/account/password -b "$J" \
  -H 'Content-Type: application/json' \
  -d "{\"currentPassword\":\"tmp-pw-$TS\",\"newPassword\":\"$EDPW\"}")
[ "$(echo "$S" | tail -1)" = "200" ] && ok "password restored" || bad "restore $(echo "$S"|tail -2)"

echo "PASS=${#PASS[@]} FAIL=${#FAIL[@]}"
[ "${#FAIL[@]}" = "0" ]
