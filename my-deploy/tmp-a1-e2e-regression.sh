#!/usr/bin/env bash
# A1 E2E 回归：13 套按 0b 顺序串行，汇总 PASS/FAIL（一次性脚本，不入库）
set -uo pipefail
cd /tmp
# E2E 夹具密码（0b 起落在 /tmp/gf-e2e.env，mode 600）
set -a
. /tmp/gf-e2e.env
set +a

ORDER=(
  e2e-automatic-rollback
  e2e-delivery-api
  e2e-internal-endpoints
  e2e-scheduled-publish
  e2e-586-workflow
  e2e-586-restore
  e2e-scrypt-rehash
  e2e-session-endpoints
  e2e-tenant-isolation
  e2e-rss-polling
  e2e-real-publish
  e2e-intake-automation
  e2e-console-pages
)

SUMMARY=/tmp/a1-e2e-summary.txt
: > "$SUMMARY"
TOTAL_P=0
TOTAL_F=0

for name in "${ORDER[@]}"; do
  echo "=== RUN $name ==="
  LOG="/tmp/a1-$name.log"
  bash "/tmp/$name.sh" > "$LOG" 2>&1
  rc=$?
  # 双格式结果行：`==== RESULT: N passed, M failed ====` 或 `PASS=N FAIL=M`
  p=$(grep -oE '[0-9]+ passed' "$LOG" | tail -1 | grep -oE '[0-9]+' || true)
  f=$(grep -oE '[0-9]+ failed' "$LOG" | tail -1 | grep -oE '[0-9]+' || true)
  if [[ -z "${p:-}" ]]; then
    pair=$(grep -oE 'PASS=[0-9]+ FAIL=[0-9]+' "$LOG" | tail -1 || true)
    p=${pair#PASS=}; p=${p%% *}
    f=${pair##*FAIL=}
  fi
  if [[ -z "${p:-}" ]]; then
    echo "$name rc=$rc RESULT_MISSING tail=$(tail -1 "$LOG")" | tee -a "$SUMMARY"
    continue
  fi
  TOTAL_P=$((TOTAL_P + p))
  TOTAL_F=$((TOTAL_F + f))
  status=OK
  [[ "$f" != "0" || "$rc" != "0" ]] && status=BAD
  echo "$name rc=$rc pass=$p fail=$f $status" | tee -a "$SUMMARY"
done

echo "=== TOTAL pass=$TOTAL_P fail=$TOTAL_F ==="
echo "TOTAL pass=$TOTAL_P fail=$TOTAL_F" >> "$SUMMARY"
cat "$SUMMARY"
echo "REGRESSION_DONE"
