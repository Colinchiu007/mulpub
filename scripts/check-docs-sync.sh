#!/bin/bash
# ==============================================================
# 文档同步硬门禁检查
#
# 功能：检查 PR 中代码变更是否同步更新了对应文档
# 规则：任何 .py/.js/.ts/.vue/.json/.yaml 等代码/配置变更，
#       必须同时变更 PRD.md 或 docs/ 下的文档
#
# 用法：check-docs-sync.sh --base=<branch> --head=<branch>
# ==============================================================

set -euo pipefail

# ---- 参数解析 ----
for arg in "$@"; do
  case "$arg" in
    --base=*) BASE="${arg#*=}" ;;
    --head=*) HEAD="${arg#*=}" ;;
    *) echo "❌ 未知参数: $arg"; exit 1 ;;
  esac
done

if [ -z "${BASE:-}" ] || [ -z "${HEAD:-}" ]; then
  echo "❌ 必须指定 --base 和 --head"
  exit 1
fi

echo "🔍 文档同步检查：base=$BASE  head=$HEAD"
echo ""
# ---- bypass-doc-gate label check (early exit) ----
if [ -n "${PR_NUMBER:-}" ]; then
  if gh pr view "$PR_NUMBER" --json labels -q '.labels[].name' 2>/dev/null | grep -q '^bypass-doc-gate$'; then
    echo "bypass-doc-gate label found, skipping doc sync check"
    exit 0
  fi
fi


# ---- 在 CI 环境中确保 base 分支可用 ----
# GitHub Actions checkout 只获取当前 ref，需显式获取 base 分支
if ! git rev-parse --verify "origin/$BASE" >/dev/null 2>&1; then
  echo "  fetching origin/$BASE ..."
  git fetch origin "+refs/heads/$BASE:refs/remotes/origin/$BASE"
fi

# ---- 获取变更文件列表 ----
# 优先使用 merge-base（精确 PR diff），fallback 到直接 diff
MERGE_BASE=""
if git merge-base --is-ancestor "origin/$BASE" "HEAD" 2>/dev/null; then
  MERGE_BASE=$(git merge-base "origin/$BASE" "HEAD")
fi

if [ -n "$MERGE_BASE" ]; then
  CHANGED=$(git diff --name-only "$MERGE_BASE".."HEAD")
else
  echo "  (using direct diff against origin/$BASE as fallback)"
  CHANGED=$(git diff --name-only "origin/$BASE".."HEAD" 2>/dev/null || \
            git diff --name-only "FETCH_HEAD".."HEAD" 2>/dev/null || true)
fi

if [ -z "$CHANGED" ]; then
  echo "✅ 无变更，跳过检查"
  exit 0
fi

echo "变更文件列表："
echo "$CHANGED" | sed 's/^/  /'
echo ""

# ---- 文档正则 ----
# openspec/（规格与 change）与 .ccg/（任务工件）属项目分层规则认定的流程/规格/文档，
# 与 docs/、01-docs/ 同视为文档变更，不视为需另行同步文档的「运行时代码」。
PRD_PATTERN="(PRD\.md|CHANGELOG\.md|docs/|01-docs/|README\.md|AGENTS\.md|openspec/|\.ccg/)"

# ---- 第一阶段：检查文档是否已更新 ----
DOCS_CHANGED=false
while IFS= read -r file; do
  if [[ "$file" =~ $PRD_PATTERN ]]; then
    DOCS_CHANGED=true
    break
  fi
done <<< "$CHANGED"

# ---- 第二阶段：检查是否有「需要文档同步」的代码变更 ----
CODE_CHANGED=false
while IFS= read -r file; do
  # 跳过文档类
  if [[ "$file" =~ $PRD_PATTERN ]]; then
    continue
  fi
  # 跳过 CI 流程文件
  if [[ "$file" =~ ^\.github/ ]]; then
    continue
  fi
  # 跳过脚本工具（仓库根 scripts/：AGENTS.md「分层分支策略」将其与 docs/openspec 同列为流程层）
  if [[ "$file" =~ ^scripts/ ]]; then
    continue
  fi
  # 跳过 OpenSpec / CCG 流程工件（规格与任务记录，非运行时代码）
  if [[ "$file" =~ ^openspec/ || "$file" =~ ^\.ccg/ ]]; then
    continue
  fi
  # 跳过配置文件（无需文档同步）
  if [[ "$file" =~ \.(gitignore|gitattributes|npmrc|editorconfig)$ ]]; then
    continue
  fi
  if [[ "$file" =~ ^(pyproject\.toml|package-lock\.json)$ ]]; then
    continue
  fi
  if [[ "$file" =~ ^CHANGELOG\.md$ ]]; then
    continue
  fi
  # 跳过质量节拍门禁执行日志（仓库根 .quality-gates.md）。
  # 只作「非代码」豁免，刻意不进 PRD_PATTERN：它是流程留痕，不是产品/架构文档，
  # 若让它充当「文档已同步」的证据，代码 + 只补一行门禁日志的 PR 就能绕过本门禁
  # （回归锁见 scripts/check-docs-sync.test.sh 的负向用例）。
  if [[ "$file" =~ ^\.quality-gates\.md$ ]]; then
    continue
  fi
  # 忽略 node_modules 和构建产物
  if [[ "$file" =~ node_modules|dist/ ]]; then
    continue
  fi
  CODE_CHANGED=true
  break
done <<< "$CHANGED"


# ---- bypass-doc-gate label check ----
if [ -n "${PR_NUMBER:-}" ]; then
  if gh pr view "$PR_NUMBER" --json labels -q '.labels[].name' 2>/dev/null | grep -q '^bypass-doc-gate$'; then
    echo bypass-doc-gate label found, skipping doc sync check
    exit 0
  fi
fi


# ---- 判定 ----
if [ "$CODE_CHANGED" = false ]; then
  echo "✅ 仅文档/流程变更，无需额外同步"
  exit 0
fi

if [ "$DOCS_CHANGED" = false ]; then
  echo "❌ 代码/配置有变更，但未同步更新 PRD 或相关文档"
  echo ""
  echo "  请在 PR 中包含对应变更："
  echo "    - 功能变更 → 更新 PRD.md 对应章节"
  echo "    - 产品逻辑变更 → 更新 PRD.md 用户流程说明"
  echo "    - 架构变更 → 更新 PRD.md 架构章节"
  echo ""
  echo "  如需绕过此门禁，请添加 'bypass-doc-gate' label"
  exit 1
fi

echo "✅ 文档同步检查通过！"
echo "  代码变更已同步更新文档。"

