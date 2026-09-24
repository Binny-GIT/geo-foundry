#!/usr/bin/env bash
# A3 同站标题门禁 E2E（第一期计划验收场景）：
#  "文章 X 发在 A、B 两站，另一篇与 X 同标题的文章要发到 B 站时，被同站标题门禁拦下。"
#  站点：A=375（真实站，有 canonical 域名），B/C=一次性夹具站（租户 413，各带
#  canonical 域名）；X 成员 {A,B}，Y 成员 {B,C}，Y.title == X.title，正文完全不同。
#  真实评估操作（真实 worker 消费 pgboss，不经模拟）：
#   1. X 评估：(X,A)/(X,B) 评估各落一行 passed，edition_sites.quality_state
#      按站写入，标题向量按成员站各落一行（含 B）；
#   2. Y 评估：(Y,B)=failed 且 issue 码 SEMANTIC_SAME_SITE_TITLE_DUPLICATE
#      （同站 B 命中 X 的标题向量，相似度 1.0 ≥ 同站标题阻断阈值），
#      (Y,C)=passed 且无该码（X 不是 C 成员，C 下无同站标题向量）；
#   3. Y 发布扇出：B 站操作在编译门禁 COMPILER_ASSESSMENT_NOT_PASSED 终态失败，
#      C 站操作成功，文章由首站成功推进 published，B 站行保持 pending。
#  前提：mk-dev worker 的 AI provider 为 fake（确定性向量 + fixture 分数，
#  同文本向量相似度恰为 1.0、不同文本近似 0）；真实 embedding 模型同样
#  文本确定，同标题场景同样成立，本脚本不依赖具体 model id。
#  收尾：Y 回 draft 后 archived、X 直接 archived、删 X/Y 的评估/向量行与
#  夹具站依赖行（外键安全顺序，id+name 双校验）。
#  在 mk-dev 宿主机运行；需要 GF_E2E_EDITOR_PASSWORD / GF_E2E_ROOT_PASSWORD /
#  GF_E2E_PUBLISHER_PASSWORD。
set -uo pipefail
BASE=http://127.0.0.1:3090
SITE_A=375
TENANT=413
TS=$(date +%s)
TITLE="E2E A3 同站标题 $TS"
PASS=(); FAIL=()
ok() { PASS+=("$1"); echo "PASS: $1"; }
bad() { FAIL+=("$1"); echo "FAIL: $1"; }
EDPW="${GF_E2E_EDITOR_PASSWORD:?}"
RTPW="${GF_E2E_ROOT_PASSWORD:?}"
PBPW="${GF_E2E_PUBLISHER_PASSWORD:?}"

PSQL() { sudo docker exec pg-server psql -U gpucloud -d geo_foundry -qAt -c "$1"; }
Q() { PSQL "SELECT $1"; }

login() { curl -s -X POST $BASE/api/users/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"$2\"}" -c "$3" -o /dev/null; }
login gf-editor-test@geo-foundry.dev "$EDPW" /tmp/tg-e.jar
login gf-root-test@geo-foundry.dev "$RTPW" /tmp/tg-r.jar
login e2e-scheduled-publisher@geo-foundry.test "$PBPW" /tmp/tg-p.jar
echo "logins ok"
SKEY=$(sudo python3 -c 'import json;print(json.load(open("/opt/geo-foundry/credentials/content-service-keyring.json"))["tenants"]["413"])')
auth() { echo "Authorization: users API-Key $SKEY"; }

