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

# 场景 16：判定记录自动 stage 的进程创建次数不得随记录数增长（规模锁 / 本 Bug 的红）
#   回归背景（2026-10-15 本机实测）：旧实现对 .ccg/reviews/*.json 逐文件 fork git，
#   每个文件 2~3 次调用；拥堵现场单次进程创建均值 1,175ms（原生 cmd.exe /c exit 同值，
#   与 git/仓库/MSYS 无关），记录累积到数百个时单次提交需 24-30 分钟，
#   并发提交互为正反馈：13 条链各跑约 1,200 次进程创建，机器 CPU 打满而 git commit 自身 CPU≈0。
#   风暴排空后同法复测单次仅 53ms ⇒ 1,175ms 是并发放大的读数、不是机器常数。本锁因此只数
#   **git 调用条数**而非墙钟：条数与负载无关，墙钟会随拥堵度自己弹，用墙钟当判据必然不稳定。
#   三向约束缺一不可：同成本（N=2 与 N=200 调用数逐字相等）+ 有预算（argv 含 .ccg/reviews 的调用 ≤3）
#   + 仍有效（200 条记录确实入库）——只断言前两条会被「什么都不做」的实现满足。
#   探针函数只打印、不调用 ok/bad：命令替换是子 shell，FAIL 计数会丢。
scenario16() {
    local real_git shim stotal_tab btotal_tab stotal sscoped scommitted btotal bscoped bcommitted
    local s_fixed s_scan s_batch b_fixed b_scan b_batch
    real_git="$(command -v git)"
    shim="$TMP/shim16"
    mkdir -p "$shim"
    # 计数 shim 只截住钩子内部裸调的 git；测试驱动一律用 $real_git 绝对路径调用，
    # 否则会把驱动自己的调用算进计数，虚高的基线让「同成本」这条永远不等。
    cat > "$shim/git" <<EOF
#!/bin/bash
printf '%s\n' "\$*" >> "$TMP/git16.log"
exec "$real_git" "\$@"
EOF
    chmod +x "$shim/git"

    # 输出：<git调用总数>\t<其中argv含.ccg/reviews的条数>\t<暂存记录数>；失败输出 COMMIT_FAIL
    #
    # ⛔ 为什么这里直接调用钩子脚本、而不是跑一次真 git commit：
    # Git for Windows 生成钩子时会把 /mingw64/libexec/git-core **前置**到 PATH，
    # 于是钩子内部的裸 `git` 永远解析到真实 git，PATH 前置的计数 shim 一条也捕不到。
    # 实测对照：经 `git commit` 触发 ⇒ shim 0 行；直接 bash 钩子 ⇒ shim 捕到 argv 可见的调用。
    # 若不改直接调用，下面的计数恒为 0，「0 == 0」会把「探针失明」读成「成本恒定」——
    # 那正是本锁要防的形态被一把绿灯埋掉的复刻。真 commit 的接线由场景 1–15 覆盖。
    probe() {
        local n="$1" i total scoped staged
        : > "$TMP/git16.log"
        new_repo
        declare_branch main
        cat > "$TMP/repo/scripts/ccg-gate.js" <<'GEOF'
process.exit(0);
GEOF
        mkdir -p "$TMP/repo/.ccg/reviews"
        for ((i = 1; i <= n; i++)); do printf '{"i":%d}\n' "$i" > "$TMP/repo/.ccg/reviews/r$i.json"; done
        printf 'hello\n' > "$TMP/repo/docs.md"
        "$real_git" -C "$TMP/repo" add docs.md
        if ! ( cd "$TMP/repo" && PATH="$shim:$PATH" SKIP_CCG_GATE=1 bash .git/hooks/pre-commit >/dev/null ) 2>"$TMP/err.log"; then
            printf 'COMMIT_FAIL\n'
            return 1
        fi
        total="$(wc -l < "$TMP/git16.log" | tr -d ' ')"
        scoped="$(grep -c -- '.ccg/reviews' "$TMP/git16.log")"
        [ -z "$scoped" ] && scoped=0
        # 三条内容级存活/路径证据，取代写死的调用数下界（见下方 probe-alive）：
        #   saw_fixed  计数通路确实看见了钩子的固定段调用（证明 shim 在链路上）
        #   saw_scan  未跟踪扫描真被发起（证明候选集来自 git 视图而非盘上 glob）
        #   saw_batch 批量 add 真被走到（证明没有静默退化成逐条回退）
        saw_fixed=0; grep -q 'rev-parse --git-dir' "$TMP/git16.log" && saw_fixed=1
        saw_scan=0; grep -q 'ls-files --others --exclude-standard' "$TMP/git16.log" && saw_scan=1
        saw_batch=0; grep -q -- '--pathspec-from-file=-' "$TMP/git16.log" && saw_batch=1
        staged="$(cd "$TMP/repo" && "$real_git" diff --cached --name-only | grep -c '.ccg/reviews/r' || true)"
        printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$total" "$scoped" "$staged" "$saw_fixed" "$saw_scan" "$saw_batch"
    }

    if ! stotal_tab="$(probe 2)"; then bad "scenario16 小样本提交失败"; return; fi
    if ! btotal_tab="$(probe 200)"; then
        bad "scenario16 大样本提交失败：$(head -3 "$TMP/err.log" | tr '\n' ' ')"
        return
    fi
    IFS=$'\t' read -r stotal sscoped scommitted s_fixed s_scan s_batch <<< "$stotal_tab"
    IFS=$'\t' read -r btotal bscoped bcommitted b_fixed b_scan b_batch <<< "$btotal_tab"
    # 关键实测值必须出声，否则下次没人知道这条锁测过什么
    echo "  [scenario16] N=2   git_calls=$stotal reviews_scoped=$sscoped staged=$scommitted fixed=$s_fixed scan=$s_scan batch=$s_batch"
    echo "  [scenario16] N=200 git_calls=$btotal reviews_scoped=$bscoped staged=$bcommitted fixed=$b_fixed scan=$b_scan batch=$b_batch"

    # 正控（只证「计数通路活着」，且**与实现形态无关**）：
    #   旧写法是 `>= 6`，那个 6 等于钩子固定段的调用条数 —— 任一固定段少一次 git 调用就会让整条锁
    #   因夹具膨胀而红，逼后人上调魔数自愈（QM-6 i4）。改成断言「看见了某条具体 argv」。
    #   ⚠ 这里刻意只看固定段的 rev-parse：把「新形态才有的 --others 扫描」折进存活判据，会让
    #   退回旧实现时在这条先红并 return，于是「规模失控」那条主判据根本没被评估 —— 变异 M2
    #   的指名红集就这么被自己截断了（形态判据与存活判据混用的代价，实测撞出来的）。
    if [ "$s_fixed" = 1 ] && [ "$b_fixed" = 1 ]; then
        ok "scenario16 probe-alive（按内容证实看见钩子自身的 rev-parse，非探针失明）"
    else
        bad "scenario16 计数通路失明（saw_fixed=$s_fixed/$b_fixed）——下面的结论一律不可采信；先修夹具，别改判据"
        return
    fi
    # 以下两条是**形态**判据（不是存活判据）：退回旧实现时它们应当各自变红，
    # 但仍不得阻断「同成本」这条主判据的评估。
    if [ "$s_scan" = 1 ] && [ "$b_scan" = 1 ]; then
        ok "scenario16 scan-from-git-view（候选集来自 ls-files --others，而非盘上 glob）"
    else
        bad "scenario16 候选集未取自 git 视图（saw_scan=$s_scan/$b_scan）——盘上 glob 会让成本随树上记录数增长"
    fi
    # 批量路径必须真被走到：否则「静默退化成逐条回退」会让 O(N) 风暴原地复活而全绿
    # （QM-6 i2：--pathspec-from-file 需 git>=2.25，本机可用不代表所有机器可用）
    if [ "$s_batch" = 1 ] && [ "$b_batch" = 1 ]; then
        ok "scenario16 batch-path-taken（批量 add 实际被调用，未退化逐条回退）"
    else
        bad "scenario16 批量 add 未被走到（saw_batch=$s_batch/$b_batch）⇒ 已静默退化成逐条暂存，成本锁形同虚设"
    fi


    if [ "$stotal" = "$btotal" ]; then
        ok "scenario16 scale-locked（进程创建次数不随记录数增长：$stotal == $btotal）"
    else
        bad "scenario16 规模失控：N=2 用 $stotal 次、N=200 用 $btotal 次（差 $((btotal - stotal))）——逐文件 fork git 会随记录数线性放大"
    fi
    if [ "$bscoped" -le 3 ]; then
        ok "scenario16 budget-ok（含 .ccg/reviews 的调用 $bscoped ≤ 3）"
    else
        bad "scenario16 预算超标：含 .ccg/reviews 的调用 $bscoped 个（应 ≤3，即整目录扫描的常数次）"
    fi
    if [ "$bcommitted" = "200" ] && [ "$scommitted" = "2" ]; then
        ok "scenario16 still-effective（记录确实被暂存：N=2→$scommitted / N=200→$bcommitted）"
    else
        bad "scenario16 记录未全量暂存（N=2→$scommitted 期望2 / N=200→$bcommitted 期望200）——规模锁不得靠少干活来达标"
    fi
}

