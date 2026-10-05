#!/usr/bin/env bash
# 在 mk-dev 宿主运行；先 source /tmp/gf-e2e.env，再 bash 本脚本。
# 只创建/归档前缀为 E2E NKMed 交付的租户 430、站点 498 文章。
# 不修改站点、凭据或 keyring；不使用租户 413 的 editor/publisher。
# root 有跨租户文章写入权限；所有人工动作使用 root 的独立 cookie jar。
# 初次发布事件是站点级：已有 current release 则 updated，否则 published。
# 评估按现有 E2E 注入 passed；发布、重发和 webhook 必须由真实 worker 完成。
set +x
set -uo pipefail
umask 077
BASE=http://127.0.0.1:3090
DELIVERY=http://127.0.0.1:3091
WEB=http://127.0.0.1:3010
HOST=nkmed-mk-dev.aixllent.com
PUBLIC="https://$HOST"
SITE=498
TENANT=430
PREFIX='E2E NKMed 交付'
TS="$(date +%Y%m%d%H%M%S)-$$"
TITLE="$PREFIX $TS"
NEW_TITLE="$TITLE 更新版"
BODY=$'## 机器可读交付验证\n\n这是 NKMed 测试站端到端验证的第一段正文，仅用于验证内容交付，不构成医疗建议。\n\n这是第二段正文，用于验证服务端初始 HTML 中可直接读取内容，以及发布、更新和撤下的完整链路。\n\n参考资料：[世界卫生组织](https://www.who.int/zh)。'
BODY_MARKER='这是 NKMed 测试站端到端验证的第一段正文'
PASS=(); FAIL=(); ARTICLES=()
TMP=''; JAR=''; ED=''; OP=''; REL=''; PATHNAME=''; CANONICAL=''
LOGGED_IN=0
ok() { PASS+=("$1"); echo "PASS: $1"; }
bad() { FAIL+=("$1"); echo "FAIL: $1"; }
fatal() { bad "$1"; exit 1; }
check() { local LABEL="$1"; shift; "$@" && ok "$LABEL" || bad "$LABEL"; }
POLL_END=0
PSQL() {
  local LIMIT=10 REM
  if (( POLL_END > 0 )); then
    REM=$((POLL_END - SECONDS)); (( REM > 0 )) || return 1
    (( REM >= LIMIT )) || LIMIT=$REM
  fi
  timeout "$LIMIT" sudo -n docker exec -e PGOPTIONS='-c statement_timeout=5000' pg-server \
    psql -U gpucloud -d geo_foundry -v ON_ERROR_STOP=1 -qAt -c "$1"
}
Q() { PSQL "SELECT $1"; }

# 状态码与正文分开保存，不打印认证响应或密钥；不跟随重定向，不执行 JS。
# 轮询期间每次 HTTP 请求最多消耗剩余时间，避免最后一次请求超出预算。
HTTP_LIMIT=15
fetch() { # 输出文件 URL [curl 参数] -> 状态码
  local OUT="$1" URL="$2" CODE; shift 2
  CODE=$(curl -q -s --connect-timeout 3 --max-time "$HTTP_LIMIT" \
    -o "$OUT" -w '%{http_code}' "$URL" "$@") || { printf '000'; return 1; }
  printf '%s' "$CODE"
}
cms() { # 方法 路径 JSON -> HTTP_CODE；正文在 response.json
  HTTP_CODE=$(fetch "$TMP/response.json" "$BASE$2" -X "$1" -b "$JAR" \
    -H 'Content-Type: application/json' -d "$3") || HTTP_CODE=000
}
field() { # 文件 点分字段；只输出调用方指定的非秘密字段
  python3 -c 'import json,sys
d=json.load(open(sys.argv[1]))
for k in sys.argv[2].split("."): d=d[k]
assert d is not None
print(d)' "$1" "$2"
}
draft() {
  local CODE
  CODE=$(fetch "$TMP/draft.json" "$BASE/api/content-editions/$1?draft=true&depth=0" -b "$JAR") || return 1
  [ "$CODE" = 200 ]
}
json_ok() { python3 -c "$2" "$1" "${@:3}"; }

