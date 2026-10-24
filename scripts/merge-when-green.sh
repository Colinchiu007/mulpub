#!/usr/bin/env bash
# merge-when-green.sh — 轮询等待 PR 的 CI 检查全部通过后合并（替代 gh pr merge --auto）
# 用法:
#   bash scripts/merge-when-green.sh <PR_NUMBER> [squash|merge|rebase] [--delete-branch]
# 背景: 本仓为私有免费仓，GitHub 不允许设置 required status checks（403），
#       故 `gh pr merge --auto` 因“无必需检查”而立即合并。此脚本用显式轮询等待替代 --auto。
# 注意: gh pr checks --json 的 state 为大写（PENDING/IN_PROGRESS/QUEUED/SUCCESS/FAILURE…）；
#       合并改用 REST API（gh api -X PUT .../merge），避免本环境 gh pr merge 无 --yes 的问题。
set -uo pipefail

PR="${1:?用法: merge-when-green.sh <PR_NUMBER> [method] [--delete-branch]}"
METHOD="${2:-squash}"
DELETE_BRANCH=0
[[ "${3:-}" == "--delete-branch" ]] && DELETE_BRANCH=1
TIMEOUT_MIN="${MERGE_WHEN_GREEN_TIMEOUT:-120}"
POLL=30
# 取数失败时的错误输出落点（避免把 stderr 混进 stdout 的数据流）
ERR_FILE="$(mktemp "${TMPDIR:-/tmp}/merge-when-green.XXXXXX.err" 2>/dev/null || echo "/tmp/merge-when-green.$$.err")"
trap 'rm -f "$ERR_FILE"' EXIT

# repo slug（用于 REST 合并 API）
REPO="$(git config --get remote.origin.url 2>/dev/null | sed -E 's#.*github\.com[:/]([^/]+/[^/]+)\.git$#\1#')"
[[ -z "$REPO" ]] && REPO="${GH_REPO:-Colinchiu007/mulpub}"

# 1) 状态检查（mergeable 可能为 UNKNOWN，重试等待计算完）
STATE=$(gh pr view "$PR" --json state --jq '.state' 2>/dev/null)
[[ "$STATE" == "OPEN" ]] || { echo "PR #$PR 非 OPEN ($STATE)，中止"; exit 1; }
MERGEABLE=$(gh pr view "$PR" --json mergeable --jq '.mergeable' 2>/dev/null)
for _ in 1 2 3; do
  [[ "$MERGEABLE" == "UNKNOWN" ]] || break
  sleep 5
  MERGEABLE=$(gh pr view "$PR" --json mergeable --jq '.mergeable' 2>/dev/null)
done
[[ "$MERGEABLE" == "MERGEABLE" ]] || { echo "PR #$PR 不可合并 ($MERGEABLE)"; exit 1; }

# 2) 轮询等待所有检查结束（带硬截止，避免单 runner 拥堵时无限阻塞）
echo "==> 等待 PR #$PR CI 检查完成（最多 $TIMEOUT_MIN 分钟）..."
DEADLINE=$(( $(date +%s) + TIMEOUT_MIN * 60 ))
while true; do
  now=$(date +%s)
  if [ "$now" -ge "$DEADLINE" ]; then echo "超时：CI 检查未在 $TIMEOUT_MIN 分钟内结束。"; exit 2; fi
  # 取数层（2026-10-24）：统一走 scripts/lib/pr-checks.js（两个合并入口共用的唯一真源）。
  #   它优先用 `gh pr checks --json name,state`；老 gh（不认 --json）自动降级到
  #   `gh api commits/<sha>/check-runs`（同名取最新一次 run）。
  #   ⚠️ 取数失败**不再**回落成「0 条检查」——那会让 break 条件永不满足，
  #      在「CI 其实早就全绿」的状态下空转到超时，且日志误导成「runner 可能离线」。
  #      取数失败在这里单独提示并继续等（硬截止仍在下面）。
  # state 为大写；未完成态：PENDING/IN_PROGRESS/QUEUED/WAITING/REQUESTED（判定语义逐字不变）
  if ! PR_CHECKS=$(node scripts/lib/pr-checks.js --pr "$PR" --repo "$REPO" --format=tsv 2>"$ERR_FILE"); then
    echo "  取数失败（**不是**「没有 CI 检查」）：$(head -1 "$ERR_FILE")；继续等待..."
    sleep "$POLL"; continue
  fi
  PENDING=(); TOTAL=0
  while IFS=$'\t' read -r ST NAME; do
    [ -z "${ST:-}" ] && continue
    TOTAL=$((TOTAL + 1))
    case "$ST" in
      PENDING|IN_PROGRESS|QUEUED|WAITING|REQUESTED) PENDING+=("$NAME") ;;
    esac
  done <<< "$PR_CHECKS"
  if [ "${#PENDING[@]}" -eq 0 ] && [ "${TOTAL:-0}" -gt 0 ]; then break; fi
  if [ "${TOTAL:-0}" -eq 0 ]; then
    echo "  尚未产生 CI 检查（runner 可能离线），继续等待..."
  else
    echo "  $TOTAL 个检查，仍有 ${#PENDING[@]} 个未完成，继续等待..."
  fi
  sleep "$POLL"