# 场景 17：自动暂存的**精确集合**锁（补 scenario16 只管成本不管范围的空洞）
#   为什么单独一条：规模锁的四条断言对「把所有记录无差别 git add 一遍」这种错误实现
#   完全免疫——它同样只花常数次调用、同样让未跟踪记录入库。范围语义必须由本条独立守住：
#     ① 未跟踪的记录必须一条不少地纳入（"已跟踪且无改动者不得被重加"这条不可观察——
#        对干净文件 git add 是 no-op，其代价由 scenario16 的成本锁承担）
#     ② 非 .json 文件（同目录下的 brief）MUST NOT 进入候选，即使它已被改动
#     ③ 含空格与非 ASCII 的文件名 MUST 作为一个整体入库（这条同时反证 -z/NUL 不能退回换行分隔：
#        换行形态下 git 默认会把非 ASCII 路径引用成 "...\345\222\214..." 字面量，add 必然失配）
#   夹具对三种状态预置不同内容；若 mock 对所有输入同形，「按输入区分」这一类缺陷对它免疫。
scenario17() {
    local real_git expected actual i
    real_git="$(command -v git)"
    new_repo
    declare_branch main
    cat > "$TMP/repo/scripts/ccg-gate.js" <<'GEOF'
process.exit(0);
GEOF
    mkdir -p "$TMP/repo/.ccg/reviews"
    for i in 1 2; do printf '{"m":%d}\n' "$i" > "$TMP/repo/.ccg/reviews/m$i.json"; done
    for i in 1 2 3 4 5; do printf '{"c":%d}\n' "$i" > "$TMP/repo/.ccg/reviews/c$i.json"; done
    printf 'brief\n' > "$TMP/repo/.ccg/reviews/keep.md"
    # 嵌套子目录成员：旧形态的 shell glob 取不到它们（* 不跨 /），新形态若用裸 pathspec 会取到
    mkdir -p "$TMP/repo/.ccg/reviews/inner"
    printf '{"n":1}\n' > "$TMP/repo/.ccg/reviews/inner/nm.json"
    printf '{"n":2}\n' > "$TMP/repo/.ccg/reviews/inner/nc.json"
    printf '{"a":1}\n' > "$TMP/repo/.ccg/reviews/with space 和中文.json"
    printf 'base\n' > "$TMP/repo/docs.md"
    git -C "$TMP/repo" add -A
    if ! git -C "$TMP/repo" commit -q -m "scenario17 base" 2>"$TMP/err.log"; then
        bad "scenario17 基线提交失败：$(head -3 "$TMP/err.log" | tr '\n' ' ')"
        return
    fi
    for i in 1 2; do printf '{"m":%d,"dirty":1}\n' "$i" > "$TMP/repo/.ccg/reviews/m$i.json"; done
    printf 'brief changed\n' > "$TMP/repo/.ccg/reviews/keep.md"
    printf '{"a":2}\n' > "$TMP/repo/.ccg/reviews/with space 和中文.json"
    for i in 1 2 3; do printf '{"u":%d}\n' "$i" > "$TMP/repo/.ccg/reviews/u$i.json"; done
    printf '{"n":1,"dirty":1}\n' > "$TMP/repo/.ccg/reviews/inner/nm.json"
    printf '{"u":9}\n' > "$TMP/repo/.ccg/reviews/inner/nu.json"
    if ! ( cd "$TMP/repo" && SKIP_CCG_GATE=1 bash .git/hooks/pre-commit >/dev/null ) 2>"$TMP/err.log"; then
        bad "scenario17 钩子执行失败：$(head -3 "$TMP/err.log" | tr '\n' ' ')"
        return
    fi

    actual="$(cd "$TMP/repo" && "$real_git" -c core.quotePath=false diff --cached --name-only -z | tr '\0' '\n' | LC_ALL=C sort | tr '\n' '|')"
    expected="$(printf '%s\n' \
        '.ccg/reviews/m1.json' '.ccg/reviews/m2.json' \
        '.ccg/reviews/u1.json' '.ccg/reviews/u2.json' '.ccg/reviews/u3.json' \
        '.ccg/reviews/with space 和中文.json' | LC_ALL=C sort | tr '\n' '|')"
    echo "  [scenario17] expected=$expected"
    echo "  [scenario17] actual  =$actual"
    if [ "$actual" = "$expected" ]; then
        ok "scenario17 exact-set（暂存集合与预期逐字相同）"
    else
        bad "scenario17 暂存集合与预期不符 —— 规模达标不等于范围正确"
    fi
    # 分条定位，避免只报「不等」让下一个读者去猜差在哪一类。
    # 注意这里刻意【不】断言「已跟踪且无改动的记录没被重加」：对干净文件执行 git add 是 no-op，
    # 暂存集里根本不会出现它，该性质在提交内容上不可观察 —— 断言它等于写一条永远绿的装饰性判据。
    # 它的可观察对应物是「未跟踪记录必须一条不少地被纳入」，由下面这条承担（漏一条即红）。
    case "$actual" in
        *'.ccg/reviews/u3.json'*) ok "scenario17 untracked-all-captured" ;;
        *) bad "scenario17 未跟踪记录有遗漏（u3 未入库）——候选集漏了 git 视图的一半" ;;
    esac
    case "$actual" in
        *'keep.md'*) bad "scenario17 把非 .json 的 keep.md 纳入候选（pathspec 越界）" ;;
        *) ok "scenario17 non-json-out-of-scope" ;;
    esac
    case "$actual" in
        *'和中文.json'*) ok "scenario17 odd-filename-staged-atomically" ;;
        *) bad "scenario17 含空格/中文的记录未入库（NUL 分隔或引用形态被破坏）" ;;
    esac
    # 嵌套成员必须整类排除：裸 pathspec 的 * 跨 /，会把 inner/*.json 纳入候选，
    # 使新形态成为旧集合的超集（spec「恰好等于旧集合」那条 MUST 被静默扩大）。
    case "$actual" in
        *'inner/'*) bad "scenario17 把子目录里的 json 纳入候选（pathspec 的 * 跨了 /，域比旧 shell glob 大）" ;;
        *) ok "scenario17 nested-out-of-domain" ;;
    esac
}

