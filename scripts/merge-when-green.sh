#!/usr/bin/env bash
# merge-when-green.sh — 轮询等待 PR 的 CI 检查全部通过后合并（替代 gh pr merge --auto）
# 用法:
#   bash scripts/merge-when-green.sh <PR_NUMBER> [squash|merge|rebase] [--delete-branch]
# 背景: 本仓为私有免费仓，GitHub 不允许设置 required status checks（403），
#       故 `gh pr merge --auto` 因“无必需检查”而立即合并。此脚本用显式轮询等待替代 --auto。
set -euo pipefail

PR="${1:?用法: merge-when-green.sh <PR_NUMBER> [method] [--delete-branch]}"
METHOD="${2:-squash}"
DELETE_BRANCH=0
[[ "${3:-}" == "--delete-branch" ]] && DELETE_BRANCH=1
TIMEOUT_MIN="${MERGE_WHEN_GREEN_TIMEOUT:-120}"
POLL=30

# 1) 状态检查（mergeable 可能为 UNKNOWN，重试等待计算完）
STATE=$(gh pr view "$PR" --json state --jq '.state')
[[ "$STATE" == "OPEN" ]] || { echo "PR #$PR 非 OPEN ($STATE)，中止"; exit 1; }
MERGEABLE=$(gh pr view "$PR" --json mergeable --jq '.mergeable')
for _ in 1 2 3; do
  [[ "$MERGEABLE" == "UNKNOWN" ]] || break
  sleep 5
  MERGEABLE=$(gh pr view "$PR" --json mergeable --jq '.mergeable')
done
[[ "$MERGEABLE" == "MERGEABLE" ]] || { echo "PR #$PR 不可合并 ($MERGEABLE)"; exit 1; }

# 2) 轮询等待所有检查结束（带硬截止，避免单 runner 拥堵时无限阻塞）
echo "==> 等待 PR #$PR CI 检查完成（最多 $TIMEOUT_MIN 分钟）..."
DEADLINE=$(( $(date +%s) + TIMEOUT_MIN * 60 ))
while true; do
  now=$(date +%s)
  if [ "$now" -ge "$DEADLINE" ]; then echo "超时：CI 检查未在 $TIMEOUT_MIN 分钟内结束。"; exit 2; fi
  mapfile -t PENDING < <(gh pr checks "$PR" --json name,state --jq '.[] | select(.state=="pending" or .state=="in_progress" or .state=="queued" or .state=="waiting") | .name')
  total=$(gh pr checks "$PR" --json name --jq 'length')
  if [ "${#PENDING[@]}" -eq 0 ] && [ "$total" -gt 0 ]; then break; fi
  if [ "$total" -eq 0 ]; then
    echo "  尚未产生 CI 检查（runner 可能离线），继续等待..."
  else
    echo "  $total 个检查，仍有 ${#PENDING[@]} 个未完成，继续等待..."
  fi
  sleep "$POLL"
done

# 3) 解析结论
mapfile -t FAILED < <(gh pr checks "$PR" --json name,state,conclusion \
  --jq '.[] | select(.conclusion=="failure" or .state=="error" or .conclusion=="timed_out" or .conclusion=="cancelled") | .name')
PENDING_N=$(gh pr checks "$PR" --json state --jq '[.[] | select(.state=="pending" or .state=="in_progress" or .state=="queued" or .state=="waiting")] | length')
TOTAL=$(gh pr checks "$PR" --json name --jq 'length')

[[ "$TOTAL" -gt 0 ]] || { echo "无任何 CI 检查，安全起见不合并"; exit 5; }
[[ "$PENDING_N" -eq 0 ]] || { echo "仍有检查未完成"; exit 3; }
if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "CI 失败:"; printf '  - %s\n' "${FAILED[@]}"; exit 4
fi

# 4) 合并
echo "==> CI 通过，合并 PR #$PR ($METHOD)..."
ARGS=(pr merge "$PR" --"$METHOD" --yes)
[[ "$DELETE_BRANCH" -eq 1 ]] && ARGS+=(--delete-branch)
gh "${ARGS[@]}"
