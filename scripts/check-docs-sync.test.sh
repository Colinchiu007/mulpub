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

# 环境免疫（2026-10-18 实测）：调用方若导出了 MSYS 的路径转换开关，本文件里的
# `/tmp/tmp.XXXX` 会**同时**被 bash（MSYS 根）与原生 git.exe（把 `/tmp/…` 当盘内路径）
# 解析成两个不同位置 —— 于是 `echo seed > "$dir/README.md"` 与 `git -C "$dir" add -A`
# 量的不是同一个目录，seed 提交变成空的，而 git 打印的 status 原文又被
# `repo="$(make_repo …)"` 一起吞进变量。A/B 实测：继承 `MSYS_NO_PATHCONV=1`
# ⇒ 8/8 用例红 + 工作树落 5 个畸形目录名的未跟踪文件；不继承 ⇒ 全绿零残留。
# 夹具绑定的是本机 shell 与原生 git 的**同一套**路径语义，这一维不由调用方决定，
# 所以在入口把它按本文件的需要钉死（同族纪律见 AGENTS「断言 git status 干净度的
# 测试夹具，必须自己声明 EOL 档并把索引交给 checkout」—— 都是"夹具的前提由夹具自己定"）。
unset MSYS_NO_PATHCONV MSYS2_ARG_CONV_EXCL

# 隔离锁（2026-10-18）：夹具只准落在 $TMP 内。先记下 cwd 的条目清单，收尾逐条对账，
# 出现任何新增条目即 FATAL。动因是实测到的泄漏链：make_repo 的 stdout 没有隔离，
# 一旦被环境带偏（实测继承 MSYS_NO_PATHCONV=1 时原生 git 与 bash 对 /tmp 的解析不同），
# `repo="$(make_repo …)"` 就会把 git 的 status/error 文本一起吞进变量，随后的
# `mkdir -p "$repo/…"` 变成**相对 cwd** 建目录写文件 —— 实测在工作树里落了 11 个未跟踪文件，
# 目录名就是那段 status 原文；而各 case 的 rc 判据当时照报 PASS。
# 这是 AGENTS「文件系统测试隔离」缺机械判据的直接后果，判据本身不得只靠自觉。
CWD_BEFORE="$TMP/cwd-before.txt"
ls -1A | sort > "$CWD_BEFORE"

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
  # 这个函数的**唯一** stdout 出口是最后那行 `printf '%s' "$dir"`。
  # 每条 git 调用的 stdout 都必须关掉：调用方是 `repo="$(make_repo …)"`，
  # 命令替换会把函数写进 stdout 的一切拼成一个字符串 —— 实测 git 在 seed 提交
  # 空转时打印的 "On branch main / Initial commit / nothing to commit …" 就顺着
  # 这条路进了 $repo，之后的 mkdir/写入因此全部落到 cwd 里（详见上面的「环境免疫」）。
  tgit init -q --bare -b main "$dir.git" > /dev/null
  tgit init -q -b main "$dir" > /dev/null
  tgit -C "$dir" remote add origin "$dir.git" > /dev/null
  echo seed > "$dir/README.md"
  tgit -C "$dir" add -A > /dev/null
  tgit -C "$dir" commit -q -m seed > /dev/null
  tgit -C "$dir" push -q origin main > /dev/null 2>&1
  printf '%s' "$dir"
}

# run_case <名称> <期望退出码> <变更文件...>
run_case() {
  local name="$1" want="$2"
  shift 2
  CASE=$((CASE + 1))
  local repo
  repo="$(make_repo "case-$CASE")"
  # fail-closed 前置闸：夹具路径必须逐字等于 $TMP/case-<n>，**在任何写入之前**判。
  # 顺序即判据的一半 —— 这条若放在 mkdir 之后，污染已经落盘了才报错。
  if [ "$repo" != "$TMP/case-$CASE" ]; then
    echo "FATAL: case-$CASE 取到的夹具路径不是 \$TMP/case-$CASE ⇒ make_repo 的 stdout 被污染，拒绝写入"
    printf '       取到=%q\n' "$repo" | head -c 400
    echo ""
    exit 1
  fi
  local f
  for f in "$@"; do
    mkdir -p "$repo/$(dirname "$f")"
    echo changed > "$repo/$f"
  done
  tgit -C "$repo" checkout -q -b feat
  tgit -C "$repo" add -A
  tgit -C "$repo" commit -q -m change
  # 夹具完整性自检：用例的成败只有建立在"seed + change 两个提交真的存在"上才有意义。
  # 缺这一条时，夹具退化成空目录，被检方照样能给出一个 rc，于是"PASS"测的是
  # 一个从没发生过的仓库状态（实测 p124 那次就是这样照报 PASS 的）。
  if ! tgit -C "$repo" rev-parse -q --verify HEAD > /dev/null; then
    echo "FATAL: case-$CASE 的夹具没有任何提交 ⇒ 该用例量的不是夹具而是空目录，拒绝判 PASS"
    exit 1
  fi
  if ! tgit -C "$repo" ls-files | grep -qx 'README.md'; then
    echo "FATAL: case-$CASE 的 seed 文件 README.md 没进索引 ⇒ seed 提交是空的（多半是路径解析或 ignore 规则所致）"
    exit 1
  fi
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

# 隔离锁对账：必须在汇总判定**之前**发生 —— 泄漏与用例成败是两件事，
# 排在 exit 之后就等于给"用例全绿但把垃圾写进工作树"这条路径让了路。
LEAKED="$(comm -13 "$CWD_BEFORE" <(ls -1A | sort) | head -n 20)"
if [ -n "$LEAKED" ]; then
  echo "FATAL: 夹具泄漏到 cwd（本该只落在 $TMP 内），新增条目："
  printf '%s\n' "$LEAKED" | sed 's/^/      | /'
  echo "FATAL: 这通常意味着 make_repo 的 stdout 被污染，夹具路径已不是 \$TMP 下的那一个"
  exit 1
fi

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "PASS: $PASSED docs-sync gate checks"
  exit 0
fi
echo "FAILED: $FAILED / $((PASSED + FAILED)) docs-sync gate checks"
exit 1