# 场景 18：批量 add 失败 MUST 回退逐条并出声（保留旧「单条失败不阻断提交」语义）
#   注入手段：PATH shim 只让带 --pathspec-from-file 的那一次调用失败，其余原样转发。
#   若实现删掉回退分支、或回退了却不告警，本条必须变红——否则那是一段无人走过的死代码。
scenario18() {
    local real_git shim out staged i
    real_git="$(command -v git)"
    shim="$TMP/shim18"
    mkdir -p "$shim"
    : > "$TMP/git18.log"
    # 注入的这一次也要先记日志再退出：钩子对批量 add 显式写了 2>/dev/null（设计上不把 git
    # 原始 stderr 喷给用户），所以「命中」只能从 shim 日志取，不能从钩子输出取——
    # 用 stderr 做正控会因该抑制而恒不命中，把夹具错误伪装成实现缺陷。
    cat > "$shim/git" <<EOF
#!/bin/bash
printf '%s\n' "SHIM \$*" >> "$TMP/git18.log"
case "\$*" in
  *--pathspec-from-file*) echo "injected: batch add denied" >&2; exit 1;;
esac
exec "$real_git" "\$@"
EOF
    chmod +x "$shim/git"

    new_repo
    declare_branch main
    cat > "$TMP/repo/scripts/ccg-gate.js" <<'GEOF'
