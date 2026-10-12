#!/bin/bash
# 分支守卫 + 质量节拍 pre-commit hook 集成测试
# 运行：bash scripts/hooks/pre-commit.test.sh（仓库任意位置）
# 场景：
#   1) 声明分支 == 当前分支，docs-only 提交 → 通过
#   2) 声明 main，当前分支 codex/x（事故场景复现，主工作区严格模式）→ 拦截，不产生提交
#   3) 无声明（主工作区严格模式）→ 拦截并提示声明命令
#   4) .quality-rhythm-pending 存在 → 拦截（保留原行为）
#   5) 代码文件变更 + wrapper 通过 → 通过
#   6) detached + rebase-merge 目录（rebase 重放模拟）→ 跳过断言，通过
#   7) 声明文件为空 → 拦截
#   8) detached 且无 rebase 目录 → 拦截（未指向命名分支）
#   9) wrapper 缺失 → 拦截（保留原行为）
#   10) 非代码扩展名（.ps1）变更 → 跳过 wrapper，通过
#   11) 真实 git rebase 重放 → 跳过断言，重放成功
#   12) 隔离 worktree：提交时自动声明当前分支（零手动步骤）→ 通过且声明=当前分支
#   13) 隔离 worktree：切分支后提交自动更新声明 → 通过且声明=新分支
#   14) 共享主目录事故 marker 存在 → 拦截
set -u

HOOK_SRC="$(cd "$(dirname "$0")" && pwd)/pre-commit"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/ccg-hook-test-XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
ok()  { echo "  PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL: $1"; FAIL=$((FAIL+1)); }

new_repo() {
    rm -rf "$TMP/repo" "$TMP/wt2"
    mkdir -p "$TMP/repo"
    git -C "$TMP/repo" init -q -b main 2>/dev/null || git -C "$TMP/repo" init -q
    if [ "$(git -C "$TMP/repo" branch --show-current 2>/dev/null)" != "main" ]; then
        git -C "$TMP/repo" symbolic-ref HEAD refs/heads/main
    fi
    git -C "$TMP/repo" config user.email hook-test@example.com
    git -C "$TMP/repo" config user.name "Hook Test"
    git -C "$TMP/repo" config commit.gpgsign false
    git -C "$TMP/repo" commit --allow-empty -q -m "base"
    # 安装待测 hook（在 base 提交之后；linked worktree 共享同一 hooks 目录）
    mkdir -p "$TMP/repo/scripts"
    cat > "$TMP/repo/scripts/quality-rhythm-wrapper.js" <<'EOF'
process.exit(0);
EOF
    cp "$HOOK_SRC" "$TMP/repo/.git/hooks/pre-commit"
    if command -v chmod >/dev/null 2>&1; then chmod +x "$TMP/repo/.git/hooks/pre-commit"; fi
}

declare_branch() {
    mkdir -p "$TMP/repo/.agent_context"
    printf '%s' "$1" > "$TMP/repo/.agent_context/expected-branch"
}

commit_expect_ok() {
    local label="$1"
    if git -C "$TMP/repo" commit -q -m "$label" 2>"$TMP/err.log"; then
        ok "$label"
    else
        bad "$label（应通过）：$(head -5 "$TMP/err.log" | tr '\n' ' ')"
    fi
}

commit_expect_block() {
    local label="$1"
    local pattern="$2"
    if git -C "$TMP/repo" commit -q -m "$label" 2>"$TMP/err.log"; then
        bad "$label（应拦截但通过了）"
    else
        if grep -q "$pattern" "$TMP/err.log"; then
            ok "$label（拦截并提示 $pattern）"
        else
            bad "$label（拦截但提示不符）：$(head -8 "$TMP/err.log" | tr '\n' ' ')"
        fi
        local head_msg
        head_msg="$(git -C "$TMP/repo" log -1 --format=%s)"
        if [ "$head_msg" != "$label" ]; then
            ok "$label（未产生提交）"
        else
            bad "$label（意外产生了提交）"
        fi
    fi
}

# 场景 1：声明=当前分支，docs-only 提交通过
scenario1() {
    new_repo
    declare_branch main
    echo "hello" > "$TMP/repo/docs.md"
    git -C "$TMP/repo" add docs.md
    commit_expect_ok "scenario1 docs-on-declared-branch"
}

# 场景 2：声明 main，当前分支 codex/x（事故场景）→ 拦截
scenario2() {
    new_repo
    declare_branch main
    git -C "$TMP/repo" switch -q -c codex/video-no-text-prompt-enhancement
    echo "hello" > "$TMP/repo/docs.md"
    git -C "$TMP/repo" add docs.md
    commit_expect_block "scenario2 wrong-branch-blocked" "主目录保护拦截"
}

# 场景 3：无声明（主工作区严格模式）→ 拦截
scenario3() {
    new_repo
    echo "hello" > "$TMP/repo/docs.md"
    git -C "$TMP/repo" add docs.md
    commit_expect_block "scenario3 no-declaration-blocked" "缺少会话分支声明"
}