# HTMLParser 检查真实标签与正文，排除只在 metadata / hydration 中出现标题的假阳性。
# JSON-LD 使用 JSON 解析，不依赖属性顺序、空白或 HTML 属性排列。
html_check() { # 文件 模式 [标题或路径]
  python3 - "$1" "$2" "${3:-}" "$CANONICAL" "$BODY_MARKER" <<'PY'
import json, sys
from html.parser import HTMLParser
from urllib.parse import urlsplit
class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tags=[]; self.text=[]; self.hidden=[]; self.ld=[]; self.script=None
    def handle_starttag(self, tag, attrs):
        a=dict(attrs); self.tags.append((tag,a))
        if tag in ('script','style','head','template'):
            self.hidden.append(tag)
        if tag == 'script' and a.get('type','').lower() == 'application/ld+json':
            self.script=[]
    def handle_endtag(self, tag):
        if tag == 'script' and self.script is not None:
            self.ld.append(json.loads(''.join(self.script))); self.script=None
        if tag in self.hidden:
            self.hidden.remove(tag)
    def handle_data(self, data):
        if self.script is not None: self.script.append(data)
        if not self.hidden: self.text.append(data)
def nodes(value):
    if isinstance(value,dict):
        yield value
        for v in value.values(): yield from nodes(v)
    elif isinstance(value,list):
        for v in value: yield from nodes(v)
raw=open(sys.argv[1]).read(); p=Page(); p.feed(raw)
mode,want,canonical,marker=sys.argv[2:]
text=' '.join(p.text)
articles=[n for graph in p.ld for n in nodes(graph)
          if any(t in ('Article','NewsArticle') for t in
                 (n.get('@type',[]) if isinstance(n.get('@type'),list) else [n.get('@type')]))]
if mode == 'title': assert want in text
elif mode == 'body': assert marker in text
elif mode == 'robots':
    assert any(t=='meta' and a.get('name','').lower()=='robots' and
               'noindex' in a.get('content','').lower() for t,a in p.tags)
elif mode == 'canonical':
    assert any(t=='link' and 'canonical' in a.get('rel','').lower().split() and
               a.get('href')==canonical for t,a in p.tags)
elif mode == 'og':
    assert any(t=='meta' and a.get('property')=='og:title' and
               a.get('content')==want for t,a in p.tags)
elif mode == 'ld':
    assert any(n.get('inLanguage')=='zh-CN' and n.get('mainEntityOfPage') for n in articles)
elif mode == 'author':
    assert articles and all(n.get('author') for n in articles)
    for n in articles:
        authors=n['author'] if isinstance(n['author'],list) else [n['author']]
        assert all(isinstance(a,dict) and a.get('@type')=='Organization' for a in authors)
elif mode == 'no-editorial': assert 'Editorial Team' not in raw
elif mode in ('link','no-link'):
    found=any(t=='a' and urlsplit(a.get('href','')).path==want for t,a in p.tags)
    assert found == (mode=='link')
else: raise ValueError(mode)
PY
}
poll() { # 秒数 探针函数 [参数]；探针写入的最后一次响应供断言复用
  local END=$((SECONDS + $1)) REM; shift
  POLL_END=$END
  while (( SECONDS < END )); do
    REM=$((END - SECONDS)); HTTP_LIMIT=$((REM < 10 ? REM : 10))
    if "$@" && (( SECONDS <= END )); then HTTP_LIMIT=15; POLL_END=0; return 0; fi
    REM=$((END - SECONDS)); (( REM > 0 )) || break
    sleep "$((REM < 3 ? REM : 3))"
  done
  HTTP_LIMIT=15; POLL_END=0; return 1
}
page_ready() {
  local CODE
  CODE=$(fetch "$TMP/page.html" "$WEB$PATHNAME") || return 1
  [ "$CODE" = 200 ] && html_check "$TMP/page.html" title "$1" 2>/dev/null
}
list_ready() {
  local CODE
  CODE=$(fetch "$TMP/list.html" "$WEB/articles") || return 1
  [ "$CODE" = 200 ] && html_check "$TMP/list.html" "$1" "$PATHNAME" 2>/dev/null
}
gone_ready() {
  local CODE
  CODE=$(fetch "$TMP/gone.html" "$WEB$PATHNAME") || return 1
  [ "$CODE" = 404 ]
}
event_id_of() {
  python3 -c 'import hashlib,sys;print("evt-"+hashlib.sha256(
    ("%s|%s|%s" % tuple(sys.argv[1:])).encode()).hexdigest()[:24])' "$SITE" "$1" "$2"
}
event_ready() { # release type：精确绑定站点+release+类型，不接受历史事件
  local EV ROW
  EV=$(event_id_of "$1" "$2") || return 1
  ROW=$(Q "count(*) FROM geo_foundry.site_event_deliveries
    WHERE event_id='$EV' AND site_id=$SITE AND tenant_id=$TENANT
      AND release_id='$1' AND event_type='$2' AND state='delivered'
      AND last_status_code BETWEEN 200 AND 299") || return 1
  [ "$ROW" = 1 ]
}
op_ready() {
  local ST
  ST=$(Q "state FROM geo_foundry.operations WHERE operation_id='$1' AND site_id=$SITE AND tenant_id=$TENANT") || return 1
  [ "$ST" = succeeded ]
}
published_ready() {
  op_ready "$OP" && [ "$(Q "count(*) FROM geo_foundry.edition_sites
    WHERE edition_id=$ED AND site_id=$SITE AND publish_state='published' AND release_id='$REL'")" = 1 ] \
    && event_ready "$REL" "$1"
}
safe_article() { # 所有清理动作前：id+前缀+租户+主站+全体分配双重校验
  [[ "$1" =~ ^[1-9][0-9]*$ ]] || return 1
  [ "$(Q "count(*) FROM geo_foundry.edition_revisions v
    WHERE v.parent_id=$1 AND v.latest AND v.tenant_id=$TENANT AND v.site_id=$SITE
      AND v.title LIKE '$PREFIX %' AND coalesce(v.sites, ARRAY[]::integer[]) <@ ARRAY[$SITE]
      AND NOT EXISTS (SELECT 1 FROM geo_foundry.edition_sites es
        WHERE es.edition_id=v.parent_id AND es.site_id<>$SITE)")" = 1 ]
}
archive_article() {
  local ID="$1" STATE
  safe_article "$ID" || { bad "清理身份校验失败 edition=$ID；保留现场"; return 1; }
  STATE=$(Q "workflow_status FROM geo_foundry.edition_revisions WHERE parent_id=$ID AND latest") || return 1
  if [ "$STATE" = archived ]; then ok "清理 edition=$ID 已归档"; return 0; fi
  if [ "$STATE" = published ]; then
    cms POST "/api/editions/$ID/draft-from-published" '{"reason":"E2E NKMed 交付清理"}'
    [ "$HTTP_CODE" = 200 ] && [ "$(field "$TMP/response.json" workflowStatus)" = draft ] \
      || { bad "清理 edition=$ID draft-from-published 失败"; return 1; }
  fi
  cms POST "/api/editions/$ID/workflow-transitions" '{"target":"archived","reason":"E2E NKMed 交付清理"}'
  [ "$HTTP_CODE" = 200 ] && [ "$(field "$TMP/response.json" workflowStatus)" = archived ] \
    && ok "清理 edition=$ID 归档成功" || { bad "清理 edition=$ID 归档失败"; return 1; }
}
finish() {
  local RC=$? ID
  trap - EXIT INT TERM
  # 先等本次已知操作结束，避免归档与仍在编译的 worker 竞争。
  if [ "$LOGGED_IN" = 1 ]; then
    if [ -n "$OP" ] && ! poll 180 op_ready "$OP"; then
      bad '清理：本次 worker 操作未成功；仍尝试归档，请检查残留 release'
    fi
    for ID in "${ARTICLES[@]}"; do
      archive_article "$ID" || bad "trap清理 edition=$ID 未完成；需人工恢复"
    done
  fi
  [ -z "$TMP" ] || rm -rf -- "$TMP"
  if (( RC != 0 && ${#FAIL[@]} == 0 )); then bad "脚本提前退出（状态 $RC）"; fi
  if (( RC != 0 || ${#FAIL[@]} > 0 )); then RC=1; else RC=0; fi
  (( ${#FAIL[@]} == 0 )) || printf 'FAILED: %s\n' "${FAIL[@]}"
  echo "==== RESULT: ${#PASS[@]} passed, ${#FAIL[@]} failed ===="
  exit "$RC"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ---------- 0. 前提、凭据、旧文章清理 ----------
for TOOL in curl python3 sudo docker flock mktemp timeout; do
  command -v "$TOOL" >/dev/null || fatal "缺少工具 $TOOL"
done
[ -n "${GF_E2E_ROOT_PASSWORD:-}" ] || fatal '未设置 GF_E2E_ROOT_PASSWORD'
# 固定站点测试不可并发；锁文件不删除，避免 unlink 导致双锁。
exec 9>/tmp/gf-e2e-nkmed-delivery.lock
flock -n 9 || fatal '已有 NKMed 交付测试运行中'
TMP=$(mktemp -d /tmp/gf-e2e-nkmed-delivery.XXXXXX) || fatal '临时目录创建失败'
JAR="$TMP/root.jar"
check 'CMS /api/health 200' test "$(fetch "$TMP/cms-health.json" "$BASE/api/health")" = 200
check 'NKMed /api/health 200' test "$(fetch "$TMP/web-health.json" "$WEB/api/health")" = 200
(( ${#FAIL[@]} == 0 )) || exit 1
[ "$(Q "count(*) FROM geo_foundry.sites s JOIN geo_foundry.domains d ON d.site_id=s.id
  WHERE s.id=$SITE AND s.tenant_id=$TENANT AND s.name='NKMed 测试站' AND s.locale='zh-CN'
    AND s.status='active' AND d.tenant_id=$TENANT AND d.hostname='$HOST'
    AND d.role='canonical' AND d.status='active'
    AND s.webhook_url='$PUBLIC/api/geo/revalidate'
    AND s.webhook_secret_reference='nkmed-mk-dev-webhook'")" = 1 ] \
  && ok '站点498身份、租户430、zh-CN、active canonical和webhook配置正确' \
  || fatal '站点498配置不符；禁止自动修改'
LOGIN=$(python3 -c 'import json,sys;print(json.dumps({"email":"gf-root-test@geo-foundry.dev",
  "password":sys.argv[1]}))' "$GF_E2E_ROOT_PASSWORD" | \
  fetch "$TMP/login.json" "$BASE/api/users/login" -X POST -c "$JAR" \
    -H 'Content-Type: application/json' -d @-) || LOGIN=000
[ "$LOGIN" = 200 ] && json_ok "$TMP/login.json" 'import json,sys;d=json.load(open(sys.argv[1]));assert d["user"]["role"]=="super-admin"' \
  && ok 'root super-admin 登录成功' || fatal 'root 登录或角色校验失败'
LOGGED_IN=1
rm -f "$TMP/login.json"
SKEY=$(sudo -n python3 -c 'import json; k=json.load(open("/opt/geo-foundry/credentials/content-service-keyring.json"))["tenants"]["430"];assert isinstance(k,str) and k;print(k)') \
  || fatal '无法读取租户430 content-service key'
DKEY=$(sudo -n python3 -c 'import json;ks=json.load(open("/opt/geo-foundry/credentials/site-keyring.json"))["sites"]["nkmed-mk-dev.aixllent.com"]["keys"];k=next(k["key"] for k in ks if k["status"]=="active");assert isinstance(k,str) and k;print(k)') \
  || fatal '无法读取 NKMed staging active delivery key'
ok '两份 staging 密钥已读取（不输出值）'
OLD=$(Q "parent_id FROM geo_foundry.edition_revisions WHERE latest
  AND tenant_id=$TENANT AND site_id=$SITE AND title LIKE '$PREFIX %'
  AND workflow_status<>'archived' ORDER BY parent_id") || fatal '旧文章查询失败'
for ID in $OLD; do
  safe_article "$ID" || fatal "旧文章 edition=$ID 分配范围不安全，拒绝修改"
  archive_article "$ID" || fatal "旧文章 edition=$ID 清理失败"
done
[ "$(Q "count(*) FROM geo_foundry.edition_revisions WHERE latest AND tenant_id=$TENANT
  AND site_id=$SITE AND title LIKE '$PREFIX %' AND workflow_status<>'archived'")" = 0 ] \
  && ok '本脚本前缀无未归档旧文章（发现则已清理）' || fatal '仍有旧文章未归档'

# ---------- 公共发布前置：review -> approve -> passed assessment ----------
make_approved() { # edition 周期（approve 幂等键须按更新周期区分）
  local ID="$1" CYCLE="$2" REV IH ASCODE
  cms POST "/api/editions/$ID/workflow-transitions" '{"target":"review"}'
  [ "$HTTP_CODE" = 200 ] && [ "$(field "$TMP/response.json" workflowStatus)" = review ] \
    && ok "$CYCLE 转 review" || { bad "$CYCLE 转 review 失败"; return 1; }
  draft "$ID" || return 1
  REV=$(field "$TMP/draft.json" workflowRevision) || return 1
  [[ "$REV" =~ ^[0-9]+$ ]] || return 1
  HTTP_CODE=$(fetch "$TMP/response.json" "$BASE/api/workspaces/reviewer/editions/$ID/approve" \
    -X POST -b "$JAR" -H 'Content-Type: application/json' \
    -H "x-request-id: nkmed-$TS-$ID-$CYCLE" -H "idempotency-key: nkmed-approve-$TS-$ID-$CYCLE" \
    -d "{\"expectedRevision\":$REV}") || HTTP_CODE=000
  [ "$HTTP_CODE" = 200 ] && [ "$(field "$TMP/response.json" workflowStatus)" = approved ] \
    && ok "$CYCLE 审批 approved（revision=$REV）" || { bad "$CYCLE 审批失败"; return 1; }
  HTTP_CODE=$(fetch "$TMP/input.json" "$BASE/api/internal/editions/$ID/input" \
    -H "Authorization: users API-Key $SKEY") || return 1
  [ "$HTTP_CODE" = 200 ] || return 1
  IH=$(field "$TMP/input.json" inputHash) || return 1
  ASCODE=$(python3 -c 'import hashlib,json,sys;print(json.dumps({"siteId":498,"inputHash":sys.argv[1],
    "issues":[],"modelId":"e2e-nkmed-delivery","overall":90,
    "dimensions":{"content":90,"seo":90,"structure":90},"promptVersion":"e2e-1",
    "provider":"e2e","state":"passed","thresholdsHash":hashlib.sha256(b"e2e-nkmed-defaults").hexdigest()}))' "$IH" | \
    fetch "$TMP/assessment.json" "$BASE/api/internal/editions/$ID/assessments" -X POST \
      -H "Authorization: users API-Key $SKEY" -H 'Content-Type: application/json' \
      -H "x-request-id: nkmed-assess-$TS-$ID-$CYCLE" -d @-) || return 1
  [[ "$ASCODE" = 200 || "$ASCODE" = 201 ]] && json_ok "$TMP/assessment.json" \
    'import json,sys;assert json.load(open(sys.argv[1]))["assessmentId"]>0' \
    && ok "$CYCLE 当前 inputHash 的 (edition,498) passed 评估写入" \
    || { bad "$CYCLE passed 评估失败"; return 1; }
}
publish() { # 只返回本次操作；REL/OP 全局保存，trap 可见
  cms POST "/api/editions/$ED/publish-operations" '{"siteId":498}'
  [[ "$HTTP_CODE" = 202 || "$HTTP_CODE" = 200 ]] || return 1
  OP=$(field "$TMP/response.json" operation.operationId) || return 1
  REL=$(field "$TMP/response.json" operation.releaseId) || return 1
  [[ "$OP" =~ ^[a-zA-Z0-9-]+$ && "$REL" =~ ^rel-[a-zA-Z0-9-]+$ ]] || return 1
  [ "$(field "$TMP/response.json" operation.siteId)" = "$SITE" ]
}

# ---------- 1. 创建本站唯一分配文章并真实发布 ----------
CREATE_CODE=$(python3 -c 'import json,sys;print(json.dumps({"title":sys.argv[1],"bodyMarkdown":sys.argv[2],
  "summary":"NKMed 测试站机器可读交付端到端验证。","tenant":430,"site":498,"sites":[498]},ensure_ascii=False))' "$TITLE" "$BODY" | \
  fetch "$TMP/create.json" "$BASE/api/content-editions?draft=true&depth=0" -X POST -b "$JAR" \
    -H 'Content-Type: application/json' -d @-) || CREATE_CODE=000
ED=$(field "$TMP/create.json" doc.id) || fatal '文章创建响应缺少 id'
[[ "$ED" =~ ^[1-9][0-9]*$ ]] || fatal '文章 id 非法'
ARTICLES+=("$ED")
[ "$CREATE_CODE" = 201 ] && safe_article "$ED" && ok "唯一中文文章创建并仅分配498（edition=$ED）" \
  || fatal '文章创建或分配校验失败'
make_approved "$ED" initial || fatal '首次发布前置失败'
HAS_CURRENT=$(Q "count(*) FROM geo_foundry.releases WHERE site_id=$SITE AND tenant_id=$TENANT AND state='current'") \
  || fatal '站点 current release 查询失败'
case "$HAS_CURRENT" in 0) INITIAL_EVENT=published;; 1) INITIAL_EVENT=updated;; *) fatal '站点 current release 数量异常';; esac
ok "发布前只读检查 current=$HAS_CURRENT；本次预期 $INITIAL_EVENT"
publish || fatal 'publish-operation 提交失败'
ok "首次 publish-operation 已提交（op=$OP release=$REL）"
IN_TIME=0
poll 180 published_ready "$INITIAL_EVENT" && IN_TIME=1
check '180秒内首次发布、站点行和本次webhook全部成功' test "$IN_TIME" = 1
check '真实 worker publish-operation succeeded' op_ready "$OP"
check "(edition,498) published 且 release=$REL" test "$(Q "count(*) FROM geo_foundry.edition_sites
  WHERE edition_id=$ED AND site_id=$SITE AND publish_state='published' AND release_id='$REL'")" = 1
check "本次release=$REL 的 $INITIAL_EVENT webhook delivered且2xx（验签接收成功）" event_ready "$REL" "$INITIAL_EVENT"
[ "$IN_TIME" = 1 ] || exit 1
PATHNAME=$(Q "pathname FROM geo_foundry.url_records WHERE edition_id=$ED AND site_id=$SITE AND state='active'") \
  || fatal '文章 URL 查询失败'
[[ "$PATHNAME" =~ ^/articles/[a-zA-Z0-9_-]+$ ]] || fatal '文章路径不是安全的 /articles/<slug>'
CANONICAL="$PUBLIC$PATHNAME"
ok "文章实际路径取得 $PATHNAME"

# ---------- 2. 本地 SSR 页面及机器可读信号 ----------
check '90秒内 NKMed 详情200且可见正文标题正确' poll 90 page_ready "$TITLE"
check '详情初始HTML含第一段正文（无需JS）' html_check "$TMP/page.html" body
check '详情 meta robots 含 noindex' html_check "$TMP/page.html" robots
check "详情 canonical=$CANONICAL" html_check "$TMP/page.html" canonical
check '详情 og:title 等于文章标题' html_check "$TMP/page.html" og "$TITLE"
check 'JSON-LD Article/NewsArticle 含 zh-CN 和 mainEntityOfPage' html_check "$TMP/page.html" ld
check 'JSON-LD 文章 author 为 Organization' html_check "$TMP/page.html" author
check '详情整个HTML无 Editorial Team' html_check "$TMP/page.html" no-editorial
check '90秒内本地列表200且链接到文章路径' poll 90 list_ready link

# ---------- 3. 公网 Cloudflare 路径：两种爬虫原始HTML，无JS ----------
GPT_UA='Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)'
GOOGLE_UA='Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
for BOT in GPTBot Googlebot; do
  if [ "$BOT" = GPTBot ]; then UA="$GPT_UA"; else UA="$GOOGLE_UA"; fi
  CODE=$(fetch "$TMP/$BOT.html" "$CANONICAL" -A "$UA") || CODE=000
  check "公网 $BOT HTTP200（Cloudflare路径）" test "$CODE" = 200
  check "公网 $BOT 原始HTML可见标题" html_check "$TMP/$BOT.html" title "$TITLE"
  check "公网 $BOT 原始HTML可见正文" html_check "$TMP/$BOT.html" body
done

# ---------- 4. 真实 staging key 的 Delivery JSON 和 robots ----------
CODE=$(fetch "$TMP/delivery.json" "$DELIVERY/v1/sites/$HOST/pages$PATHNAME" \
  -H "Authorization: Bearer $DKEY") || CODE=000
check 'Delivery 文章JSON HTTP200（真实staging key）' test "$CODE" = 200
check 'Delivery document.route.canonicalUrl 正确' json_ok "$TMP/delivery.json" \
  'import json,sys;assert json.load(open(sys.argv[1]))["document"]["route"]["canonicalUrl"]==sys.argv[2]' "$CANONICAL"
check 'Delivery 顶层 jsonLd 非空' json_ok "$TMP/delivery.json" \
  'import json,sys;assert json.load(open(sys.argv[1])).get("jsonLd")'
CODE=$(fetch "$TMP/delivery-list.json" "$DELIVERY/v1/sites/$HOST/pages/articles" \
  -H "Authorization: Bearer $DKEY") || CODE=000
check 'Delivery /articles 列表JSON HTTP200' test "$CODE" = 200
check 'Delivery 列表 document.items 包含本文章' json_ok "$TMP/delivery-list.json" \
  'import json,sys;assert any(i.get("pathname")==sys.argv[2] for i in json.load(open(sys.argv[1]))["document"]["items"])' "$PATHNAME"
check 'Delivery 列表本文章 item 含 publishedAt、modifiedAt' json_ok "$TMP/delivery-list.json" \
  'import json,sys,datetime;items=json.load(open(sys.argv[1]))["document"]["items"];i=next(i for i in items if i.get("pathname")==sys.argv[2]);
for k in ("publishedAt","modifiedAt"): assert i.get(k);datetime.datetime.fromisoformat(i[k].replace("Z","+00:00"))' "$PATHNAME"
CODE=$(fetch "$TMP/delivery-robots.txt" "$DELIVERY/robots.txt") || CODE=000
check 'Delivery robots HTTP200且 Disallow: /' bash -c '[ "$1" = 200 ] && grep -Eq "^[[:space:]]*Disallow:[[:space:]]*/[[:space:]]*$" "$2"' _ "$CODE" "$TMP/delivery-robots.txt"

# ---------- 5. NKMed sitemap 与 robots ----------
CODE=$(fetch "$TMP/robots.txt" "$WEB/robots.txt") || CODE=000
check 'NKMed robots HTTP200且 Disallow: /（noindex模式）' bash -c '[ "$1" = 200 ] && grep -Eq "^[[:space:]]*Disallow:[[:space:]]*/[[:space:]]*$" "$2"' _ "$CODE" "$TMP/robots.txt"
CODE=$(fetch "$TMP/sitemap.xml" "$WEB/sitemap.xml") || CODE=000
check 'NKMed sitemap HTTP200' test "$CODE" = 200
check 'NKMed sitemap 本文章URL同一条目含有效 lastmod' json_ok "$TMP/sitemap.xml" \
  'import sys,datetime,xml.etree.ElementTree as E;r=E.parse(sys.argv[1]);ns={"s":"http://www.sitemaps.org/schemas/sitemap/0.9"};u=next(u for u in r.findall("s:url",ns) if u.findtext("s:loc",namespaces=ns)==sys.argv[2]);v=u.findtext("s:lastmod",namespaces=ns);assert v;datetime.datetime.fromisoformat(v.replace("Z","+00:00"))' "$CANONICAL"

# ---------- 6. 同一文章新修订：保持URL，更新后真实投递 ----------
OLD_REL="$REL"
cms POST "/api/editions/$ED/draft-from-published" '{"reason":"E2E NKMed 交付更新标题"}'
[ "$HTTP_CODE" = 200 ] && [ "$(field "$TMP/response.json" workflowStatus)" = draft ] \
  && ok '更新 draft-from-published 创建新草稿修订' || fatal '更新创建草稿失败'
PATCH=$(python3 -c 'import json,sys;print(json.dumps({"title":sys.argv[1]},ensure_ascii=False))' "$NEW_TITLE")
cms PATCH "/api/content-editions/$ED?draft=true&depth=0" "$PATCH"
[ "$HTTP_CODE" = 200 ] && [ "$(field "$TMP/response.json" doc.title)" = "$NEW_TITLE" ] \
  && ok '新修订标题编辑成功' || fatal '更新标题编辑失败'
make_approved "$ED" update || fatal '更新审批/评估失败'
publish || fatal '更新 publish-operation 提交失败'
[ "$REL" != "$OLD_REL" ] && ok "更新创建不同release=$REL" || fatal '更新复用了旧release'
IN_TIME=0
poll 180 published_ready updated && IN_TIME=1
check '180秒内更新发布、站点行和本次updated webhook全部成功' test "$IN_TIME" = 1
check '更新真实 worker publish-operation succeeded' op_ready "$OP"
check '更新站点行published并绑定新release' test "$(Q "count(*) FROM geo_foundry.edition_sites
  WHERE edition_id=$ED AND site_id=$SITE AND publish_state='published' AND release_id='$REL'")" = 1
check "新release=$REL 的 updated webhook delivered且2xx" event_ready "$REL" updated
[ "$IN_TIME" = 1 ] || exit 1
check '更新复用原文章URL' test "$(Q "pathname FROM geo_foundry.url_records WHERE edition_id=$ED AND site_id=$SITE AND state='active'")" = "$PATHNAME"
UPDATE_START=$SECONDS
check '90秒内NKMed原URL HTTP200且正文显示新标题' poll 90 page_ready "$NEW_TITLE"
echo "INFO: 更新 webhook 成功后页面等待 $((SECONDS - UPDATE_START)) 秒（验收上限90秒）"

# ---------- 7. 撤下：unpublished + 重发事件 + NKMed404 + Delivery410 ----------
REMOVED_REL="$REL"
cms DELETE "/api/editions/$ED/sites/$SITE" '{"reason":"E2E NKMed 交付撤下验证"}'
[ "$HTTP_CODE" = 202 ] && [ "$(field "$TMP/response.json" publishState)" = unpublished ] \
  && ok '带reason撤下 HTTP202、publishState=unpublished' || fatal '撤下请求失败'
OP=$(field "$TMP/response.json" operation.operationId) || fatal '撤下缺少重发operationId'
REL=$(field "$TMP/response.json" releaseId) || fatal '撤下缺少重发releaseId'
[[ "$OP" =~ ^[a-zA-Z0-9-]+$ && "$REL" =~ ^rel-[a-zA-Z0-9-]+$ ]] || fatal '撤下操作标识非法'
check '撤下站点行 unpublished 且release/url清空' test "$(Q "count(*) FROM geo_foundry.edition_sites
  WHERE edition_id=$ED AND site_id=$SITE AND publish_state='unpublished' AND release_id IS NULL AND url_record_id IS NULL")" = 1
check '撤下URL台账 gone 410' test "$(Q "count(*) FROM geo_foundry.url_records
  WHERE edition_id=$ED AND site_id=$SITE AND pathname='$PATHNAME' AND state='gone' AND status_code=410")" = 1
check "被撤release=$REMOVED_REL 的 unpublished delivered且2xx" poll 180 event_ready "$REMOVED_REL" unpublished
poll 180 op_ready "$OP" || fatal '撤下重发180秒内未成功'
ok "撤下重发真实 worker succeeded（release=$REL）"
check '撤下重发release current且被撤release superseded' test "$(Q "count(*) FROM geo_foundry.releases
  WHERE site_id=$SITE AND tenant_id=$TENANT AND
    ((release_id='$REL' AND state='current') OR (release_id='$REMOVED_REL' AND state='superseded'))")" = 2
rerelease_event_ready() { event_ready "$REL" updated || event_ready "$REL" published; }
check "重发release=$REL 的站点事件 delivered且2xx" poll 180 rerelease_event_ready
check '90秒内本地文章详情返回404' poll 90 gone_ready
check '90秒内本地列表HTTP200且不再链接本文章' poll 90 list_ready no-link
CODE=$(fetch "$TMP/delivery-gone.json" "$DELIVERY/v1/sites/$HOST/pages$PATHNAME" \
  -H "Authorization: Bearer $DKEY") || CODE=000
check '真实staging key请求Delivery文章 HTTP410' test "$CODE" = 410
check 'Delivery撤下错误码 DELIVERY_PAGE_GONE' json_ok "$TMP/delivery-gone.json" \
  'import json,sys;assert json.load(open(sys.argv[1]))["error"]["code"]=="DELIVERY_PAGE_GONE"'

# ---------- 8. EXIT trap 归档本次文章、删除私有临时文件、汇总最终结果 ----------
exit 0