process.exit(0);
GEOF
    mkdir -p "$TMP/repo/.ccg/reviews"
    for i in 1 2 3; do printf '{"u":%d}\n' "$i" > "$TMP/repo/.ccg/reviews/v$i.json"; done
    printf 'hello\n' > "$TMP/repo/docs.md"
    git -C "$TMP/repo" add docs.md
    out="$( ( cd "$TMP/repo" && PATH="$shim:$PATH" SKIP_CCG_GATE=1 bash .git/hooks/pre-commit ) 2>&1 )"
    # 正控：注入确实打中了那一次批量调用，且回退分支真的逐条走了一遍。
    # 两条都取自 shim 日志（钩子会抑制批量调用的 stderr，取输出必然恒不命中）。
    if grep -q -- '--pathspec-from-file' "$TMP/git18.log"; then
        ok "scenario18 injection-hit（批量这一步确实被走到并被拒）"
    else
        bad "scenario18 注入未命中批量调用 —— 下面结论不可采信，先修夹具别改判据"
        return
    fi
    local fallback_count
    fallback_count="$(grep -c 'SHIM add -- .ccg/reviews/v' "$TMP/git18.log")"
    if [ "$fallback_count" = "3" ]; then
        ok "scenario18 fallback-walked（回退分支真的逐条执行了 3 次，不是死代码）"
    else
        bad "scenario18 回退分支未被走到（per-file add 次数=$fallback_count 期望3）"
    fi
    if printf '%s' "$out" | grep -q '已回退逐条'; then
        ok "scenario18 fallback-spoken（回退有告警，不会静默退化）"
    else
        bad "scenario18 批量失败后未出声告警 —— 静默退化等于本 PR 的修复从未生效"
    fi
    staged="$(cd "$TMP/repo" && "$real_git" -c core.quotePath=false diff --cached --name-only -z | tr '\0' '\n' | grep -c '.ccg/reviews/v' || true)"
    if [ "$staged" = "3" ]; then
        ok "scenario18 fallback-effective（回退后 3 条记录仍全部暂存）"
    else
        bad "scenario18 回退未补齐记录（staged=$staged 期望3）——批量一败就整批丢记录"
    fi
}