# 场景 4：.quality-rhythm-pending → 拦截（保留原行为）
scenario4() {
    new_repo
    declare_branch main
    touch "$TMP/repo/.quality-rhythm-pending"
    echo "hello" > "$TMP/repo/docs.md"
    git -C "$TMP/repo" add docs.md
    commit_expect_block "scenario4 pending-flag-blocked" "未完成的质量节拍检查"
}

# 场景 5：代码文件变更 + wrapper 通过 → 通过
scenario5() {
    new_repo
    declare_branch main
    echo "module.exports = 1;" > "$TMP/repo/app.js"
    git -C "$TMP/repo" add app.js
    commit_expect_ok "scenario5 code-change-passed"
}

# 场景 6：detached + rebase-merge 目录（模拟 rebase 重放）→ 跳过断言，通过
scenario6() {
    new_repo
    declare_branch main
    git -C "$TMP/repo" switch -q --detach HEAD
    mkdir -p "$TMP/repo/.git/rebase-merge"
    echo "rebase note" > "$TMP/repo/note.txt"
    git -C "$TMP/repo" add note.txt
    commit_expect_ok "scenario6 rebase-dir-skip-passed"
}

# 场景 7：声明文件为空 → 拦截
scenario7() {
    new_repo
    mkdir -p "$TMP/repo/.agent_context"
    printf '\n' > "$TMP/repo/.agent_context/expected-branch"
    echo "hello" > "$TMP/repo/docs.md"
    git -C "$TMP/repo" add docs.md
    commit_expect_block "scenario7 empty-declaration-blocked" "内容为空"
}

# 场景 8：detached 且无 rebase 目录 → 拦截
scenario8() {
    new_repo
    declare_branch main
    git -C "$TMP/repo" switch -q --detach HEAD
    echo "note" > "$TMP/repo/note.txt"
    git -C "$TMP/repo" add note.txt
    commit_expect_block "scenario8 detached-no-rebase-blocked" "未指向任何命名分支"
}

# 场景 9：wrapper 缺失 → 拦截（保留原行为）
scenario9() {
    new_repo
    declare_branch main
    rm -f "$TMP/repo/scripts/quality-rhythm-wrapper.js"
    echo "module.exports = 1;" > "$TMP/repo/app.js"
    git -C "$TMP/repo" add app.js
    commit_expect_block "scenario9 wrapper-missing-blocked" "未找到质量节拍wrapper"
}

# 场景 10：非代码扩展名（.ps1）变更 → 跳过 wrapper，通过
scenario10() {
    new_repo
    declare_branch main
    echo "# ps1 note" > "$TMP/repo/note.ps1"
    git -C "$TMP/repo" add note.ps1
    commit_expect_ok "scenario10 noncode-ext-passed"
}

# 场景 11：真实 git rebase 重放 → 跳过断言，重放成功
scenario11() {
    new_repo
    declare_branch main
    git -C "$TMP/repo" worktree add -q "$TMP/wt2" -b feature
    mkdir -p "$TMP/wt2/scripts"
    cp "$TMP/repo/scripts/quality-rhythm-wrapper.js" "$TMP/wt2/scripts/quality-rhythm-wrapper.js"
    echo "a" > "$TMP/repo/m.txt"
    git -C "$TMP/repo" add m.txt
    git -C "$TMP/repo" commit -q -m "m1"
    echo "b" > "$TMP/wt2/f.txt"
    git -C "$TMP/wt2" add f.txt
    git -C "$TMP/wt2" commit -q -m "f1"
    if git -C "$TMP/wt2" rebase -q main 2>"$TMP/err.log"; then
        local cnt
        cnt="$(git -C "$TMP/wt2" log --oneline | wc -l | tr -d ' ')"
        if [ "$cnt" = "3" ]; then
            ok "scenario11 real-rebase-replay-passed"
        else
            bad "scenario11 rebase 成功但提交数异常（$cnt）：$(cat "$TMP/err.log")"
        fi
    else
        bad "scenario11 real-rebase-replay-failed：$(head -8 "$TMP/err.log" | tr '\n' ' ')"
    fi
}

# 场景 12：隔离 worktree 提交时自动声明当前分支（零手动步骤）→ 通过
scenario12() {
    new_repo
    git -C "$TMP/repo" worktree add -q "$TMP/wt2" -b feat2
    mkdir -p "$TMP/wt2/scripts"
    cp "$TMP/repo/scripts/quality-rhythm-wrapper.js" "$TMP/wt2/scripts/quality-rhythm-wrapper.js"
    echo "hello" > "$TMP/wt2/docs.md"
    git -C "$TMP/wt2" add docs.md
    if git -C "$TMP/wt2" commit -q -m "scenario12 isolated-auto-declare" 2>"$TMP/err.log"; then
        ok "scenario12 isolated-auto-declare-passed"
    else
        bad "scenario12 isolated-auto-declare（应通过）：$(head -5 "$TMP/err.log" | tr '\n' ' ')"
    fi
    local decl
    decl="$(cat "$TMP/wt2/.agent_context/expected-branch" 2>/dev/null || true)"
    if [ "$decl" = "feat2" ]; then
        ok "scenario12 auto-declared-branch=feat2"
    else
        bad "scenario12 auto-declared-branch（应为 feat2，实际: $decl）"
    fi
}

