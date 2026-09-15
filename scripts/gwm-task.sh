#!/usr/bin/env bash
# gwm-task.sh — 任务生命周期管理（纯 git worktree，无外部依赖）
# 用法:
#   bash scripts/gwm-task.sh start <task-name>   — 创建 worktree + 安装依赖
#   bash scripts/gwm-task.sh list                 — 列出所有 worktree
#   bash scripts/gwm-task.sh status               — 查看全局状态
#   bash scripts/gwm-task.sh cleanup [path]       — 清理 worktree
#   bash scripts/gwm-task.sh cleanup-all          — 清理所有干净 worktree

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# 2026-09-15：MSYS_NO_PATHCONV=1 环境下 git -C 的 POSIX 路径参数不转换（见 session-init.sh 同款注释）
GIT_ROOT_ARG="$(cygpath -m "$SCRIPT_DIR/.." 2>/dev/null || echo "$SCRIPT_DIR/..")"
CURRENT_ROOT="$(git -C "$GIT_ROOT_ARG" rev-parse --show-toplevel)"
REPO_ROOT="$(git -C "$CURRENT_ROOT" worktree list --porcelain | awk '/^worktree / {print substr($0,10); exit}')"
REPO_PARENT="$(dirname "$REPO_ROOT")"
MP_WORKTREES="${MP_WORKTREES:-$REPO_PARENT/mp-worktrees}"

cd "$REPO_ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

cmd="${1:-help}"
shift || true