st_of() { echo "$1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["workflowStatus"])'; }
rev_of() { echo "$1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["workflowRevision"])'; }
draft() { curl -s -b /tmp/tg-e.jar "$BASE/api/content-editions/$1?draft=true&depth=0"; }

qa_state() { Q "state FROM geo_foundry.quality_assessments WHERE edition_id=$1 AND site_id=$2 ORDER BY created_at DESC LIMIT 1"; }
qa_has_code() { Q "count(*) FROM geo_foundry.quality_assessments WHERE edition_id=$1 AND site_id=$2 AND state='failed' AND issues::text LIKE '%$3'"; }
es_qstate() { Q "quality_state FROM geo_foundry.edition_sites WHERE edition_id=$1 AND site_id=$2"; }
embed_title_count() { Q "count(*) FROM geo_foundry.embeddings WHERE edition_id=$1 AND site_id=$2 AND scope='title'"; }
op_state() { Q "state FROM geo_foundry.operations WHERE operation_id='$1'"; }
op_err_code() { Q "coalesce(error->>'code','') FROM geo_foundry.operations WHERE operation_id='$1'"; }
wait_op() { # opId -> 终态（最长 120s）
  local S=""
  for i in $(seq 1 40); do
    S=$(op_state "$1")
    { [ "$S" = "succeeded" ] || [ "$S" = "failed" ]; } && break
    sleep 3
  done
  echo "$S"
}
run_evaluation() { # editionId tag -> operationId（editor 提交真实评估操作）
  local ED="$1" TAG="$2" RESP
  RESP=$(curl -s -X POST "$BASE/api/workspaces/editor/editions/$ED/evaluation-operations" -b /tmp/tg-e.jar \
    -H 'Content-Type: application/json' -H "x-request-id: $TAG-$TS" -H "idempotency-key: $TAG-$TS" -d '{}')
  echo "$RESP" | python3 -c 'import json,sys;print(json.load(sys.stdin)["operation"]["operationId"])' 2>/dev/null
}

SITE_B=""
SITE_C=""
ED_X=""
ED_Y=""
purge_fixture_site() { # 仅按 id + name 双校验清除，外键安全顺序
  local S="$1" N="$2"
  [ -n "$S" ] || return 0
  PSQL "DELETE FROM geo_foundry.quality_assessments WHERE site_id=$S" >/dev/null
  PSQL "DELETE FROM geo_foundry.embeddings WHERE site_id=$S" >/dev/null
  PSQL "DELETE FROM geo_foundry.site_event_deliveries WHERE site_id=$S" >/dev/null
  PSQL "DELETE FROM geo_foundry.url_records WHERE site_id=$S" >/dev/null
  PSQL "DELETE FROM geo_foundry.edition_sites WHERE site_id=$S" >/dev/null
  PSQL "DELETE FROM geo_foundry.operations WHERE site_id=$S" >/dev/null
  PSQL "DELETE FROM geo_foundry.releases WHERE site_id=$S" >/dev/null
  PSQL "DELETE FROM geo_foundry.domains WHERE site_id=$S" >/dev/null
  PSQL "DELETE FROM geo_foundry.sites WHERE id=$S AND name='$N'" >/dev/null
}
cleanup() {
  purge_fixture_site "$SITE_B" 'E2E A3 GateB'
  purge_fixture_site "$SITE_C" 'E2E A3 GateC'
}
trap cleanup EXIT

# ---------- 0. 前提与幂等预清理 ----------
DOMAIN=$(Q "hostname FROM geo_foundry.domains WHERE site_id=$SITE_A AND role='canonical' AND status='active' LIMIT 1")
[ -n "$DOMAIN" ] && ok "site $SITE_A canonical domain=$DOMAIN" || { bad "site $SITE_A 无 canonical 域名"; exit 1; }

# 历史夹具无法证明归属时必须中止。
OLD_FIXTURES=$(PSQL "SELECT id FROM geo_foundry.sites WHERE name IN ('E2E A3 GateB','E2E A3 GateC')")
[ -z "$OLD_FIXTURES" ] || { bad "old fixture sites need manual review: $OLD_FIXTURES"; exit 1; }

# 上次中断残留（同标题模式且未归档）：published 先 dfp 回 draft，再归档。
STALE=$(Q "ce.id||' '||ev.workflow_status FROM geo_foundry.content_editions ce
  JOIN geo_foundry.edition_revisions ev ON ev.parent_id=ce.id AND ev.latest
  WHERE ce.title LIKE 'E2E A3 同站标题 %' AND ev.workflow_status <> 'archived' ORDER BY ce.id")
while read -r SID SST; do
  [ -n "$SID" ] || continue
  if [ "$SST" = "published" ]; then
    curl -s -o /dev/null -X POST "$BASE/api/editions/$SID/draft-from-published" -b /tmp/tg-e.jar \
      -H 'Content-Type: application/json' -d '{"reason":"E2E A3 预清理"}'
  fi
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/editions/$SID/workflow-transitions" -b /tmp/tg-e.jar \
    -H 'Content-Type: application/json' -d '{"target":"archived","reason":"E2E A3 预清理"}')
  [ "$CODE" = "200" ] && ok "stale edition $SID ($SST) archived" || bad "stale $SID archive code=$CODE"
done <<< "$STALE"

# ---------- 1. 夹具站 B / C（各带 canonical 域名） ----------
SITE_B=$(PSQL "INSERT INTO geo_foundry.sites (name, tenant_id, locale, timezone, status)
  VALUES ('E2E A3 GateB', $TENANT, 'en-US', 'UTC', 'active') RETURNING id")
[ -n "$SITE_B" ] && ok "fixture site B created (id=$SITE_B)" || { bad "site B create"; exit 1; }
PSQL "INSERT INTO geo_foundry.domains (hostname, site_id, tenant_id, role, status)
  VALUES ('e2e-a3-b-$TS.test', $SITE_B, $TENANT, 'canonical', 'active')" >/dev/null
SITE_C=$(PSQL "INSERT INTO geo_foundry.sites (name, tenant_id, locale, timezone, status)
  VALUES ('E2E A3 GateC', $TENANT, 'en-US', 'UTC', 'active') RETURNING id")
[ -n "$SITE_C" ] && ok "fixture site C created (id=$SITE_C)" || { bad "site C create"; exit 1; }
PSQL "INSERT INTO geo_foundry.domains (hostname, site_id, tenant_id, role, status)
  VALUES ('e2e-a3-c-$TS.test', $SITE_C, $TENANT, 'canonical', 'active')" >/dev/null

# ---------- 2. X（成员 A、B）：真实评估操作 → 两站各 passed ----------
# 真实评估管道把 summary 填入 ArticlePage 的 metadata/seo description 并过严格
# schema（min 1）：夹具文章必须带非空 summary，否则评估操作在 draftDocumentOf 失败。
BODY_X="A3 同站标题门禁验证正文 X。这篇文章发布在 A、B 两个站点，真实评估操作完成后，标题与正文向量按成员站分别落库，按站的评估结论分别写入文章×站点行。当另一篇与它标题完全相同、成员包含 B 站的文章 Y 参与评估时，同站标题相似度门禁必须在 B 站拦下 Y，且 Y 的 B 站发布操作随后在编译门禁终态失败。本文正文与 Y 的正文完全不同，两者正文向量相似度很低，跨域与同站内容检查都不会命中任何区间。门禁行为只依赖标题文本相同，与正文内容无关；本段补足正文长度，满足确定性结构规则的最少字符数要求，让评估结论只含被测的语义层问题。"
SUM_X="A3 同站标题门禁验证摘要 X：发布在 A、B 两站，评估结论按成员站各落一行。"
CX=$(python3 -c 'import json,sys;print(json.dumps({"title":sys.argv[1],"bodyMarkdown":sys.argv[2],"summary":sys.argv[3],"site":int(sys.argv[4]),"sites":[int(sys.argv[5])]},ensure_ascii=False))' \
  "$TITLE" "$BODY_X" "$SUM_X" "$SITE_A" "$SITE_B" | \
  curl -s -X POST "$BASE/api/content-editions?draft=true&depth=0" -b /tmp/tg-e.jar \
    -H 'Content-Type: application/json' -d @-)
ED_X=$(echo "$CX" | python3 -c 'import json,sys;print(json.load(sys.stdin)["doc"]["id"])')
[ -n "$ED_X" ] && ok "X draft created (edition=$ED_X, members=$SITE_A,$SITE_B)" || { bad "create X $CX"; exit 1; }

curl -s -o /dev/null -X POST "$BASE/api/editions/$ED_X/workflow-transitions" -b /tmp/tg-e.jar \
  -H 'Content-Type: application/json' -d '{"target":"review"}'
OP_X=$(run_evaluation "$ED_X" a3-evalx)
[ -n "$OP_X" ] && ok "X evaluation op created (op=$OP_X)" || { bad "eval op X"; exit 1; }
STX=$(wait_op "$OP_X")
[ "$STX" = "succeeded" ] && ok "X evaluation op succeeded" \
  || { bad "X eval state=$STX err=$(op_err_code "$OP_X")"; exit 1; }

# worker 回填的按站扇出结果：两个成员站各一条、各 passed
PERX=$(Q "result->'perSite' FROM geo_foundry.operations WHERE operation_id='$OP_X'")
echo "$PERX" | TG_A="$SITE_A" TG_B="$SITE_B" python3 -c '
import json,sys,os
per=json.load(sys.stdin)
want={int(os.environ["TG_A"]), int(os.environ["TG_B"])}
assert {p["siteId"] for p in per}==want, per
assert all(p["state"]=="passed" for p in per), per' \
  && ok "X perSite fanout: 2 sites, all passed" || bad "X perSite=$PERX"

[ "$(qa_state "$ED_X" "$SITE_A")" = "passed" ] && ok "assessment (X,A) passed" \
  || bad "X A state=$(qa_state "$ED_X" "$SITE_A")"
[ "$(qa_state "$ED_X" "$SITE_B")" = "passed" ] && ok "assessment (X,B) passed" \
  || bad "X B state=$(qa_state "$ED_X" "$SITE_B")"
[ "$(es_qstate "$ED_X" "$SITE_A")" = "passed" ] && [ "$(es_qstate "$ED_X" "$SITE_B")" = "passed" ] \
  && ok "edition_sites.quality_state (X) A/B=passed" \
  || bad "quality_state X A=$(es_qstate "$ED_X" "$SITE_A") B=$(es_qstate "$ED_X" "$SITE_B")"
[ "$(embed_title_count "$ED_X" "$SITE_A")" = "1" ] && [ "$(embed_title_count "$ED_X" "$SITE_B")" = "1" ] \
  && ok "X title embedding landed per member site (A, B)" \
  || bad "X title embed A=$(embed_title_count "$ED_X" "$SITE_A") B=$(embed_title_count "$ED_X" "$SITE_B")"

RX=$(rev_of "$(draft "$ED_X")")
AX=$(curl -s -X POST "$BASE/api/workspaces/reviewer/editions/$ED_X/approve" -b /tmp/tg-r.jar \
  -H 'Content-Type: application/json' -H "x-request-id: a3-a-x-$TS" -H "idempotency-key: a3-approve-x-$TS" \
  -d "{\"expectedRevision\":$RX}")
[ "$(st_of "$AX")" = "approved" ] && ok "X approved (stays on A/B, not published)" || bad "X approve $AX"
# URL 预留发生在审批时（A2 语义），此时两成员站应各有一行 reserved。
RESV_X=$(Q "count(*) FROM geo_foundry.url_records WHERE edition_id=$ED_X AND state='reserved'")
[ "$RESV_X" = "2" ] && ok "X URL reserved for both member sites (after approve)" || bad "X reserved urls=$RESV_X"

# ---------- 3. Y（成员 B、C，标题与 X 完全相同）：B 站被拦、C 站通过 ----------
BODY_Y="A3 同站标题门禁验证正文 Y。本文标题与文章 X 完全相同，但成员站点是 B 与 C，正文内容则与 X 完全不同。评估时同站标题相似度门禁应命中 X 落在 B 站的标题向量：B 站结论 failed 并携带同站标题重复问题码；C 站不是 X 的成员，C 下没有同站标题向量，C 站结论应 passed。本文同时验证按站结论互不牵连：同一篇文章在不同站点得到不同状态，发布扇出时 B 站操作失败、C 站操作成功。本段补足正文长度，满足确定性结构规则的最少字符数要求，并让两文正文向量相似度保持低位，不触发任何跨域或同站内容区间。"
SUM_Y="A3 同站标题门禁验证摘要 Y：与 X 同标题，成员为 B、C，正文完全不同。"
CY=$(python3 -c 'import json,sys;print(json.dumps({"title":sys.argv[1],"bodyMarkdown":sys.argv[2],"summary":sys.argv[3],"site":int(sys.argv[4]),"sites":[int(sys.argv[5])]},ensure_ascii=False))' \
  "$TITLE" "$BODY_Y" "$SUM_Y" "$SITE_B" "$SITE_C" | \
  curl -s -X POST "$BASE/api/content-editions?draft=true&depth=0" -b /tmp/tg-e.jar \
    -H 'Content-Type: application/json' -d @-)
ED_Y=$(echo "$CY" | python3 -c 'import json,sys;print(json.load(sys.stdin)["doc"]["id"])')
[ -n "$ED_Y" ] && ok "Y draft created (edition=$ED_Y, members=$SITE_B,$SITE_C, same title as X)" || { bad "create Y $CY"; exit 1; }

curl -s -o /dev/null -X POST "$BASE/api/editions/$ED_Y/workflow-transitions" -b /tmp/tg-e.jar \
  -H 'Content-Type: application/json' -d '{"target":"review"}'
OP_Y=$(run_evaluation "$ED_Y" a3-evaly)
[ -n "$OP_Y" ] && ok "Y evaluation op created (op=$OP_Y)" || { bad "eval op Y"; exit 1; }
STY_OP=$(wait_op "$OP_Y")
[ "$STY_OP" = "succeeded" ] && ok "Y evaluation op succeeded (per-site conclusions recorded)" \
  || { bad "Y eval state=$STY_OP err=$(op_err_code "$OP_Y")"; exit 1; }

PERY=$(Q "result->'perSite' FROM geo_foundry.operations WHERE operation_id='$OP_Y'")
echo "$PERY" | TG_B="$SITE_B" TG_C="$SITE_C" python3 -c '
import json,sys,os
per=json.load(sys.stdin)
b=[p for p in per if p["siteId"]==int(os.environ["TG_B"])][0]
c=[p for p in per if p["siteId"]==int(os.environ["TG_C"])][0]
assert b["state"]=="failed", per
assert c["state"]=="passed", per' \
  && ok "Y perSite fanout: B=failed, C=passed" || bad "Y perSite=$PERY"

YB=$(qa_state "$ED_Y" "$SITE_B"); YC=$(qa_state "$ED_Y" "$SITE_C")
[ "$YB" = "failed" ] && [ "$(qa_has_code "$ED_Y" "$SITE_B" SEMANTIC_SAME_SITE_TITLE_DUPLICATE)" = "1" ] \
  && ok "Y site B: failed with SEMANTIC_SAME_SITE_TITLE_DUPLICATE (hit X's same-site title)" \
  || bad "Y B state=$YB codeCount=$(qa_has_code "$ED_Y" "$SITE_B" SEMANTIC_SAME_SITE_TITLE_DUPLICATE)"
[ "$YC" = "passed" ] && [ "$(qa_has_code "$ED_Y" "$SITE_C" SEMANTIC_SAME_SITE_TITLE_DUPLICATE)" = "0" ] \
  && ok "Y site C: passed, no same-site-title code (X not a C member)" \
  || bad "Y C state=$YC codeCount=$(qa_has_code "$ED_Y" "$SITE_C" SEMANTIC_SAME_SITE_TITLE_DUPLICATE)"
[ "$(es_qstate "$ED_Y" "$SITE_B")" = "failed" ] && [ "$(es_qstate "$ED_Y" "$SITE_C")" = "passed" ] \
  && ok "edition_sites.quality_state (Y) B=failed, C=passed" \
  || bad "quality_state Y B=$(es_qstate "$ED_Y" "$SITE_B") C=$(es_qstate "$ED_Y" "$SITE_C")"
[ "$(embed_title_count "$ED_Y" "$SITE_B")" = "1" ] && [ "$(embed_title_count "$ED_Y" "$SITE_C")" = "1" ] \
  && ok "Y title embedding landed per member site (B, C)" \
  || bad "Y title embed B=$(embed_title_count "$ED_Y" "$SITE_B") C=$(embed_title_count "$ED_Y" "$SITE_C")"

RY=$(rev_of "$(draft "$ED_Y")")
AY=$(curl -s -X POST "$BASE/api/workspaces/reviewer/editions/$ED_Y/approve" -b /tmp/tg-r.jar \
  -H 'Content-Type: application/json' -H "x-request-id: a3-a-y-$TS" -H "idempotency-key: a3-approve-y-$TS" \
  -d "{\"expectedRevision\":$RY}")
[ "$(st_of "$AY")" = "approved" ] && ok "Y approved (quality state does not block approval)" || bad "Y approve $AY"

# ---------- 4. Y 发布扇出：B 站被编译门禁拦下，C 站成功 ----------
PY=$(curl -s -X POST "$BASE/api/editions/$ED_Y/publish-operations" -b /tmp/tg-p.jar \
  -H 'Content-Type: application/json' -d '{}')
echo "publish-op(Y fanout): $PY"
OP_B=$(echo "$PY" | python3 -c 'import json,sys;d=json.load(sys.stdin);print([o for o in d["operations"] if o["siteId"]=='"$SITE_B"'][0]["operationId"])' 2>/dev/null)
OP_C=$(echo "$PY" | python3 -c 'import json,sys;d=json.load(sys.stdin);print([o for o in d["operations"] if o["siteId"]=='"$SITE_C"'][0]["operationId"])' 2>/dev/null)
echo "$PY" | TG_B="$SITE_B" TG_C="$SITE_C" python3 -c '
import json,sys,os
d=json.load(sys.stdin)
want={int(os.environ["TG_B"]), int(os.environ["TG_C"])}
assert "operation" not in d and len(d["operations"])==2, d
assert all(o["created"] is True and o["state"]=="queued" for o in d["operations"]), d
assert {o["siteId"] for o in d["operations"]}==want, d' \
  && ok "Y fanout: 2 operations queued (B, C)" || bad "Y fanout $PY"
[ -n "$OP_B" ] && [ -n "$OP_C" ] || { bad "fanout op ids B=$OP_B C=$OP_C"; exit 1; }

ST_B=$(wait_op "$OP_B"); ST_C=$(wait_op "$OP_C")
[ "$ST_B" = "failed" ] && [ "$(op_err_code "$OP_B")" = "COMPILER_ASSESSMENT_NOT_PASSED" ] \
  && ok "Y site B publish blocked at compile gate (COMPILER_ASSESSMENT_NOT_PASSED)" \
  || bad "Y B op state=$ST_B err=$(op_err_code "$OP_B")"
[ "$ST_C" = "succeeded" ] && ok "Y site C publish succeeded" \
  || bad "Y C op state=$ST_C err=$(op_err_code "$OP_C")"

ROW_B=$(Q "publish_state||'|'||coalesce(release_id,'') FROM geo_foundry.edition_sites WHERE edition_id=$ED_Y AND site_id=$SITE_B")
[ "${ROW_B%%|*}" = "pending" ] && ok "Y×B site row stays pending (gate blocked)" || bad "Y B row=$ROW_B"
ROW_C=$(Q "publish_state||'|'||coalesce(release_id,'') FROM geo_foundry.edition_sites WHERE edition_id=$ED_Y AND site_id=$SITE_C")
[ "${ROW_C%%|*}" = "published" ] && [ -n "${ROW_C#*|}" ] \
  && ok "Y×C site row published with release" || bad "Y C row=$ROW_C"
ST_Y=$(Q "workflow_status FROM geo_foundry.edition_revisions WHERE parent_id=$ED_Y AND latest=true")
[ "$ST_Y" = "published" ] && ok "Y advanced to published by first succeeded site (C)" || bad "Y latest=$ST_Y"
URL_B=$(Q "state FROM geo_foundry.url_records WHERE edition_id=$ED_Y AND site_id=$SITE_B")
URL_C=$(Q "state FROM geo_foundry.url_records WHERE edition_id=$ED_Y AND site_id=$SITE_C")
[ "$URL_B" = "reserved" ] && [ "$URL_C" = "active" ] \
  && ok "Y URLs: B reserved, C active" || bad "urls B=$URL_B C=$URL_C"

# ---------- 5. 还原现场 ----------
# Y 已被 C 站成功推进 published：dfp 回 draft 后归档；异常路径（C 未成功）直接归档。
if [ "$ST_Y" = "published" ]; then
  DY=$(curl -s -X POST "$BASE/api/editions/$ED_Y/draft-from-published" -b /tmp/tg-e.jar \
    -H 'Content-Type: application/json' -d '{"reason":"E2E A3 cleanup"}')
  [ "$(st_of "$DY")" = "draft" ] && ok "Y cleanup draft-from-published" || bad "Y dfp $DY"
fi
SY=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/editions/$ED_Y/workflow-transitions" -b /tmp/tg-e.jar \
  -H 'Content-Type: application/json' -d '{"target":"archived","reason":"E2E A3 cleanup"}')
[ "$(echo "$SY" | tail -1)" = "200" ] && ok "Y archived" || bad "Y archive $(echo "$SY"|tail -2)"
SX=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/editions/$ED_X/workflow-transitions" -b /tmp/tg-e.jar \
  -H 'Content-Type: application/json' -d '{"target":"archived","reason":"E2E A3 cleanup"}')
[ "$(echo "$SX" | tail -1)" = "200" ] && ok "X archived (approved -> archived free flow)" || bad "X archive $(echo "$SX"|tail -2)"

# 本 run 的评估/向量行（含真实站 375 上的 X 行）只按 X/Y 两个文章精确删除。
PSQL "DELETE FROM geo_foundry.quality_assessments WHERE edition_id IN ($ED_X,$ED_Y)" >/dev/null
PSQL "DELETE FROM geo_foundry.embeddings WHERE edition_id IN ($ED_X,$ED_Y)" >/dev/null
PSQL "DELETE FROM geo_foundry.edition_sites WHERE edition_id=$ED_X AND site_id=$SITE_A" >/dev/null
ok "X/Y assessment, embedding and site-A rows cleaned (fixture sites purged by trap)"

echo
echo "==== RESULT: ${#PASS[@]} passed, ${#FAIL[@]} failed ===="
[ ${#FAIL[@]} -gt 0 ] && printf 'FAILED: %s\n' "${FAIL[@]}" && exit 1
rm -f /tmp/tg-e.jar /tmp/tg-r.jar /tmp/tg-p.jar
exit 0
