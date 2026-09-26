#!/usr/bin/env bash
# ==============================================================
# check-docs-sync.sh 回归测试（QM-5 第 4 步：回归保护）
#
# 双向锁住豁免白名单，防止其再次漂移成不存在的目录：
#   正向 —— 仓库根 scripts/ 属流程层工具，无需同步文档
#   负向 —— 运行时代码缺文档必须仍然拦红（豁免不得外溢到 apps/）
# 历史：2026-09-25 该豁免原为 ^team/scripts/（仓库无 team/ 目录），
#      使纯 scripts/ PR 长期被误拦，PR #2375 即由此撞红。
#
# 用法：bash scripts/check-docs-sync.test.sh
# 由 .github/workflows/doc-gate.yml 在硬门禁之前执行。
# ==============================================================
set -uo pipefail

GATE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/check-docs-sync.sh"
[ -f "$GATE" ] || { echo "FATAL: gate script missing: $GATE"; exit 1; }

TMP="$(mktemp -d)" || { echo "FATAL: mktemp failed"; exit 1; }
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/empty-hooks"

export GIT_AUTHOR_NAME='Docs Sync Test' GIT_AUTHOR_EMAIL='docs-sync@test.local'
export GIT_COMMITTER_NAME='Docs Sync Test' GIT_COMMITTER_EMAIL='docs-sync@test.local'

# 临时仓库必须与本机全局 git 配置解耦：否则 commit.gpgsign 或 core.hooksPath
# 会让夹具提交签名失败或触发真实钩子，测试结果将随机器而异。
tgit() { git -c commit.gpgsign=false -c core.hooksPath="$TMP/empty-hooks" "$@"; }

PASSED=0
FAILED=0
CASE=0

make_repo() {
  local dir="$TMP/$1"
  tgit init -q --bare -b main "$dir.git"
  tgit init -q -b main "$dir"
  tgit -C "$dir" remote add origin "$dir.git"
  echo seed > "$dir/README.md"
  tgit -C "$dir" add -A
  tgit -C "$dir" commit -q -m seed
  tgit -C "$dir" push -q origin main 2> /dev/null
  printf '%s' "$dir"
}

# run_case <名称> <期望退出码> <变更文件...>
run_case() {
  local name="$1" want="$2"
  shift 2
  CASE=$((CASE + 1))
  local repo
  repo="$(make_repo "case-$CASE")"
  local f
  for f in "$@"; do
    mkdir -p "$repo/$(dirname "$f")"
    echo changed > "$repo/$f"
  done
  tgit -C "$repo" checkout -q -b feat
  tgit -C "$repo" add -A
  tgit -C "$repo" commit -q -m change
  local out rc
  out="$(cd "$repo" && bash "$GATE" --base=main --head=feat 2>&1)"
  rc=$?
  if [ "$rc" -eq "$want" ]; then
    PASSED=$((PASSED + 1))
    echo "PASS: $name"
  else
    FAILED=$((FAILED + 1))
    echo "FAIL: $name（期望 rc=$want，实际 rc=$rc）"
    echo "$out" | sed 's/^/      | /'
  fi
}

run_case "纯 scripts/ 工具变更属流程层，无需同步文档" 0 scripts/check-docs-sync.sh scripts/session-guard.ps1
run_case "运行时代码缺文档仍被拦红（豁免未外溢到 apps/）" 1 apps/desktop/src/views/Case.vue
run_case "运行时代码 + 01-docs 文档同步 → 通过" 0 apps/desktop/src/views/Case.vue 01-docs/PRD.md
run_case ".github/ 既有豁免不回归" 0 .github/workflows/quality-gate.yml
run_case "openspec/ 流程工件豁免不回归" 0 openspec/changes/demo/tasks.md
run_case "package-lock.json 既有豁免不回归" 0 package-lock.json
# 历史：2026-09-25 PR #2384 只改仓库根 .quality-gates.md（质量节拍的门禁执行日志），
#      却因该文件既不在 PRD_PATTERN、也不在任何豁免里而撞红，
#      被判成「改了代码却没同步文档」。正向锁它属流程层，负向锁它不得越权当作文档证据。
run_case "纯 .quality-gates.md（门禁执行日志）属流程层，无需同步文档" 0 .quality-gates.md
run_case "负向：.quality-gates.md 不得充当「文档已同步」的证据" 1 apps/desktop/src/views/Case.vue .quality-gates.md

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "PASS: $PASSED docs-sync gate checks"
  exit 0
fi
echo "FAILED: $FAILED / $((PASSED + FAILED)) docs-sync gate checks"
exit 1