done

# 3b) 主干红 / 本 PR 新增红的闸门（判据唯一实现：scripts/lib/main-red.js，本入口只调用不判定）
#     rc=1 本 PR 自己引入的红；rc=2 主干红着（往红的主干上合 = 把 required Gate Result 的红留给下一个会话）；
#     rc=3 未证实（pending/零检查）；rc=4 闸门自身取不到数——一律停手，不得用重推掩盖。
#     ⛔ 整段必须排在下面「本 PR 失败清单」之前（第五轮 C2，Critical）：主干红时每个 PR 的 required
#     Gate Result 都跟着红，若先按「PR 有红」退出，闸门一次都不会被执行，而「只剩一句 CI 未通过、
#     把真实原因（主干红）藏成我的 PR 有问题」正是本片立项要消灭的那句话。
#     归因走环境变量 MAIN_RED_ALLOW（含空格，所以必须组数组，不能裸展开）。
MAIN_RED_ARGS=()
[[ -n "${MAIN_RED_ALLOW:-}" ]] && MAIN_RED_ARGS=(--allow-main-red "$MAIN_RED_ALLOW")
# 稳定窗参数透传（2026-10-22，change: main-red-run-baseline）：主干 tip 在读数期间移动时，
# 闸门自己会作废那次读数并有界重试（默认 3 次 × 90 秒）；这里只暴露覆盖口，不改判定。
[[ -n "${MAIN_RED_ATTEMPTS:-}" ]] && MAIN_RED_ARGS+=(--attempts "$MAIN_RED_ATTEMPTS")
[[ -n "${MAIN_RED_RETRY_SECONDS:-}" ]] && MAIN_RED_ARGS+=(--retry-seconds "$MAIN_RED_RETRY_SECONDS")
node scripts/check-main-red.js --pr "$PR" ${MAIN_RED_ARGS[@]+"${MAIN_RED_ARGS[@]}"} || { echo "STOP：main-red 闸门拒绝合并 PR #$PR（rc=$?，读上一行 verdict）"; exit 7; }

# 3) 解析结论（仅用 state，不依赖 conclusion 字段）
# 取数层同上（scripts/lib/pr-checks.js）；失败态与未完成态的判定集合逐字不变
if ! PR_CHECKS=$(node scripts/lib/pr-checks.js --pr "$PR" --repo "$REPO" --format=tsv 2>"$ERR_FILE"); then
  echo "STOP：取不到 PR #$PR 的检查状态（**不是**「没有检查」）——读上一行原因后重试，不要据此合并。" >&2
  exit 5
fi
FAILED=(); PENDING_N=0; TOTAL=0
while IFS=$'\t' read -r ST NAME; do
  [ -z "${ST:-}" ] && continue
  TOTAL=$((TOTAL + 1))
  case "$ST" in
    PENDING|IN_PROGRESS|QUEUED|WAITING|REQUESTED) PENDING_N=$((PENDING_N + 1)) ;;
    FAILURE|CANCELLED|TIMED_OUT|ERROR) FAILED+=("$NAME") ;;
  esac
done <<< "$PR_CHECKS"

[[ "${TOTAL:-0}" -gt 0 ]] || { echo "无任何 CI 检查，安全起见不合并"; exit 5; }
[[ "${PENDING_N:-0}" -eq 0 ]] || { echo "仍有检查未完成"; exit 3; }
if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "CI 失败:"; printf '  - %s\n' "${FAILED[@]}"; exit 4
fi

# 4) 合并（REST API 直接合并，无需 --yes，原子且可靠）
PR_HEAD_SHA=$(gh pr view "$PR" --json headRefOid --jq .headRefOid 2>/dev/null || echo '')
[[ -n "$PR_HEAD_SHA" ]] || { echo "STOP：取不到 PR head sha——不传 sha 的合并落的是「执行那一刻的 head」，闸门验过的 sha 与真正进主干的产物可以不是同一笔（第五轮 C6）"; exit 7; }
echo "==> CI 通过，合并 PR #$PR ($METHOD)..."
MERGE_BODY=(-X PUT "repos/${REPO}/pulls/${PR}/merge" -f "merge_method=${METHOD}" -f "sha=${PR_HEAD_SHA}")
[[ "$DELETE_BRANCH" -eq 1 ]] && MERGE_BODY+=(-f "delete_branch=true")
if gh api "${MERGE_BODY[@]}" >/dev/null 2>&1; then
  echo "✓ PR #$PR 已合并。"
else
  echo "✗ gh api 合并失败（PR 可能已不可合并或有冲突），未合并。"; exit 6
fi