case "$cmd" in
    start)
        TASK_NAME="${1:?用法: gwm-task.sh start <task-name>}"
        if ! [[ "$TASK_NAME" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
            echo -e "${RED}任务名必须是小写 kebab-case: $TASK_NAME${NC}"
            exit 4
        fi
        BRANCH="${MP_BRANCH_PREFIX:+${MP_BRANCH_PREFIX}/}$TASK_NAME"
        # 2026-09-15：含斜杠分支名（codex/x）在本机 ref 写入不可靠（实测 fatal: invalid
        # reference），默认无斜杠分支名；需要前缀时以 MP_BRANCH_PREFIX 覆盖。
        WT_PATH="$MP_WORKTREES/mp-$TASK_NAME"
        mkdir -p "$MP_WORKTREES"
        COMMON_DIR="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir)"
        BOOTSTRAP_LOCK="$COMMON_DIR/ccg-worktree-bootstrap.lock"
        LOCK_ACQUIRED=0
        if mkdir "$BOOTSTRAP_LOCK" 2>/dev/null; then
            LOCK_ACQUIRED=1
        else
            LOCK_PID="$(cat "$BOOTSTRAP_LOCK/pid" 2>/dev/null || true)"
            if [ -n "$LOCK_PID" ] && ! kill -0 "$LOCK_PID" 2>/dev/null; then
                rm -f "$BOOTSTRAP_LOCK/pid"
                rmdir "$BOOTSTRAP_LOCK" 2>/dev/null || true
                if mkdir "$BOOTSTRAP_LOCK" 2>/dev/null; then
                    LOCK_ACQUIRED=1
                fi
            fi
        fi
        if [ "$LOCK_ACQUIRED" != "1" ]; then
            echo -e "${RED}另一个 worktree bootstrap 正在运行；请等待后串行重试。锁: $BOOTSTRAP_LOCK${NC}"
            exit 5
        fi
        printf '%s\n' "$$" > "$BOOTSTRAP_LOCK/pid"
        release_bootstrap_lock() {
            rm -f "$BOOTSTRAP_LOCK/pid"
            rmdir "$BOOTSTRAP_LOCK" 2>/dev/null || true
        }
        trap release_bootstrap_lock EXIT
        
        # 1. 确保主目录在 main
        MAIN_BRANCH=$(git -C "$REPO_ROOT" branch --show-current)
        if [ "$MAIN_BRANCH" != "main" ]; then
            echo -e "${YELLOW}主目录不在 main ($MAIN_BRANCH)，自动修复...${NC}"
            "$BASH" "$SCRIPT_DIR/session-init.sh"
        fi

        # clean 判定只看已跟踪文件：.ccg/ 等被 Write Guard 放行的目录会正常产生未跟踪证据文件，
        # 不应阻塞 worktree 创建（worktree add / 分支操作不受未跟踪文件影响）。
        if [ -n "$(git -C "$REPO_ROOT" status --porcelain --untracked-files=no)" ]; then
            echo -e "${RED}主目录 main 存在未提交文件，拒绝创建任务 worktree。${NC}"
            echo "先保护这些文件并恢复干净状态。"
            exit 2
        fi

        git -C "$REPO_ROOT" fetch --prune origin
        
        # 2. 创建 worktree
        if [ -d "$WT_PATH" ]; then
            EXPECTED_COMMON="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir)"
            EXISTING_COMMON="$(git -C "$WT_PATH" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
            if [ "$EXISTING_COMMON" != "$EXPECTED_COMMON" ]; then
                echo -e "${RED}worktree 路径已存在但不属于当前仓库: $WT_PATH${NC}"
                exit 3
            fi
            EXISTING_BRANCH="$(git -C "$WT_PATH" branch --show-current 2>/dev/null || true)"
            if [ "$EXISTING_BRANCH" != "$BRANCH" ]; then
                echo -e "${RED}worktree 路径已存在但分支不匹配: $EXISTING_BRANCH（期望 $BRANCH）${NC}"
                exit 3
            fi
            echo -e "${YELLOW}worktree 已存在: $WT_PATH${NC}"
            echo -e "分支: $EXISTING_BRANCH"
        else
            echo -e "${CYAN}创建 worktree: $TASK_NAME${NC}"
            
            if git -C "$REPO_ROOT" branch --list "$BRANCH" | grep -q "$BRANCH"; then
                git -C "$REPO_ROOT" worktree add "$WT_PATH" "$BRANCH"
            else
                git -C "$REPO_ROOT" worktree add -b "$BRANCH" "$WT_PATH" origin/main
            fi
            echo -e "${GREEN}✓ worktree 创建完成${NC}"
        fi
        release_bootstrap_lock
        trap - EXIT
        
        # 3. 安装依赖
        if [ "${GWM_SKIP_DEPS:-0}" != "1" ] && [ -f "$WT_PATH/package.json" ]; then
            echo -e "${CYAN}安装依赖...${NC}"
            cd "$WT_PATH"
            pnpm install --frozen-lockfile 2>/dev/null && \
            node scripts/ensure-electron.js 2>/dev/null && \
            node scripts/verify-worktree-deps.js 2>/dev/null && \
            echo -e "${GREEN}✓ 依赖就绪${NC}" || \
            echo -e "${YELLOW}⚠ 依赖安装有问题，请手动检查${NC}"
            cd "$REPO_ROOT"
        fi
        
        # 4. 输出结果
        echo ""
        echo -e "${GREEN}═══════════════════════════════════════${NC}"
        echo -e "${GREEN}任务就绪: $TASK_NAME${NC}"
        echo -e "${GREEN}───────────────────────────────────────${NC}"
        echo -e "Worktree: ${CYAN}$WT_PATH${NC}"
        echo -e "Branch:   ${CYAN}$BRANCH${NC}"
        echo -e "${GREEN}───────────────────────────────────────${NC}"
        echo -e "👉 ${YELLOW}cd $WT_PATH${NC}"
        echo -e "${GREEN}═══════════════════════════════════════${NC}"
        ;;
    
    list|ls)
        echo -e "${CYAN}=== Worktrees ===${NC}"
        git worktree list
        ;;
    
    status)
        echo -e "${CYAN}=== 主目录 ===${NC}"
        MAIN_BRANCH=$(git branch --show-current)
        MAIN_DIRTY=$(git status --porcelain | wc -l)
        echo -e "  分支: $MAIN_BRANCH"
        echo -e "  未提交: $MAIN_DIRTY 个文件"
        echo ""
        echo -e "${CYAN}=== Worktrees ===${NC}"
        git worktree list | while IFS= read -r line; do
            path=$(echo "$line" | awk '{print $1}')
            branch=$(echo "$line" | grep -oP '\[.*?\]' | tr -d '[]')
            if [ "$path" = "$REPO_ROOT" ]; then
                echo -e "  ${GREEN}* $path${NC} ($branch) — 主目录"
                continue
            fi
            cd "$path" 2>/dev/null || continue
            dirty=$(git status --porcelain 2>/dev/null | wc -l)
            cd "$REPO_ROOT"
            if [ "$dirty" -gt 0 ]; then
                echo -e "  ${YELLOW}● $path${NC} ($branch) — $dirty 个未提交"
            else
                echo -e "  ${GREEN}○ $path${NC} ($branch) — 干净"
            fi
        done
        ;;
    
    cleanup)
        "$BASH" "$SCRIPT_DIR/session-cleanup.sh" "${1:-}"
        ;;
    
    cleanup-all)
        "$BASH" "$SCRIPT_DIR/session-cleanup.sh" --all-safe
        ;;
    
    help|*)
        echo "gwm-task.sh — 任务生命周期管理（纯 git worktree，无外部依赖）"
        echo ""
        echo "用法:"
        echo "  bash scripts/gwm-task.sh start <task-name>   创建 worktree + 安装依赖"
        echo "  bash scripts/gwm-task.sh list                 列出所有 worktree"
        echo "  bash scripts/gwm-task.sh status               查看全局状态"
        echo "  bash scripts/gwm-task.sh cleanup [path]       清理指定 worktree"
        echo "  bash scripts/gwm-task.sh cleanup-all          清理所有干净 worktree"
        ;;
esac