# 场景 13：隔离 worktree 切分支后提交自动更新声明 → 通过
scenario13() {
    new_repo
    git -C "$TMP/repo" worktree add -q "$TMP/wt2" -b feat2
    mkdir -p "$TMP/wt2/scripts"
    cp "$TMP/repo/scripts/quality-rhythm-wrapper.js" "$TMP/wt2/scripts/quality-rhythm-wrapper.js"
    echo "a" > "$TMP/wt2/a.md"
    git -C "$TMP/wt2" add a.md
    git -C "$TMP/wt2" commit -q -m "c1"
    git -C "$TMP/wt2" switch -q -c feat3
    echo "b" > "$TMP/wt2/b.md"
    git -C "$TMP/wt2" add b.md
    if git -C "$TMP/wt2" commit -q -m "scenario13 auto-update-on-switch" 2>"$TMP/err.log"; then
        ok "scenario13 auto-update-on-switch-passed"
    else
        bad "scenario13 auto-update-on-switch（应通过）：$(head -5 "$TMP/err.log" | tr '\n' ' ')"
    fi
    local decl
    decl="$(cat "$TMP/wt2/.agent_context/expected-branch" 2>/dev/null || true)"
    if [ "$decl" = "feat3" ]; then
        ok "scenario13 auto-updated-branch=feat3"
    else
        bad "scenario13 auto-updated-branch（应为 feat3，实际: $decl）"
    fi
}

# 场景 14：post-checkout 恢复失败留下 marker → pre-commit 必须持续拦截
scenario14() {
    new_repo
    declare_branch main
    mkdir -p "$TMP/repo/.agent_context"
    echo "shared root remains on feature" > "$TMP/repo/.agent_context/shared-root-violation"
    echo "hello" > "$TMP/repo/docs.md"
    git -C "$TMP/repo" add docs.md
    commit_expect_block "scenario14 shared-root-marker-blocked" "分支切换事故状态"
}

# 用例 15（判定记录自动入库，方案 A）：
#   pre-commit 跑 CCG 门禁后，应把本次生成的 .ccg/reviews/<sha>.json
#   stage 进同一个提交 —— 不再依赖有人记得 git add。
#   回归背景：2026-10-12 排查实测，22 小时内 10+ 任务在共享根与 36 个
#   worktree 堆积 300+ 未跟踪判定记录；因 squash 合并换 sha，
#   「文件名引用的提交已在 origin/main = 0」，结构性无法随 PR 入库。
scenario15() {
    new_repo
    declare_branch main
    # fixture 需要 scripts/ccg-gate.js 存在，钩子的 CCG 块（含 stage 循环）才会执行；
    # SKIP_CCG_GATE=1 让真门禁快速通过，stage 循环在门禁之后无条件跑。
    cat > "$TMP/repo/scripts/ccg-gate.js" <<'EOF'
process.exit(0);
EOF
    # 门禁通过（wrapper exit 0）后钩子应 stage 未跟踪的 .ccg/reviews 记录
    mkdir -p "$TMP/repo/.ccg/reviews"
    echo '{"sha":"placeholder"}' > "$TMP/repo/.ccg/reviews/deadbeef00000000000000000000000000000000.json"
    echo "hello" > "$TMP/repo/docs.md"
    git -C "$TMP/repo" add docs.md
    if SKIP_CCG_GATE=1 git -C "$TMP/repo" commit -q -m "scenario15 record-autostage" 2>"$TMP/err.log"; then
        ok "scenario15 commit-passed"
    else
        bad "scenario15 应通过（记录 stage 不应阻断提交）：$(head -5 "$TMP/err.log" | tr '\n' ' ')"
        return
    fi
    # 记录必须已随提交入库（不是留在未跟踪区）
    if git -C "$TMP/repo" ls-files --error-unmatch .ccg/reviews/deadbeef00000000000000000000000000000000.json >/dev/null 2>&1; then
        ok "scenario15 record-staged-into-commit"
    else
        bad "scenario15 判定记录未入库（仍在未跟踪区）—— 自动 stage 未生效"
    fi
    # 已跟踪且无改动的记录不应被重复 add（幂等性：二次提交不夹带）
    if SKIP_CCG_GATE=1 git -C "$TMP/repo" commit -q --allow-empty -m "scenario15 second" 2>"$TMP/err.log"; then
        local staged
        staged="$(git -C "$TMP/repo" show --name-only --format= HEAD | grep -c '.ccg/reviews' || true)"
        if [ "$staged" = "0" ]; then
            ok "scenario15 no-duplicate-staging"
        else
            bad "scenario15 二次提交夹带了 .ccg/reviews（$staged 个）—— 幂等失效"
        fi
    else
        bad "scenario15 second-commit-failed：$(head -5 "$TMP/err.log" | tr '\n' ' ')"
    fi
}

scenario1
scenario2
scenario3
scenario4
scenario5
scenario6
scenario7
scenario8
scenario9
scenario10
scenario11
scenario12
scenario13
scenario14
scenario15

echo "----"
echo "结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