# 场景 19：扫描失败必须被点名，且不得静默当成「没有记录要暂存」（QM-6 i5 的回归保护）
#   为什么单独一条：i5 修的是「两次扫描带 2>/dev/null 把 index 损坏等真失败压成空集」。
#   修完之后若没有这条锁，把 2>/dev/null 加回去**所有既有锁一律无反应**——实测 M6 变异
#   （重新吞掉扫描 stderr 且忽略退出码）在 scenario16/17/18 上 PASS=6 FAIL=0，
#   即「修复本身裸奔无保护」。这条锁同时要求：失败被说出来、不发起批量 add、提交不被阻断。
scenario19() {
    local real_git shim out scanned_batch
    real_git="$(command -v git)"
    shim="$TMP/shim19"
    mkdir -p "$shim"
    : > "$TMP/git19.log"
    cat > "$shim/git" <<EOF
#!/bin/bash
printf '%s\n' "SHIM \$*" >> "$TMP/git19.log"
case "\$*" in
  *ls-files*--others*) echo "injected: scan broken" >&2; exit 1;;
esac
exec "$real_git" "\$@"
EOF
    chmod +x "$shim/git"

    new_repo
    declare_branch main
    printf 'process.exit(0);\n' > "$TMP/repo/scripts/quality-rhythm-wrapper.js"
    cat > "$TMP/repo/scripts/ccg-gate.js" <<'GEOF'
