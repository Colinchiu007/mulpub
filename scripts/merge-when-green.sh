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

# repo slug（用于 REST 合并 API）
REPO="$(git config --get remote.origin.url 2>/dev/null | sed -E 's#.*github\.com[:/]([^/]+/[^/]+)\.git$#\1#')"
[[ -z "$REPO" ]] && REPO="${GH_REPO:-Colinchiu007/Multi-Publish}"

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
  # state 为大写；未完成态：PENDING/IN_PROGRESS/QUEUED/WAITING/REQUESTED
  mapfile -t PENDING < <(gh pr checks "$PR" --json name,state --jq \
    '.[] | select(.state=="PENDING" or .state=="IN_PROGRESS" or .state=="QUEUED" or .state=="WAITING" or .state=="REQUESTED") | .name' 2>/dev/null) || PENDING=()
  total=$(gh pr checks "$PR" --json name --jq 'length' 2>/dev/null || echo 0)
  if [ "${#PENDING[@]}" -eq 0 ] && [ "${total:-0}" -gt 0 ]; then break; fi
  if [ "${total:-0}" -eq 0 ]; then
    echo "  尚未产生 CI 检查（runner 可能离线），继续等待..."
  else
    echo "  $total 个检查，仍有 ${#PENDING[@]} 个未完成，继续等待..."
  fi
  sleep "$POLL"
done

# 3) 解析结论（仅用 state，不依赖 conclusion 字段）
mapfile -t FAILED < <(gh pr checks "$PR" --json name,state --jq \
  '.[] | select(.state=="FAILURE" or .state=="CANCELLED" or .state=="TIMED_OUT" or .state=="ERROR") | .name' 2>/dev/null) || FAILED=()
PENDING_N=$(gh pr checks "$PR" --json state --jq \
  '[.[] | select(.state=="PENDING" or .state=="IN_PROGRESS" or .state=="QUEUED" or .state=="WAITING" or .state=="REQUESTED")] | length' 2>/dev/null || echo 0)
TOTAL=$(gh pr checks "$PR" --json name --jq 'length' 2>/dev/null || echo 0)

[[ "${TOTAL:-0}" -gt 0 ]] || { echo "无任何 CI 检查，安全起见不合并"; exit 5; }
[[ "${PENDING_N:-0}" -eq 0 ]] || { echo "仍有检查未完成"; exit 3; }
if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "CI 失败:"; printf '  - %s\n' "${FAILED[@]}"; exit 4
fi

# 4) 合并（REST API 直接合并，无需 --yes，原子且可靠）
echo "==> CI 通过，合并 PR #$PR ($METHOD)..."
MERGE_BODY=(-X PUT "repos/${REPO}/pulls/${PR}/merge" -f "merge_method=${METHOD}")
[[ "$DELETE_BRANCH" -eq 1 ]] && MERGE_BODY+=(-f "delete_branch=true")
if gh api "${MERGE_BODY[@]}" >/dev/null 2>&1; then
  echo "✓ PR #$PR 已合并。"
else
  echo "✗ gh api 合并失败（PR 可能已不可合并或有冲突），未合并。"; exit 6
fi