process.exit(0);
GEOF
    mkdir -p "$TMP/repo/.ccg/reviews"
    printf '{"u":1}\n' > "$TMP/repo/.ccg/reviews/w1.json"
    printf '{"u":2}\n' > "$TMP/repo/.ccg/reviews/w2.json"
    printf 'hello\n' > "$TMP/repo/docs.md"
    git -C "$TMP/repo" add docs.md
    out="$( ( cd "$TMP/repo" && PATH="$shim:$PATH" SKIP_CCG_GATE=1 bash .git/hooks/pre-commit ) 2>&1 )"

    # 正控：注入必须真打到那条未跟踪扫描，否则本条测的是"一切正常"
    if grep -q 'ls-files --others' "$TMP/git19.log"; then
        ok "scenario19 injection-hit（未跟踪扫描确实被注入失败）"
    else
        bad "scenario19 注入未命中扫描调用 —— 下面结论不可采信，先修夹具"
        return
    fi
    if printf '%s' "$out" | grep -q '扫描失败'; then
        ok "scenario19 failure-spoken（扫描失败被点名，未被压成空集）"
    else
        bad "scenario19 扫描失败被静默吞掉 ⇒ 判定记录会无声滞留未跟踪区，正是 #3396 要消除的形态"
    fi
    if printf '%s' "$out" | grep -q '下界'; then
        ok "scenario19 loss-reported-as-bound（放弃条数被明确标为下界，不冒充损失量）"
    else
        bad "scenario19 把放弃条数写成确定值 —— count=0 会被读成「一条没丢」，而扫描失败时真实损失不可知（该侧文件被 > 截断后再无写入，实测读数恒 0）"
    fi
    # 契约是「失败侧的清单不得入库」，不是「不发起 add」——后者会把 i1 批评的"一侧失败弃掉两侧"
    # 重新变成正确行为。本夹具里两条记录都属未跟踪侧（失败的那侧），故最终必须 0 条入库。
    staged_rev="$(cd "$TMP/repo" && "$real_git" diff --cached --name-only | grep -c '.ccg/reviews/w' || true)"
    if [ "$staged_rev" = "0" ]; then
        ok "scenario19 no-partial-list-staged（失败侧的半截清单没有进入暂存）"
    else
        bad "scenario19 失败侧清单仍被暂存（$staged_rev 条）——按不可信的扫描结果入库"
    fi
    # 健康侧不受牵连：另造一条「已在 index 且工作树已改动」的记录，验证未跟踪扫描失败时它照常入库。
    # 刻意不用 commit/--no-verify —— 本仓任何情况下禁止 --no-verify，而 git add 后改工作树文件
    # 就已构成 index≠worktree 的"已跟踪且已改动"状态，不需要真的提交一次。
    printf '{"m":2}\n' > "$TMP/repo/.ccg/reviews/c0.json"
    git -C "$TMP/repo" add .ccg/reviews/c0.json
    printf '{"m":3}\n' > "$TMP/repo/.ccg/reviews/c0.json"
    if ( cd "$TMP/repo" && PATH="$shim:$PATH" SKIP_CCG_GATE=1 bash .git/hooks/pre-commit >/dev/null ) 2>&1; then
        healthy="$(cd "$TMP/repo" && "$real_git" diff --cached --name-only | grep -c '.ccg/reviews/c0.json' || true)"
        if [ "$healthy" = "1" ]; then
            ok "scenario19 healthy-side-independent（未跟踪侧扫描失败，已改动侧仍正常暂存）"
        else
            bad "scenario19 健康侧被连带弃掉（c0.json 未暂存）——正是「一侧失败弃两侧」的不对称放大"
        fi
    else
        bad "scenario19 第二次钩子执行失败"
    fi
}


# 场景 20：回退逐条的成本必须由「本次真要暂存的条数」驱动，不得由「树上记录数」驱动（QM-6 第三轮 i2）
#   待反驳的主张：「凡 git<2.25 或 --pathspec-from-file 被禁的环境，每次提交永久回到 O(N)，全套测试仍绿」。
#   旧形态的 N 是【盘上全部记录】（origin/main 该目录实测 696 个文件，1,218 次调用全部用来发现「无事可做」）；
#   新形态的回退循环遍历 git 视图给出的候选（未跟踪 ∪ 已改动），已跟踪且干净的记录根本不进候选。
#   所以最坏情况 = 真正需要暂存的条数，那是不可约的最小工作量，不是「退回旧形态」。
#   本条把这句话钉成读数：树上恒 200 条干净记录，新增 1 条 ⇒ 逐条 add 恰 1 次；新增 2 条 ⇒ 恰 2 次。
#   两档都出声打印现场——只报「通过」的话，下一个读者分不清「计数为 1」与「探针恒 0」。
scenario20() {
    local real_git shim n
    real_git="$(command -v git)"
    shim="$TMP/shim20"
    mkdir -p "$shim"
    cat > "$shim/git" <<EOF
#!/bin/bash
printf '%s\n' "SHIM \$*" >> "$TMP/git20.log"
case "\$*" in
  *--pathspec-from-file*) echo "injected: batch add denied" >&2; exit 1;;
esac
exec "$real_git" "\$@"
EOF
    chmod +x "$shim/git"

    # run20 <新增条数>：读数写进全局 A1/A2/S1/S2（刻意不用 local——调用方要读它）
    run20() {
        n="$1"
        : > "$TMP/git20.log"
        new_repo
        declare_branch main
        cat > "$TMP/repo/scripts/ccg-gate.js" <<'GEOF'
process.exit(0);
GEOF
        mkdir -p "$TMP/repo/.ccg/reviews"
        for i in $(seq 1 200); do printf '{"c":%d}\n' "$i" > "$TMP/repo/.ccg/reviews/c$i.json"; done
        printf 'hello\n' > "$TMP/repo/docs.md"
        git -C "$TMP/repo" add -A
        if ! git -C "$TMP/repo" commit -q -m "scenario20 base" 2>"$TMP/err.log"; then
            bad "scenario20 基线提交失败：$(head -3 "$TMP/err.log" | tr '\n' ' ')"
            return 1
        fi
        for i in $(seq 1 "$n"); do printf '{"u":%d}\n' "$i" > "$TMP/repo/.ccg/reviews/new$i.json"; done
        if ! ( cd "$TMP/repo" && PATH="$shim:$PATH" SKIP_CCG_GATE=1 bash .git/hooks/pre-commit >/dev/null ) 2>"$TMP/err.log"; then
            bad "scenario20 钩子执行失败：$(head -3 "$TMP/err.log" | tr '\n' ' ')"
            return 1
        fi
        if ! grep -q -- '--pathspec-from-file' "$TMP/git20.log"; then
            bad "scenario20 n=$n 注入未命中批量调用 —— 下面的计数一律不可采信，先修夹具别改判据"
            return 1
        fi
        adds="$(grep -c 'SHIM add -- .ccg/reviews/' "$TMP/git20.log")"
        staged="$(cd "$TMP/repo" && "$real_git" -c core.quotePath=false diff --cached --name-only | grep -c '.ccg/reviews/new' || true)"
        echo "  [scenario20] tree_records=200 new=$n per_file_adds=$adds staged=$staged"
        if [ "$n" = "1" ]; then A1="$adds"; S1="$staged"; else A2="$adds"; S2="$staged"; fi
        return 0
    }

    if ! run20 1; then return; fi
    if ! run20 2; then return; fi
    # 主判据：逐条 add 次数 == 真要暂存的条数（与树上那 200 条无关）
    if [ "${A1:-unset}" = "1" ] && [ "${A2:-unset}" = "2" ]; then
        ok "scenario20 fallback-scales-with-work（回退成本跟新增条数走：1→1 / 2→2，与树上 200 条无关）"
    else
        bad "scenario20 回退成本不按候选数走（1→${A1:-unset} / 2→${A2:-unset}）——出现 200/201 即是退回盘上全集"
    fi
    if [ "${S1:-unset}" = "1" ] && [ "${S2:-unset}" = "2" ]; then
        ok "scenario20 fallback-effective-at-both-scales（两档都补齐记录，回退不是只走形式）"
    else
        bad "scenario20 回退未补齐记录（staged ${S1:-unset}/${S2:-unset} 期望 1/2）"
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
scenario16
scenario17
scenario18
scenario19
scenario20

echo "----"
echo "结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
