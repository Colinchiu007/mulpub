#!/bin/sh
# 质量节拍 — CCG 深度双模型审查 · 本地入口
#
# 分层（SKILL.md §5.6.2）：
#   提交时  pre-commit  → ccg-review-decider.js  确定性判定，毫秒级
#   推送前  本脚本       → ccg-deep-review.js     双模型多轮对抗，分钟级
#
# 深度审查【不进 CI】：实测单次真实代码审查 >15 分钟，挂成 required check
# 会把仓库锁死。它是本地跑、结果落盘进 PR 的人工把关环节。
#
# 用法：
#   sh scripts/deep-review.sh              # 读 HEAD 的判定记录，按 mode 决定跑不跑
#   sh scripts/deep-review.sh --force      # 想强制审查：验证层**不会强制**（mode 由驱动从判定记录自己读）
#   sh scripts/deep-review.sh --evidence https://github.com/<owner>/<repo>/pull/<n>#issuecomment-<id>   # 自扮演收口要拿工具签名时必须带；也可用 MP_QM6_ADJUDICATION_EVIDENCE
#   sh scripts/deep-review.sh --dry-run    # 只打印将要做什么
#   sh scripts/deep-review.sh --check-deps # 只体检评审后端依赖（不需要 node / git 记录）
#   sh scripts/deep-review.sh --critic codex    # 临时换评审主力后端（不改清单）
#   sh scripts/deep-review.sh --proposer gemini # 临时换出方案后端
#   环境变量 MP_QM6_CRITIC / MP_QM6_PROPOSER 等价；优先级 旗标 > 环境变量 > 清单文件。
#   清单唯一真源：scripts/ccg-review-backends.list（第一行 critic、第二行 proposer）。
#
# ⚠ 覆盖参数会**转发给驱动**，但驱动**验证层**（评审 diff 那条路径）目前不应用它
#   （覆盖块只挂在决策层 --proposal 分支）。所以这里不谎称"换成功了"：真跑之前入口会把
#   请求值**回写进那份判定记录**（顶层 reviewBackends，提交时那份挪进 commitRequest 留档），
#   欠账门禁再拿它与驱动回填的 deepReview.performedBy 对账，不符即判不闭合（backendMismatch）。
#   回写是这一条链闭合的前提：不写回，记录里永远写着"清单里的后端"，于是每一次**合法**的
#   临时覆盖都会被读成"请求了 A、干活的是 B"——那是假红，不是审查发现。
#   dry-run 不回写（预览不改产物）；记录不存在也不新建（新建判定产物等于伪造）。
#   决策层 plan-review.sh 那条路径今天就能生效。
#
# 退出码：0 无阻断 / 1 有阻断 / 2 环境或配置问题（含 --force 在 skip 档做不到这一格）

set -u

# 刻意不依赖 dirname：这行在任何别的检查之前跑，是全脚本第一个外部依赖。
# 用 dirname 的话，--check-deps 这个「环境坏掉时的第一手诊断」会先被
# `dirname: command not found` 打死——而本机 PATH 恰恰是会丢工具目录的那种
# （见下面「后端解析」注释）。参数展开版对相对/绝对 $0 语义完全一致。
_self_dir="$0"
case "$_self_dir" in
  */*) _self_dir="${_self_dir%/*}" ;;
  *\\*) _self_dir="${_self_dir%\\*}" ;;
  *)   _self_dir="." ;;
esac
# ↑ 新增的 `*\\*` 分支修的是一个**一直存在但被静默掩盖**的缺陷：调用方给的是
#   Windows 绝对路径（测试与 ccg-review.ps1 就是这么传的，`D:\...\deep-review.sh`），
#   旧 case 里没有 `/`  ⇒ 落到 `*) _self_dir="."` ⇒ ROOT 变成**仓库的父目录**，
#   于是所有仓库相对路径都读错地方。过去没人发现，是因为脚本里每一处仓库相对读
#   都被 `[ -f ... ]` 挡成「不存在」（读成「没有判定记录」而不是「cd 错了」）。
#   本 PR 引入 `. scripts/lib/ccg-backends.sh`（必须按脚本自身位置解析）才把它暴露出来。
ROOT="$(cd "$_self_dir/.." && pwd)"
say() { printf '%s\n' "$1"; }
# 先把脚本自身目录**绝对化**再 cd：cd 之后相对 $0 就失效了，而下面 source 那行必须
# 按脚本位置（不是仓库根）解析，才能在任意 cwd/任意调用形态下都读得到。
_self_dir_abs="$(cd "$_self_dir" 2>/dev/null && pwd)" || _self_dir_abs="$_self_dir"
cd "$ROOT" || exit 2

FORCE=0
DRY=0
CHECK_DEPS=0
# 自扮演收口要拿工具签名的 tier=external，必须带一条**公开可核**的 PR 评论 URL（写回器的第二出口）。
# 旗标 > 环境变量；两者都没给时写回器照旧拒写并点名 no-adjudication-evidence。
EVIDENCE_ARG="${MP_QM6_ADJUDICATION_EVIDENCE:-}"
# 后端覆盖：旗标 > 环境变量 > 清单文件。空串按「没配」处理（CI 表达式里 VAR="" 是常态，
# 把它判成故障会把所有 PR 打红），但非空且不合法的名字一律早退（见 resolve_review_backends）。
CRITIC_ARG=""
PROPOSER_ARG=""
# 改成 while+shift 而不是原来的 `for a in "$@"`：后者只认无值旗标，加了带值旗标就会把
# "codex" 当成一个陌生参数**静默丢掉** —— 那正是本次要消灭的「传了等于没传」。
while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1 ;;
    --dry-run) DRY=1 ;;
    --check-deps) CHECK_DEPS=1 ;;
    --critic|--proposer)
      _v="${2:-}"
      case "$_v" in
        ""|-*)
          say "✗ 旗标 $1 缺值（必须紧跟一个后端名，例如 --critic codex）"
          exit 2 ;;
      esac
      if [ "$1" = "--critic" ]; then CRITIC_ARG="$_v"; else PROPOSER_ARG="$_v"; fi
      shift ;;
    --evidence)
      # 空格形与等号形都认：URL 里常带 `=`（#issuecomment-…），等号形更容易被 shell 切碎，
      # 但操作者从 gh 的输出里直接复制时拿到的就是 `--evidence=<url>`，两种都得能用。
      _v="${2:-}"
      case "$_v" in
        ""|-*)
          say "✗ 旗标 $1 缺值（必须是 https://github.com/<owner>/<repo>/pull/<n>#issuecomment-<id>）"
          exit 2 ;;
      esac
      EVIDENCE_ARG="$_v"
      shift ;;
    --evidence=*)
      EVIDENCE_ARG="${1#--evidence=}" ;;
    --help|-h)
      # 打印整段文件头注释（到 set -u 为止），不再用写死的行号区间：
      # 固定区间会在我给用法块加行时**静默截断**最新那几行 —— 而 '--help' 看起来照样有输出。
      sed -n '2,/^set -u/{/^set -u/!p}' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *)
      say "✗ 未知旗标：$1（本入口只认 --force / --dry-run / --check-deps / --critic <名> / --proposer <名> / --evidence <url> / --help）"
      say "  参数不得静默忽略：静默忽略会让「我传了」与「传进去了」在产物上完全同形。"
      exit 2 ;;
  esac
  shift
done

# say() 定义在参数解析**之前**（见上方 ROOT 那一段）：参数错误分支自己就要用它出声，
# 放在循环之后会让 `--critic` 缺值这类输入报 "say: command not found" 而不是那句人话。

# ==========================================================================
#  0. 评审后端对：单一真源 + shell 侧读取方
# ==========================================================================
# 为什么这里要有一份纯 shell 的读取方（而不是统一调 node）：--check-deps 是「node 本身
# 可能就是坏的」时的第一手诊断入口。于是仓里有两个读取方（本文件 source 的 sh 版与
# lib/ccg-review-backends.js 的 node 版），两者必须逐字对账 —— 对账锁在
# scripts/deep-review-deps.test.js「两个读取方必须给出同一份后端表」。
# 按**脚本自身位置**解析而不是仓库相对路径：见上面 _self_dir_abs 的说明。
# 找不到就当场 fail-closed：$0 在符号链接/非常规调用下可能指不到兄弟文件，
# 而后续每个 `resolve_review_backends: command not found` 都会把真因（没 source 上）
# 伪装成一堆功能故障 —— 本仓把这类读作「探针失明比报错更贵」。
[ -f "$_self_dir_abs/lib/ccg-backends.sh" ] || {
  printf '%s\n' "✗ 找不到评审后端读取方：$_self_dir_abs/lib/ccg-backends.sh"
  printf '%s\n' "  入口必须由仓库内路径调用（sh scripts/deep-review.sh），不得经符号链接复制出去跑。"
  exit 2
}
. "$_self_dir_abs/lib/ccg-backends.sh"

# ==========================================================================
#  0. 环境闸：拒绝 WSL
# ==========================================================================
# 这道闸防的不是「环境坏掉」，而是**报错文案把人带偏**。
#
# 实测事故（2026-10-07 另一会话）：在 PowerShell 里敲 `bash scripts/deep-review.sh`，
# 而本机**裸 bash 解析到 WSL shim**（C:\windows\system32\bash.exe），不是 Git Bash。
# 于是 $HOME 变成 WSL 的 /home/<user>，Windows 侧装的 node、后端 CLI、
# codeagent-wrapper 全部不可见，脚本接着抛出：
#     ✗ 找不到 ccg-deep-review.js
#       a) vendor 到本仓库 scripts/ 下      b) 安装技能
#       c) 设置 CCG_ARL_DIR 指向引擎目录    ← 这条是元凶
# 排查者真的去查/去设 CCG_ARL_DIR，而该变量在 Process/User/Machine
# **三级作用域全都不存在** —— 它是「从来没被设置过」，不是「没穿透到 Git Bash」。
# 整个会话因此在追一个幻影变量上耗掉多轮，真实根因（用错 shell）始终没被说破。
#
# 所以本闸的正确职责是：**先证明自己跑在对的 shell 里**，而不是在错环境里
# 输出一堆指向错误的建议。
#
# ⚠ 只拦 WSL，**不拦真 Linux**。
#   · WSL：Windows 的 Linux 子系统，本脚本的整套后端解析（.exe/.cmd/npm prefix -g/
#     无扩展名 sh shim）在这里没有意义，Windows 侧资源一概不可见 ⇒ 必须拦。
#   · 真 Linux（含 GitHub Actions 的 ubuntu runner）：同一套 POSIX 分支**是能工作的**，
#     deep-review-deps.test.js 每天都在 ubuntu 上跑本脚本 ⇒ 拦了就等于打死 CI。
#   把判据写成「必须是 Git Bash」是这条闸最容易写坏的方向。
#
# 检测只用 WSL 自己必然设置的环境变量 + /proc/version 兜底，且**不调用任何外部命令**：
# 本脚本的既有教训（见 deep-review-deps.test.js ⑦）是入口自己不能依赖 PATH 里的
# 工具目录 —— `dirname: command not found` 已经坑过一次，
# 一个「查别人坏没坏」的命令自己先坏掉是最坏的失败形态。
_is_wsl() {
  [ -n "${WSL_DISTRO_NAME:-}" ] && return 0
  [ -n "${WSL_INTEROP:-}" ] && return 0
  # 兜底：WSL_DISTRO_NAME 不是在所有调用形态下都在（例如环境被 wrapper 清洗过），
  # 此时只剩内核版本串可认。
  #
  # ⚠⚠ 判据必须**同时**满足「行首是 Linux 内核串」**且**「含 microsoft/WSL」——
  # 不能单看 Microsoft。Git Bash 也有虚拟 /proc 且**可读**（实测本机读到
  # `MINGW64_NT-10.0-26200 version 3.6.9-...`，见 QM-6 评审 i1）：
  #   · MSYS/Cygwin 系发行版的 /proc/version 同样可能带厂商字样，
  #     只认 Microsoft 就会把 **Git Bash 判成 WSL 而 exit 2**，
  #     恰好打死本闸要保护的那个平台。
  #   · 真 WSL 的版本串形如
  #     `Linux version 5.15.90.1-microsoft-standard-WSL2 (oe-user@oe-host) ...`
  #     行首 Linux 与 microsoft 同时出现，两者取交集才是无歧义判据。
  # 用 shell 内建 read + 重定向读文件，不经 cat —— 见上方「不调用外部命令」。
  if [ -r /proc/version ]; then
    while IFS= read -r _wsl_line || [ -n "$_wsl_line" ]; do
      case "$_wsl_line" in
        "Linux version "*[Mm]icrosoft*|"Linux version "*[Ww][Ss][Ll]*) return 0 ;;
      esac
      break
    done < /proc/version
  fi
  return 1
}

if _is_wsl; then
  say "✗ 当前 shell 是 WSL（Windows Subsystem for Linux），不是 Git Bash —— 本脚本在这里跑不动。"
  say ""
  say "  WSL 有另一套家目录、PATH 与文件互操作："
  say "    · \$HOME 指向 WSL 的 /home/<user>，不是 Windows 的 C:\\Users\\<user>"
  say "    · Windows 侧安装的 node、后端 CLI、codeagent-wrapper 全部不可见"
  say ""
  say "  根因通常是「裸 bash 解析到了 WSL shim」："
  say "    C:\\windows\\system32\\bash.exe  ← WSL 入口（裸 bash 命中的是它）"
  say "    <Git 安装目录>\\usr\\bin\\bash.exe ← Git Bash（要用的就是这个）"
  say ""
  say "  正确跑法（推荐：PowerShell 入口会自动定位 Git Bash 并校验身份）："
  say "    .\\scripts\\ccg-review.ps1 -Mode Plan -Proposal <方案文件>"
  say "    .\\scripts\\ccg-review.ps1 -Mode Deep"
  say "  或手动指定 Git Bash："
  say "    & \"C:\\Program Files\\Git\\bin\\bash.exe\" scripts/deep-review.sh --check-deps"
  say ""
  say "  最后一句：这**不是**环境变量没传进来。不要去查、不要去设 CCG_ARL_DIR ——"
  say "  该变量在 Process/User/Machine 三级作用域本来就不存在，追它是死路。"
  exit 2
fi

# ==========================================================================
#  后端解析：为什么不能只靠继承来的 PATH
# ==========================================================================
# codeagent-wrapper 用**裸名** spawn 后端（实测 stderr 诊断头原文：
#   Command: claude -p --dangerously-skip-permissions --output-format stream-json ...
#），所以后端能不能起来只取决于 PATH。
#
# 而本机进程 PATH 不可信：里面 C: 盘的条目被剥掉了盘符
# （`C:\Users\<user>\.local\bin` → `\Users\<user>\.local\bin`），
# Windows 会把「无盘符的 PATH 条目」按**当前工作目录所在盘符**解析：
#   cwd 在 D: → claude 不可解析（仓库正好在 D:）
#   cwd 在 C: → opencode / codex 反而不可解析
# 没有任何一条条目能同时对两个盘符有效。git 钩子与非登录 shell 又不重读
# 注册表，于是这条坑稳定复现，且症状不是报错退出，而是引擎**静默降级成
# 单后端**——评审照跑、结论照出，只是少了一路跨家族交叉验证。
# （.quality-gates.md 那次「通道偏差声明：primary 前端 claude 静默空转
#   ⇒ 降级 opencode 免费模型」就是本条坑的产物。）
#
# 所以：命中即把目录 prepend 进 PATH 并**导出**（wrapper 是子进程，
# 看不到未导出的 shell 变量），并把「靠 PATH 命中」与「靠绝对路径补入」
# 如实分开报出来。

# Windows 风格路径 → POSIX 风格。
# `npm prefix -g` 在 Windows 上返回反斜杠路径，直接拼进 sh 的 PATH 会失效。
posix_dir() {
  _pd="$1"
  [ -n "$_pd" ] || return 1
  if command -v cygpath >/dev/null 2>&1; then
    _po="$(cygpath -u "$_pd" 2>/dev/null)" || _po=""
    [ -n "$_po" ] && { printf '%s' "$_po"; return 0; }
  fi
  case "$_pd" in
    [A-Za-z]:*)
      _pv="$(printf '%s' "$_pd" | cut -c1 | tr 'A-Z' 'a-z')"
      printf '%s' "$_pd" | sed -e 's|\\|/|g' -e "s|^${_pv}:|/${_pv}|"
      ;;
    *) printf '%s' "$_pd" ;;
  esac
}

# 候选目录清单。**核心目标是不依赖那个被剥掉盘符的 PATH 条目**
# ——$HOME/.local/bin / $HOME/bin / $APPDATA/npm 三条与 PATH 无关。
# ⚠ 但别把它读成「完全不依赖 PATH」：`npm prefix -g` 走 `command -v npm`，
#   posix_dir 走 cygpath/sed/cut/tr。PATH 坏到本方案针对的那个程度时，
#   这两支会静默不生效（此时只剩前三条与 $CCG_BACKEND_BIN_DIRS 可用）。
#   这正是 QM-6 评审 i5 指出的过度声称，注释按实际能力收窄。
#
# 所有条目统一经 posix_dir 归一（QM-6 评审 i6）：只有 npm prefix 归一是不够的，
# Windows 反斜杠/盘符形态混着进 PATH，在非 msys 的 sh 下根本解析不了。
# 归一后 PATH 与报告里的路径形态也一致，便于人工核对。
#
# $CCG_BACKEND_BIN_DIRS：**只按分号分隔**（换行亦可），不要用冒号——
# Windows 盘符自带冒号，按冒号切会把路径劈成两段。路径形态不限，
# 内部会逐条过 posix_dir。
candidate_dirs() {
  # ⚠ 每个变量都必须写成 ${VAR:-}。
  #   本函数在 `set -u` 下运行，`[ -n "$APPDATA" ]` 在 APPDATA 未设时会**直接
  #   中止整个函数**——后面的 npm / CCG_BACKEND_BIN_DIRS 分支一句都跑不到，
  #   候选列表被静默截短，后端于是被判成「找不到」。
  #   这就是「告警/保护逻辑自己静默降级」的同一种病，出现在修复本身里。
  #   （本 PR 的「含空格候选目录」回归测试在最小 env 下当场抓到。）
  _cd_emit() { _cd_q="$(posix_dir "$1" 2>/dev/null)" || _cd_q=""; [ -n "$_cd_q" ] && printf '%s\n' "$_cd_q"; return 0; }
  [ -n "${HOME:-}" ] && { _cd_emit "$HOME/.local/bin"; _cd_emit "$HOME/bin"; }
  [ -n "${APPDATA:-}" ] && _cd_emit "$APPDATA/npm"
  if command -v npm >/dev/null 2>&1; then
    _pp="$(npm prefix -g 2>/dev/null)" || _pp=""
    [ -n "$_pp" ] && _cd_emit "$_pp"
  fi
  if [ -n "${CCG_BACKEND_BIN_DIRS:-}" ]; then
    # `%s\n` 而不是 `%s`：不带尾换行的话消费方会丢掉最后一行（见 resolve_backend）。
    # 这里用 here-doc 而不是 `| while`——形状与 resolve_backend 保持一致，
    # 免得两处一个走管道一个不走，读者无从判断哪处的副作用出得去。
    _cd_raw_list="$(printf '%s\n' "$CCG_BACKEND_BIN_DIRS" | tr ';' '\n')"
    while IFS= read -r _cd_raw || [ -n "$_cd_raw" ]; do
      [ -n "$_cd_raw" ] && _cd_emit "$_cd_raw"
    done <<EOF
$_cd_raw_list
EOF
  fi
  return 0
}

# 当前 shell 是不是 MSYS/Cygwin 系（Git Bash）。
_is_msys_shell() {
  case "${OSTYPE:-}" in
    msys*|cygwin*|win32*|mingw*) return 0 ;;
    *) return 1 ;;
  esac
}

# `command -v` 报出的路径**可能省略 .exe** —— Git Bash 搜索时会自动补 .exe，
# 但回报的字符串里不写回去（实测：磁盘上是 opencode.exe，command -v 报 opencode）。
#
# ⚠ 而且**不能**靠 `[ -f "$1" ]` 判断裸名是否存在：MSYS 的文件测试对扩展名
# 不敏感（实测 OSTYPE=cygwin 时，磁盘上只有 claude.exe，`[ -f "$d/claude" ]`
# 依然为真）。必须先查无歧义的扩展名，再回落到裸名。
_resolve_hit() {
  for _rh_c in "$1.exe" "$1.com" "$1.cmd" "$1.bat"; do
    if [ -f "$_rh_c" ]; then
      printf '%s' "$_rh_c"
      return 0
    fi
  done
  printf '%s' "$1"
}

# 探一个后端。**结果写进全局 _RB_CODE / _RB_MSG，并用 return code 表示成败。**
#   PATH  解析到该后端，**且**它来自一个我们主动 prepend 过的绝对目录
#   ABS   原本解析不到，已在**当前 shell** 把绝对目录补到 PATH 最前并导出
#   MISS  彻底找不到
#
# 为什么**总是** prepend 绝对目录、而不是只在 `command -v` 失败时才做
# （这是第四轮 i1 的真正要害，之前我推错了机制）：
# wrapper 是 **Go** 写的原生进程，它的 `exec.LookPath` 遇到「无盘符的 PATH 条目」
# （`\Program Files\npm-global` 这类）会拿到**相对**路径，然后 Go 1.19+ 直接
# `ErrDot: cannot run executable found relative to current directory` 拒绝执行。
# 此时 bash 的 `command -v` **照样成功**（bash 会按 cwd 盘符补全），
# 所以「command -v 命中」根本不能推出「wrapper 能起」。
# 实测：opencode 在本机 `command -v` 命中，但 wrapper 直接 ErrDot 失败；
#       把绝对目录 prepend 到 PATH 最前后，同一条命令 rc=0 返回正常内容。
# ⇒ 判据只能落在「绝对目录是否被放到了最前」，而不是「裸名能不能解析」。
#
# ⚠⚠ 绝不能用 `out="$(resolve_backend ...)"` 收集结果（QM-6 评审 i1，Critical）：
#   命令替换开子 shell，`PATH=…; export PATH` 一退出就丢 ⇒ 报告说补好了、
#   引擎仍按原 PATH spawn。已用最小复现实证过。改为写全局变量、调用方直接调用。
resolve_backend() {
  _rb_tool="$1"
  # 1) 找第一个真正含有该后端的候选目录，把它的绝对路径 prepend 到 PATH 最前。
  #    顺序上 .exe/.com 优先，避免同目录里 sh shim 把真 exe 抢先。
  _rb_list="$(candidate_dirs)"
  while IFS= read -r _rb_d || [ -n "$_rb_d" ]; do
    [ -n "$_rb_d" ] || continue
    [ -d "$_rb_d" ] || continue
    for _rb_f in "$_rb_d/$_rb_tool.exe" "$_rb_d/$_rb_tool.com" \
                  "$_rb_d/$_rb_tool" \
                  "$_rb_d/$_rb_tool.cmd" "$_rb_d/$_rb_tool.bat"; do
      [ -f "$_rb_f" ] || continue
      PATH="$_rb_d:$PATH"
      export PATH
      _rb_prepended="$_rb_d"
      break 2
    done
  done <<EOF
$_rb_list
EOF

  # 2) 裸名能否解析。文件名形态不参与判定：
  #    wrapper 是 Go，Go 在 Windows 上能直接跑 .cmd/.bat
  #    （早先我据 .NET CreateProcess 的实验推广成「wrapper 也起不了 .cmd」，是错的，
  #      已用 wrapper 实测纠正：opencode.cmd 能被正常拉起）
  if _rb_hit="$(command -v "$_rb_tool" 2>/dev/null)"; then
    _rb_real="$(_resolve_hit "$_rb_hit")"
    if [ -n "${_rb_prepended:-}" ]; then
      _RB_CODE=ABS
      _RB_MSG="已把绝对目录 $_rb_prepended 补到 PATH 最前；裸名解析到 $_rb_real"
    else
      # PATH 分支不得直接计为可用（QM-6 评审 i1 的源头同病，plan-review.sh
      # 已在 #3148 修掉同款；见 openspec/records/plan-review-deps.md）：
      # 裸名命中但候选目录未命中，说明后端来自「来历不明」的 PATH 条目——
      # 恰是本脚本要防的坏环境（无盘符条目按 cwd 解析 / Go wrapper ErrDot）。
      # 此时「command -v 成功」推不出「wrapper 能起」，静默计入可用 =
      # wrapper 起不来仍当双后端用，无告警无修法。
      #
      # 修法（含 QM-6 二轮 i1/i3/i5 的三处收紧）：
      #   i1  命中项必须是**绝对路径**才可信——相对 PATH 条目（无盘符坏环境
      #       的典型形态）下 command -v 返回相对路径，${var%/*} 得到相对目录，
      #       prepend 后解析不变、ErrDot 依旧，却会伪装成 ABS；
      #   i5  command -v 对函数/别名/内建返回无斜杠裸名（实测 `command -v cd`
      #       → `cd`），${var%/*} 无分割——同样按 MISS 并在文案里说明；
      #   i3  **不再把来历不明的目录全局 prepend 进 PATH**——那会重排后续
      #       所有裸命令（git/node 等）的解析顺序，同目录同名 stub 可遮蔽
      #       真实工具。改为只把绝对路径**报出来**供主流程核对，不动 PATH。
      # 判定：绝对路径命中 = ABS（可信）；其余一律 MISS（fail-closed）。
      case "$_rb_real" in
        */*)
          case "$_rb_real" in
            /*)
              _RB_CODE=ABS
              _RB_MSG="裸名命中来自非候选目录的绝对路径 $_rb_real（未改 PATH，仅上报核对）"
              ;;
            *)
              _RB_CODE=MISS
              _RB_MSG="裸名解析到相对路径 $_rb_real（来自无盘符/相对 PATH 条目，ErrDot 域）——按缺失处理"
              return 1
              ;;
          esac
          ;;
        *)
          _RB_CODE=MISS
          _RB_MSG="command -v 命中的是无路径裸名（函数/别名/内建），不是可执行文件——按缺失处理"
          return 1
          ;;
      esac
    fi
    return 0
  fi
  _RB_CODE=MISS
  _RB_MSG="找不到（PATH 与候选目录均未命中）"
  return 1
}

# 恢复后的**裸名自检**：在当前 shell 里真的解析一遍。
# 打印形如 "  · 裸名自检 claude → /path/to/claude"
# 注意它验的是「bash 能解析」；**wrapper 能否 spawn 由 prepend 绝对目录保证**，
# 两者的差别见 resolve_backend 上方那段 ErrDot 说明。
self_check_backends() {
  while IFS='|' read -r _sb_b _sb_unused_why _sb_unused_pkg; do
    [ -n "$_sb_b" ] || continue
    if _sb_hit="$(command -v "$_sb_b" 2>/dev/null)"; then
      say "  · 裸名自检 $_sb_b → $(_resolve_hit "$_sb_hit")"
    else
      say "  · 裸名自检 $_sb_b → 仍不可解析"
      _RB_SELF_RC=2
    fi
  done <<EOF
$(backend_table)
EOF
}

# 逐个后端体检并打印。
# 退出码刻意分两档而不是「有一个能跑就算过」——单后端正是本条坑造成的降级形态，
# 把它做成 0 会让体检失去意义：
#   0  配置名单里的后端全部解析到绝对路径（跨家族对照按配置齐备）
#   2  有后端缺失（能跑则降级；一个都不剩时另加硬提示）
# 分母取自 backend_table 的行数（= 清单/覆盖解析出的名单），不是写死的 2。
#
# 副作用：把 _RB_OK / _RB_RC 暴露给调用方，主流程要靠它决定是继续还是早退。
report_backends() {
  _rb_rc=0
  _rb_n=0
  _rb_total=0
  # 名单来自单一真源（backend_table 由清单 + 覆盖渲染），不再写死 claude/opencode。
  # 读它用的是 heredoc 而不是管道：管道会把循环体推进子 shell，
  # 而 resolve_backend 对 PATH 的修复必须留在当前 shell（见上方「后端解析」段）。
  while IFS='|' read -r _rb_b _rb_why _rb_pkg; do
    [ -n "$_rb_b" ] || continue
    _rb_total=$((_rb_total + 1))
    # 直接调用，绝不走 $(...)：PATH 的修复必须留在当前 shell（见上）。
    resolve_backend "$_rb_b" || true
    say "  · $_rb_b  [$_RB_CODE] $_RB_MSG（$_rb_why）"
    case "$_RB_CODE" in
      # PATH 档已废除（⑩）：裸名来自非候选目录时要么升级 ABS 要么 MISS，
      # 不再有「已按原样使用」的中间态。
      ABS) _rb_n=$((_rb_n + 1)) ;;
      MISS)
        _rb_rc=2
        say "      ↳ 修法：装一个（npm i -g $_rb_pkg），"
        say "        或把它所在目录写进系统 PATH 后重开终端；"
        say "        也可用 CCG_BACKEND_BIN_DIRS 显式指一个目录" ;;
    esac
  done <<EOF
$(backend_table)
EOF
  # ⚠ 必须按**计数**分档，不能只看「有没有」；而分母也不能写死成 2 ——
  #   同族单后端（critic==proposer）配置下 backend_table 只有一行，
  #   拿「1」当降级会把一份显式配置读成故障（本仓记过的「把配置判成故障」同型）。
  case "$_rb_n" in
    0)
      say ""
      say "  ✗ 没有任何评审后端可用 —— 深度审查根本起不来。" ;;
    "$_rb_total")
      if [ "$RB_CRITIC" = "$RB_PROPOSER" ]; then
        say ""
        say "  ℹ 同族单后端（critic=proposer=$RB_CRITIC）：能跑，但按配置**不参与**跨家族交叉验证。"
      fi ;;
    *)
      say ""
      say "  ⚠ 仅 $_rb_n/$_rb_total 个后端可用 —— 评审能跑，但跨家族交叉验证会缺失（这正是本条坑的形态）。" ;;
  esac
  # 自检放在这里而不是只放在 --check-deps：主流程同样要知道自己修完之后
  # 裸名到底起不起来（第四轮 i3）。只给诊断入口做验证，等于把 non-diagnostic
  # 路径留在旧缺陷形态。
  _RB_SELF_RC=0
  say ""
  self_check_backends
  if [ "$_RB_SELF_RC" -ne 0 ]; then
    _rb_rc=2
  fi
  _RB_OK=$([ "$_rb_n" -ge 1 ] && echo 1 || echo 0)
  _RB_RC="$_rb_rc"
  _RB_SELF="$_RB_SELF_RC"
  return "$_rb_rc"
}

# ---------- 0-pre. 解析评审后端对（旗标 > 环境变量 > 清单文件） ----------
# 必须早于 report_backends 与裸名自检：两边都消费解析结果。反过来（先体检、后解析）
# 会让体检按老名单出结论，而本次六份字面量互不认账就是这个顺序造成的。
resolve_review_backends || exit 2
if [ -n "$RB_OVERRIDE_NOTE" ]; then
  # 覆盖必须出声并点名**来源档位**：静默的旋钮等于没旋钮（2026-10-18 三种旋钮全部
  # 静默失效、没有任何一行输出说清「当时的 critic 到底是谁」，是本刀的直接动因）。
  say "ℹ 评审后端已覆盖：$RB_OVERRIDE_NOTE（critic 来源 $RB_FROM_CRITIC，proposer 来源 $RB_FROM_PROPOSER）"
  say "  请求值随判定记录落盘（reviewBackends），实际执行者由驱动回填（deepReview.performedBy），"
  say "  两者不符时 check-pr-exec-record.js 判该条深度审查**未闭合**（backendMismatch）。"
fi

# ---------- 0a. 纯依赖体检（--check-deps）----------
# 刻意放在定位 node / 驱动 / 判定记录**之前**：这是「为什么我的评审降级了」
# 的第一手诊断入口，真出事时 node 可能本身就是坏的，届时仍要能问。
if [ "$CHECK_DEPS" -eq 1 ]; then
  say "═══ CCG 深度审查 · 依赖体检 ═══"
  _CD_WRAPPER="${CODEAGENT_WRAPPER:-${HOME:-}/.claude/bin/codeagent-wrapper.exe}"
  if [ -f "$_CD_WRAPPER" ] || [ -x "$_CD_WRAPPER" ]; then
    say "  ✓ codeagent-wrapper  $_CD_WRAPPER"
    _CD_RC=0
  else
    say "  ✗ codeagent-wrapper 找不到: $_CD_WRAPPER"
    say "    修法：npx ccg-workflow（生成 wrapper）"
    _CD_RC=2
  fi
  report_backends || _CD_RC=2
  # report_backends 末尾已经做过裸名自检（当前 shell 里的真解析 + wrapper 判据），
  # 这里只看它的结论，不再重复一遍。self_check 的「不可解析」分支必须置 rc=2
  # ——注释承诺过「矛盾一律判不通过」，只实现 .cmd 那一格等于承诺落空
  # （第四轮 i2）。
  [ "${_RB_SELF:-0}" -ne 0 ] && _CD_RC=2
  say ""
  if [ "$_CD_RC" -eq 0 ]; then
    say "体检通过：后端可用。"
  else
    say "体检不通过：见上方逐条修法。"
  fi
  exit "$_CD_RC"
fi

# ---------- 1. 定位 node ----------
if ! command -v node >/dev/null 2>&1; then
  if [ -d "${HOME:-}/.fnm" ]; then
    eval "$(fnm env --shell sh 2>/dev/null)" 2>/dev/null || true
  fi
fi
if ! command -v node >/dev/null 2>&1; then
  say "✗ 找不到 node。"
  say "  git 钩子不继承登录 shell 的 PATH，node 常常在这里丢失。"
  say "  修复：在 .husky/pre-commit 里复用本仓已有的 fnm/hermes node 兜底逻辑，"
  say "        或设置系统级 PATH 后重开终端。"
  exit 2
fi

# ---------- 2. 定位驱动 ----------
DRIVER=""
for c in \
  "$ROOT/scripts/ccg-deep-review.js" \
  "${CCG_ARL_DIR:+$CCG_ARL_DIR/ccg-deep-review.js}" \
  "${HOME:-}/.claude/skills/adversarial-review-loop/scripts/ccg-deep-review.js"
do
  [ -n "$c" ] && [ -f "$c" ] && DRIVER="$c" && break
done
if [ -z "$DRIVER" ]; then
  # ★ 2026-10-17（CI 实证修复，Gate 2b 全红）：引擎缺失时**不得无条件 exit 2**。
  #
  #   动因（实测）：CI runner 上没有 ccg-deep-review.js（它只在 ~/.claude/skills/...），
  #   而本脚本在「定位驱动」阶段就 exit 2 —— 于是**连判定记录查找都没走到**。
  #   后果：behavior 锁（真跑本脚本断言记录查找/故障判据/exit code 的那批）在 CI 上
  #   全部拿到 exit 2 ⇒ 8 条同时红 ⇒ QG Static 挂掉。本地全绿只因本机有引擎。
  #
  #   判据：--dry-run 的职责是**预览将要做什么**，不该因缺工具而拒绝预览。
  #   故 dry-run 下改为「明确标注引擎缺失 + 继续完成预览」；
  #   非 dry-run（真要跑审查）仍 fail-closed exit 2 —— 那才是该拦的地方。
  if [ "${DRY:-0}" -eq 1 ]; then
    say "⚠ 找不到 ccg-deep-review.js（引擎）—— 本次 dry-run 只预览到「判定记录」为止。"
    say "  三种解法任选其一："
    say "    a) 把 adversarial-review-loop 的 scripts/ vendor 到本仓库 scripts/ 下"
    say "    b) 安装技能：npx ccg-workflow"
    say "    c) 设置 CCG_ARL_DIR 指向引擎目录"
    say "  （真实审查需要引擎；dry-run 不需要。）"
    DRY_NO_DRIVER=1
  else
    say "✗ 找不到 ccg-deep-review.js。"
    say "  三种解法任选其一："
    say "    a) 把 adversarial-review-loop 的 scripts/ vendor 到本仓库 scripts/ 下"
    say "    b) 安装技能：npx ccg-workflow"
    say "    c) 设置 CCG_ARL_DIR 指向引擎目录"
    exit 2
  fi
fi

# ---------- 3. 读判定记录 ----------
SHA="$(git rev-parse HEAD 2>/dev/null || echo '')"
[ -n "$SHA" ] || { say "✗ 不在 git 仓库内"; exit 2; }
# 相对路径：node 的 require() 不认 POSIX 路径，脚本已 cd 到仓库根，用相对路径最稳
REC=".ccg/reviews/$SHA.json"

# ★ 2026-10-16（QM-6 i7，与 i1 同型）：`require('./$REC')` 的失败被 try-catch **静默吞掉**
#   ⇒ MODE 取空 ⇒ 走「判定记录: 无」分支 ⇒ 深度审查被跳过。
#   而记录文件是我们自己刚写出来的 JSON，它坏掉（BOM / 尾逗号 / 空文件）本身就是故障，
#   不是「没跑判定器」—— 两种原因必须分开报，否则同一个表象掩盖两个不同根因。
#   引擎侧（ccg-deep-review.js::readDecision）也是 try-catch 后落到内容寻址，
#   两端口径在此分叉 ⇒ 欠账判定可能不一致。故此处显式出声。
_read_mode() {
  local f="$1" out rc
  # ★ QM-6 第二轮 i4：路径经 **argv** 传给 node，不再内插进 -e 的单引号任脚串。
  #   内插形态下路径含引号/换行会注入或让脚本解析错位；当前只有十六进制名时尚安全，
  #   但形态脆。argv 传参后由 process.argv[1] 取，与 shell 引号彻底解耦。
  #
  #   ★★ argv 下标踩坑（2026-10-16 实测，i4 的修复自身引入的 bug）：
  #     `node -e <script> <arg>` 中，**`-e` 的脚本不占 argv** ⇒ arg 落在 **argv[1]**，
  #     不是 argv[2]。首版写 argv[2] ⇒ 得到 undefined ⇒ path.resolve 抛
  #     ERR_INVALID_ARG_TYPE ⇒ 记录**明明存在却读不出**，被误判成「无记录」。
  #     这个 bug 让内容寻址在真实路径上静默失效了整整一轮，是靠「跑一次真脚本」抓到的
  #     —— 纯结构锁（grep argv 字面）抓不到它，因为字面确实在那儿。
  #   另外先校验文件名形态（.json 结尾），不符即告警而非硬 require。
  case "$f" in
    *.json) ;;
    *) say "⚠ 记录名不是 .json 结尾（$f），跳过解析"; return 1 ;;
  esac
  out="$(node -e "
    const path = require('path');
    const f = path.resolve(process.argv[1]);
    let r;
    try { r = require(f); } catch (e) {
      process.stderr.write('PARSE_FAIL:' + (e && e.message ? e.message : String(e)));
      process.exit(4);
    }
    const m = r && typeof r.mode === 'string' ? r.mode : '';
    if (!m) { process.stderr.write('MODE_MISSING'); process.exit(3); }
    process.stdout.write(m);
  " "$f" 2>/dev/null)"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    say "⚠ 判定记录存在但读不出 mode（$f，rc=$rc）—— 记录文件可能损坏。"
    say "  这不是「没跑判定器」：请检查该 JSON 是否可解析（BOM / 尾逗号 / 空文件）。"
    # ★ 第三轮 i8：置位，让下面的故障判据**跳过**—— 否则同一屏会同时输出
    #   「读不出 mode」和「这是故障」，两条诊断根因归属互相误导。
    _READ_FAILED=1
    return 1
  fi
  MODE="$out"
  return 0
}

MODE=""
# ★ 第三轮 i8：_read_mode 失败时置位，让下面的故障判据跳过（避免同一屏两条诊断）。
#   必须在 set -u 下**预先声明**，否则首次读取未定义变量会让整个脚本退出
#   （实测：`_READ_FAILED: unbound variable`，4 条行为锁同时红）。
_READ_FAILED=""
if [ -f "$REC" ]; then
  _read_mode "$REC" || true
fi

# ★ 2026-10-15 修（缺陷 E）：记录恒写在【父提交 sha】名下，按 HEAD 找不到是**常态**。
#
# 成因：判定器在 pre-commit 里跑，那时新 commit 还不存在，currentSha() 拿到的是
# 【父提交】⇒ 它把记录写成 .ccg/reviews/<parent>.json。提交完成后 HEAD 变成新 sha，
# 按 <HEAD>.json 找必然落空。
#
# 旧实现在这里直接 `exit 0`，于是**深度审查在真实流程里一次都没跑起来过** ——
# 而引擎侧 ccg-deep-review.js 的 readDecision() 早就有 stagedDiffHash 内容寻址兜底
# （其注释还专门写了这件事），却被这行早退挡在门外，兜底成了死代码。
#
# 判据：记录 <HEAD^>.json 描述的正是 HEAD 这一笔的改动集（判定器在 HEAD^ 为 HEAD 时
# 写入的暂存 diff == HEAD^..HEAD）。所以按父提交回退是**语义正确**的，不是猜。
if [ -z "$MODE" ]; then
  _PARENT="$(git rev-parse HEAD^ 2>/dev/null || echo '')"
  if [ -n "$_PARENT" ] && [ -f ".ccg/reviews/$_PARENT.json" ]; then
    REC=".ccg/reviews/$_PARENT.json"
    _read_mode "$REC" || true
    [ -n "$MODE" ] && say "判定记录按父提交 sha 命中：${_PARENT%${_PARENT#????????}}（提交时 HEAD 即父提交）"
  fi
fi

# ★ 2026-10-16 加（ccg-record-content-addressing）：记录名改为**内容寻址**后，
#   按 <HEAD>.json / <HEAD^>.json 找必然双双落空 —— 本段就是那两种旧形态之外的第三路。
#
# 名字配方必须与 ccg-review-decider.js::recordFileName() 的键**同源**，即
# `stagedDiffHash` = 排除 .ccg 的 diff 的 sha256。判定器在 pre-commit 用
# `git diff --cached --no-textconv --no-ext-diff --no-renames -- . ':(exclude).ccg'`；提交后与之逐字节等价的是
# `<HEAD^> <HEAD>` 的同一 pathspec（引擎 ccg-deep-review.js::readDecision() 用的就是这个配方）。
#
# 为什么要显式加这一段、而不是靠引擎自己的内容寻址兜底：本脚本在找不到记录时**早退 exit 0**，
# 兜底会被挡在门外变成死代码 —— 这正是 2026-10-15「缺陷 E」修过一次的同型问题。
if [ -z "$MODE" ]; then
  _PARENT2="$(git rev-parse HEAD^ 2>/dev/null || echo '')"
  # ★ 第四轮 i2（Critical）：**首个提交**（仓库只有一笔、无 HEAD^）时，
  #   首版整个内容寻址段被 _PARENT2 非空守卫挡掉 ⇒ 记录按 stagedDiffHash 命名却找不到，
  #   且下面的故障判据同样依赖 _PARENT3。这正是残留风险里「未实测无 HEAD^ 场景」那条。
  #
  #   口径：无 HEAD^ 时用 `git show HEAD`（首个提交的完整内容）当 diff 源 ——
  #   它与判定器在 pre-commit 时读到的 `git diff --cached` 是同一份字节
  #   （首提交时 index 的全部内容就是该提交的全部内容）。
  #   注意：git show 会带 commit 头，故用 `git show --format= --` 只要 diff 部分。
  if [ -n "$_PARENT2" ]; then
    _DIFF_TMP="$(mktemp 2>/dev/null || echo "$HOME/.ccg-diff.$$")"
    git diff --no-textconv --no-ext-diff --no-renames "$_PARENT2" "$SHA" -- . ':(exclude).ccg' > "$_DIFF_TMP" 2>/dev/null
  else
    say "ℹ 仓库只有一笔提交（无 HEAD^）⇒ 按首个提交内容寻址"
    _DIFF_TMP="$(mktemp 2>/dev/null || echo "$HOME/.ccg-diff.$$")"
    git show --no-textconv --no-ext-diff --no-renames --format= "$SHA" -- . ':(exclude).ccg' > "$_DIFF_TMP" 2>/dev/null
  fi
    # ★ 第三轮 i7：**只算一次 diff**，哈希与行数都从同一份字节来。
    #   首版把同一份 diff 物化三次（查找哈希、_DIFFLINES、commit -a 自检各一遍），
    #   大变更下是 O(n)×3 的重复管道 IO。
    #
    #   ★★ 必须落**临时文件**而不是 shell 变量：`$(...)` 命令替换会**吃掉尾随换行**，
    #      `printf '%s' "$var" | sha256sum` 因此与 decider 的
    #      `git diff ... | sha256sum` **逐字节不同** ⇒ 内容寻址失效（实测踩过）。
    #      落文件后两处都从同一份字节读，哈希才与 decider 对得上。
    #   ★★ 外部复核第三轮异议（已修）：这一侧（B 侧）的 git diff 必须与判定器（A 侧）
    #     **同一套参数**。A 侧固定了 --no-textconv --no-ext-diff --no-renames，
    #     而这里首版是裸 git diff —— 两边配方不一致时，同一变更会算出不同哈希
    #     ⇒ 内容寻址失效，而这正是整套方案的承重墙（A == B）。
    #     下方给用户照抄的「自检命令」提示同理，必须与实现同参数。
    _DIFFHASH="$(sha256sum < "$_DIFF_TMP" | cut -d' ' -f1)"
    _DIFFLINES="$(wc -l < "$_DIFF_TMP")"
    rm -f "$_DIFF_TMP"
    if [ -n "$_DIFFHASH" ] && [ -f ".ccg/reviews/$_DIFFHASH.json" ]; then
      REC=".ccg/reviews/$_DIFFHASH.json"
      _read_mode "$REC" || true
      [ -n "$MODE" ] && say "判定记录按内容寻址命中：${_DIFFHASH%${_DIFFHASH#????????}}（stagedDiffHash）"
    fi
fi

# ★ 2026-10-16（QM-6 第二轮 i1，Critical）：三条路径全落空时，必须**区分两种原因**，
#   否则「记录丢了/分叉了」会被读成「从没跑过判定器」—— 后者是正常状态，前者是故障。
#
#   判据顺序（★ 第二轮自查补正 + ★ 第三轮 i1/i8 补正）：
#     0. 三条查找路径是否**命中过但读坏了**？命中过 ⇒ _read_mode 已报「读不出 mode」
#        ⇒ 本段直接跳过，不再报「故障」—— 否则同一屏两条诊断、根因归属误导（第三轮 i8）。
#     1. 工作区是否干净？不干净且**索引有已暂存改动** ⇒ 报「部分提交」形态（第三轮 i1）：
#        git status --porcelain 同时覆盖「已暂存未提交」与「未暂存」两档，而这两档对判定
#        记录的含义完全不同 ——
#          未暂存 ⇒ 判定器没见过它，记录不该有它 ⇒ 不是故障
#          已暂存 ⇒ 判定器**见过**它（pre-commit 时就在 index 里），若提交时没用上
#                  （commit --only / commit <paths>）⇒ A != B ⇒ **真分叉**
#        第二轮只用第 1 步的合并判据，恰好把这种真分叉漏进「非故障」分支。
#     2. 工作区不干净但无已暂存改动 ⇒ 只提示「请先提交」，**不判故障**
#        （第二轮自查：首版连这步都没有，把「改到一半就跑」判成故障，比不报更糟）
#     3. 工作区与索引都干净 ⇒ 本提交相对 HEAD^ 的非 .ccg diff 是否为空？
#        - 空 ⇒ 这笔提交本就不该有记录（纯 .ccg/ 或空提交），「无记录」是正确的
#        - 非空 ⇒ 判定器本该为它写一条，三条路径全落空 ⇒ 记录丢了
#
#   这是把 fail-open 从「静默」推到「出声」之后的**第二层**：连「是不是故障」都判出来。
if [ -z "$MODE" ]; then
  _PARENT3="$(git rev-parse HEAD^ 2>/dev/null || echo '')"
  if [ -n "$_PARENT3" ] && [ -z "$_READ_FAILED" ]; then
    _DIRTY="$(git status --porcelain -- . ':(exclude).ccg' 2>/dev/null | wc -l)"
    _STAGED="$(git diff --cached --name-only -- . ':(exclude).ccg' 2>/dev/null | wc -l)"
    if [ "${_DIRTY:-0}" -gt 0 ] && [ "${_STAGED:-0}" -gt 0 ]; then
      say "⚠ 索引里有 ${_STAGED} 个已暂存的非 .ccg 改动，但当前 HEAD 里找不到对应判定记录。"
      say "  这通常是**部分提交**（git commit --only <file> / git commit <paths>）导致的分叉："
      say "    判定器在 pre-commit 按【全量暂存 diff】算哈希取名，而本次提交只含其中一部分 ⇒ A != B。"
      say "  自检：git diff --cached --no-textconv --no-ext-diff --no-renames -- . ':(exclude).ccg' | sha256sum"
      say "        git diff HEAD^ HEAD --no-textconv --no-ext-diff --no-renames -- . ':(exclude).ccg' | sha256sum   # 两者应相等"
      say "  处置：git add -A 后重新完整提交一次（不要用 --only / <paths>），再跑本脚本。"
    elif [ "${_DIRTY:-0}" -gt 0 ]; then
      say "ℹ 工作区有 ${_DIRTY} 个未提交/未暂存的非 .ccg 改动 —— 判定记录只对**已提交**的变更集负责。"
      say "  请先 git add -A && git commit，再跑本脚本；否则「找不到记录」是预期而非故障。"
    else
      # 第 3 步：工作区与索引都干净 ⇒ 才能判「记录丢了」
      # ★ _DIFFLINES 已在上面内容寻址段算过一次（第三轮 i7：同一份 diff 不重复物化）
      if [ "${_DIFFLINES:-0}" -gt 0 ]; then
        say "⚠ 本提交有 ${_DIFFLINES} 行非 .ccg 改动，却找不到任何判定记录 —— 这是**故障**，不是「没跑判定器」。"
        say "  可能原因：① 提交形态导致 A(--cached) 与 B(HEAD^..HEAD) 分叉，记录按 A 取名落空；"
        say "            ② 记录文件被清掉（.ccg 被 clean / 换机器 / rebase 丢文件）；"
        say "            ③ 哈希配方受 diff 配置影响而算错。"
        say "  处置：确认 .ccg/reviews 下有无对应 <sha>.json；若确有改动却始终无记录，按欠账处理。"
      fi
    fi
  fi
fi

say "═══ CCG 深度审查（本地） ═══"
say "HEAD: ${SHA%${SHA#????????}}"
if [ -z "$MODE" ]; then
  say "判定记录: 无 —— 提交时没跑判定器"
  say ""
  say "请先提交一次（pre-commit 会生成 .ccg/reviews/<sha>.json），再跑本脚本。"
  say "或用 --dry-run 看本脚本将要做什么。"
  say ""
  # ★ 2026-10-16（ccg-record-content-addressing，QM-6 i1，实验已证实）：
  #   内容寻址命名引入了一个**新的 fail-open 失败模式**，必须在这里点名，否则静默 exit 0
  #   会把故障伪装成「本来就没跑判定器」。
  #
  #   实测形态：`git commit -a`（把未暂存的 tracked 改动一并提交）时
  #     A = git diff --cached --no-textconv --no-ext-diff --no-renames -- . ':(exclude).ccg' | sha256sum   （判定器在 pre-commit 用的）
  #     B = git diff HEAD^ HEAD --no-textconv --no-ext-diff --no-renames -- . ':(exclude).ccg' | sha256sum （本脚本/引擎用的）
  #   A != B —— 实测 A=8b02f61d34a9e858… B=29140567e3fb2604…。
  #   判定器按 A 取名落盘，本脚本按 B 找不到 ⇒ 深度审查被跳过，而欠账门禁
  #   （check-pr-exec-record.js）只扫「本次变更集涉及的记录文件」，**也不会**发现它 ⇒ 双重静默。
  #
  #   所以：按内容寻址没命中时，要显式提示「本提交可能不是全量 add 后提交」。
  #   这比旧命名（按 HEAD^ 兜底，任何提交形态都能命中）是**收窄**，如实告知。
  say "⚠ 若你刚用过 git commit -a / git commit --amend 之后又改过内容："
  say "  判定记录按内容寻址取名，可能与本次提交的 diff 口径分叉而落空。"
  say "  自检：git diff --cached --no-textconv --no-ext-diff --no-renames -- . ':(exclude).ccg' | sha256sum"
  say "        git diff HEAD^ HEAD --no-textconv --no-ext-diff --no-renames -- . ':(exclude).ccg' | sha256sum   # 两者应相等"
  say "  处置：git add -A 后重新提交一次（不要再动工作区），再跑本脚本。"

  # ★ 第五轮 i4（Critical 级失败模式）：**不得一律 exit 0**。
  #   旧版这里无条件 exit 0 ⇒ 记录缺失时深度审查被静默跳过 ⇒ fail-open。
  #   判据：本提交**本该有**判定记录吗？
  #     - 非 .ccg diff 行数 > 0 ⇒ 判定器本该为它写一条 ⇒ 缺失即故障 ⇒ **exit 1**（fail-closed）
  #     - 为空 ⇒ 这本就不该有记录（纯 .ccg/ 或空提交）⇒ exit 0 正确
  #   _DIFFLINES 已在内容寻址段算过（同一份 diff，不重复物化）。
  #   --dry-run 仍 exit 0（它只预览，不承担门禁职责）。变量名是 DRY（不是 DRY_RUN）。
  if [ "${_DIFFLINES:-0}" -gt 0 ] && [ "${DRY:-0}" -eq 0 ]; then
    say ""
    say "🔴 本提交有 ${_DIFFLINES} 行非 .ccg 改动却没有判定记录 ⇒ 深度审查无法进行（fail-closed）。"
    say "   按上面自检定位分叉原因，修复后重跑；不要用 '跳过' 当作通过。"
    exit 1
  fi
  exit 0
fi
say "判定: $(echo "$MODE" | tr '[:lower:]' '[:upper:]')"

if [ "$MODE" = "skip" ] && [ "$FORCE" -eq 0 ]; then
  say "→ S 复杂度低风险，按决策矩阵跳过深度审查"
  exit 0
fi

if [ "$MODE" = "skip" ]; then
  # ★ --force 在验证层做不到：mode 由驱动（ccg-deep-review.js，住在仓外技能目录）自己从判定
  #   记录读，转发任何旗标它都不认识。继续走到下面 exec 的**唯一**后果是驱动把这条记录的
  #   deepReview 整块覆写成 skipped_by_mode —— 2026-10-22 临时仓实测：前值
  #   cleared / tier=external / evidence=PR #4204 issuecomment-6323452201 / findings=7
  #   → 后值 skipped_by_mode / performedBy=null / findings=null，rc=0，wipe=true。
  #   所以拒绝点必须排在「4. 依赖体检」之前：体检在零后端时同样 exit 2，会把"旗标做不到"
  #   伪装成"环境问题"，那是归因错位而不是严格性。锁见 scripts/deep-review-deps.test.js。
  #   两入口的 --force 语义不同不可"顺手统一"：决策层连这一档都没有（判定器对 --input 恒不产出
  #   该档），所以它的旗标已随切片一并删除；把这里的拒绝抄过去等于拆掉一条真在跑的路径。
  say "✗ --force 在验证层不会强制：mode 由驱动自己从判定记录读，本入口改不了它的判。"
  say "  再往下走只会让驱动把 $REC 的 deepReview 覆写成 skipped_by_mode —— 审查一次没跑，出处先没。"
  say "  出路 ①：方案层面直接 sh scripts/plan-review.sh <方案文件>（决策层对方案恒不跳过）。"
  say "  出路 ②：本笔 diff 要真审 ⇒ 按 AGENTS.md QM-6 的原始命令形态直接起两路后端，或走只读"
  say "           fresh-context 派发，并把出处写进 PR 评论；**不得**事后改写记录的 mode 造一条 dual。"
  exit 2
fi

# ---------- 4. 依赖体检 ----------
# ★ 2026-10-17（CI 实证修复）：dry-run 下依赖体检**不得 fail-closed**。
#   动因同上一处：CI 上没有 codeagent-wrapper / 评审后端，而 dry-run 只预览，
#   不该因缺工具而拒绝预览（否则 behavior 锁在 CI 上又全红）。
if [ "${DRY:-0}" -eq 1 ]; then
  say "[dry-run] 跳过依赖体检的 fail-closed（真跑时才要求后端就绪）。"
else
  WRAPPER="${CODEAGENT_WRAPPER:-${HOME:-}/.claude/bin/codeagent-wrapper.exe}"
  [ -x "$WRAPPER" ] || [ -f "$WRAPPER" ] || {
    say "✗ 找不到 codeagent-wrapper: $WRAPPER"
    say "  生成：npx ccg-workflow"
    exit 2
  }
  # 后端体检**并补 PATH**（旧实现只 say 一句被动告警然后照跑 ⇒ 静默降级）。
  # 降级（单后端）保持非致命，与旧语义一致；真要 fail-closed 请用 --check-deps。
  # 但「一个后端都没有」必须早退：继续跑只会在引擎深处抛一个难懂的错误，
  # 而上一行刚打印过「深度审查根本起不来」，再打印「体检通过」是自相矛盾
  # （QM-6 评审 i3）。
  report_backends || true
  say ""
  if [ "$_RB_OK" -eq 0 ]; then
    say "✗ 没有可用评审后端，深度审查起不来。修法见上方逐条（也可先跑 --check-deps）。"
    exit 2
  fi
  if [ "$_RB_RC" -eq 0 ]; then
    say "依赖体检通过，开始深度审查（可能耗时 15 分钟以上，取决于 diff 体量）…"
  else
    say "依赖体检有降级，开始深度审查（缺一路跨家族交叉验证）…"
  fi
  say ""
fi

# ---------- 5. 跑 ----------
# 覆盖参数只在**真的覆盖过**时转发：默认路径保持与历史逐字相同，既不把本仓的默认值
# 钉成上游的第二真源，也让任何按旧命令行写的锁继续成立。
#
# 形态取自 QM-6 外部评审的 Critical 建议：**逐值加引号、分支成两条 exec**，
# 而不是拼一个变量再无引号展开。拼串写法的安全性完全押在
# is_valid_backend 的字符集上——那个正则将来被人放宽一格（例如为支持带空格的服务名）
# 就直接打开词法拆分/注入窗口，而放宽正则本身不会被任何测试问起。
# 现在即便正则被放宽，值也只会被当作**一个参数**交给 node，不构成第二道防线依赖。
# （这也是为什么 scripts/deep-review-deps.test.js 里有一条 doesNotMatch 禁这个变量名 ——
#   禁词锁不剥注释，所以本注释刻意不提那个名字。）
# ---------- 5a. 真跑出口：驱动返回之后写回，最后以**驱动的 rc** 退出 ----------
# 为什么这里不能再用 exec：exec 是把当前进程**换成**驱动，写在它之后的任何动作永远执行不到
# （本仓「释放必须发生在控制流正确位置」的同型）。而收口矩阵要的 tier/evidence 必须由
# 驱动返回之后这一步补齐，顺序只能由控制流保证，不能由"写在文件哪一行"约定。
#
# ⛔ `exit` 的参数必须是 _wb_rc：写回器按合同**恒返回 0**（旁路语义），
#   把它接成 `exit $?` 会把"评审失败"原地变成"评审成功"。
#   行为锁：scripts/deep-review-entry-rc.test.js 用假驱动分别跑 rc=0/1/2 三档断言逐字相等。
run_driver_with_writeback() {
  # ---------- 跨调用轮次上限（openspec change: qm6-rebuttal-round-cap）----------
  # 引擎里那个 [轮 1/3] 只管**单次调用内**的收敛；「改完重投提交、再跑一遍入口」每次都是全新调用，
  # 没有任何东西记着这个 change 真跑过几轮外部评审（实测代价：#4148 同一切片跑了八轮才靠人喊停）。
  # 三条不能写错的口径：
  #  ① 键是 (分支, HEAD sha)，**不是判定记录名** —— 记录名是内容寻址，重投一次就换名（§0.1 实测），
  #     挂在它上面每次归零且全程静默；
  #  ② 同一 sha 重跑（"填完裁决再覆盖一轮"那种复用存档 critique）不计数；
  #  ③ 只在驱动**真的被调用过之后**记账 —— 没跑完就记一轮，等于把失败烧进配额。
  # 超限是**升级**：不调模型、打印 escalated、非零退出。绝不是"跑满了就自动放行"。
  _QM6_CHANGE="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
  # CLI 非零退出 = **判据没跑起来**（缺模块 / 权限 / node 不可用），与"账本内容读不出"是两件事：
  # 前者要修的是文件在不在，后者要修的是那份 json。两者都按"无证据"处理（不调模型），
  # 但**必须各说各话**——本刀实测把前者写成后者，会让三条与本刀无关的用例红成
  # "入口说账本坏了"，而照着这句话去查 external-rounds.json 永远查不到东西。
  _QM6_CLI_RC=0
  _QM6_CHK=""
  _QM6_ROUND="?"
  _QM6_CAP="?"
  _QM6_SEEN="0"
  if [ -n "$_QM6_CHANGE" ] && [ -n "$SHA" ]; then
    # 账本路径**不在这里重复拼**：让库里 defaultLedger(change) 单点决定，
    # 否则入口一份、库一份，改了一边就会出现"check 查 A 文件、record 写 B 文件"的静默分叉。
    # 动手前的交付指纹在这里取：超限判据拿它看"本轮是不是零模型复跑"。
    _QM6_BEFORE_FP="$(node scripts/lib/ccg-delivery-digest.js --print-fingerprint="$REC" 2>/dev/null || true)"
    # CLI 自己必须**跑起来了**才算读数。旧写法是 `|| echo '…unreadable=1…'`，它把三件不同的事
    # 压成一句"账本读不出"：账本坏、账本没权限、以及**这个 lib 根本不在**（夹具/部署缺文件）。
    # 第三种曾让三条与本刀无关的用例红成"入口说账本坏了、于是不调模型"——一句与事实无关的归因，
    # 而照着它去查 external-rounds.json 是查不到的。缺模块是**结构性**故障，必须单独一档并说出对象。
    _QM6_CHK="$(node scripts/lib/ccg-review-rounds.js check "$_QM6_CHANGE" "$SHA" --delivery "$_QM6_BEFORE_FP" 2>&1)"
    _QM6_CLI_RC=$?
    if [ "$_QM6_CLI_RC" -ne 0 ]; then
      say "🔴 轮次判据 CLI 未正常退出（rc=${_QM6_CLI_RC}）⇒ 无法证明还有预算，本轮**不调用模型**，交人工。"
      say "  这一档**不是**「账本坏了」：先在下面原文里找 Cannot find module / EACCES——"
      say "  缺文件要修的是 scripts/lib/ccg-review-rounds.js 在不在（夹具或部署没带上），不是 external-rounds.json。"
      say "  CLI 原文（已剥空白投影）："
      say "  $(printf '%s' "$_QM6_CHK" | tr -d '\r' | head -3)"
      exit 1
    fi
    _QM6_KV() { printf '%s' "$_QM6_CHK" | tr ' ' '\n' | sed -n "s/^$1=//p" | head -1; }
    _QM6_ROUND="$(_QM6_KV round)"; _QM6_CAP="$(_QM6_KV max)"
    _QM6_EXCEEDED="$(_QM6_KV exceeded)"; _QM6_UNREADABLE="$(_QM6_KV unreadable)"
    _QM6_NOCHANGE="$(_QM6_KV nochange)"; _QM6_SEEN="$(_QM6_KV seen)"
    # 读数完整性判据（QM-6 第二轮 i5）：这五个键**必须都在且都是纯数字**。
    # 为什么要单独一格：`_QM6_KV` 取不到值时返回空串，而下面每个分支都写 `${...:-0}`，
    # 于是"CLI 输出形状变了"（改文案、加了前导日志、被 || 兜底成半行）在产物上读起来
    # 完全像"没超限、继续跑"——上限这种闸，静默读空等于没有闸。
    _QM6_UNPARSED=0
    for _qm6_k in round max exceeded unreadable seen; do
      _qm6_v="$(_QM6_KV "$_qm6_k")"
      case "$_qm6_v" in (''|*[!0-9]*) _QM6_UNPARSED=1 ;; esac
    done
    if [ "${_QM6_UNPARSED:-0}" = "1" ]; then
      say "外部评审轮次 读数不可用（缺键或非数字）"
    elif [ "${_QM6_UNREADABLE:-0}" = "1" ]; then
      say "外部评审轮次 账本读不出（不可据此证明还有预算）"
    elif [ "${_QM6_EXCEEDED:-0}" = "1" ]; then
      say "外部评审轮次 已记 ${_QM6_ROUND:-?}/${_QM6_CAP:-?}（已达上限 ⇒ 本轮不调用模型）"
    elif [ "${_QM6_SEEN:-0}" = "1" ]; then
      say "外部评审轮次 ${_QM6_ROUND:-?}/${_QM6_CAP:-?}（同一载荷重跑，本轮不计数）"
    else
      _QM6_THIS="?"
      case "${_QM6_ROUND:-}" in (*[!0-9]*|'') ;; (*) _QM6_THIS=$(( _QM6_ROUND + 1 )) ;; esac
      say "外部评审轮次 第 ${_QM6_THIS}/${_QM6_CAP:-?} 轮（本轮真调用外部评审，change=${_QM6_CHANGE}）"
    fi
    if [ "${_QM6_NOCHANGE:-0}" = "1" ]; then
      say "  ⚠ 该分支没有 openspec/changes/<分支>/ 目录 ⇒ 无账本可记，本轮不计数（也不代为创建）。"
    fi
    if [ "${_QM6_UNPARSED:-0}" = "1" ]; then
      say "🔴 轮次读数不可用 ⇒ **不调用模型**，交人工。CLI 原文（已剥空白投影）："
      say "  $(printf '%s' "$_QM6_CHK" | tr -d '\r' | head -3)"
      say "  这一档刻意与「跑满了」分开：那不是配额用尽，是**判据自己没读数**——去修 CLI 或它的输出形状。"
      exit 1
    fi
    if [ "${_QM6_UNREADABLE:-0}" = "1" ]; then
      # 取向反转（第二轮评审 i3）：读不出从前"照常调用 + 一句告警"，等于把闸的开关交给
      # 任何一次 `echo garbage > external-rounds.json`。零成本绕行的闸不叫闸。
      # 与 nochange 分档：连目录都没有 = 这分支没规格（合法）；账本在但读不动 = 证据缺失（拦）。
      say "🔴 轮次账本读不出 ⇒ 无法证明还有预算，本轮**不调用模型**，交人工。"
      say "  要继续跑：人工看一眼那份 external-rounds.json（坏 JSON / 权限 / 被截断），修好再跑；"
      say "  或直接人工收口 —— 不要删了账本文件再跑（那是把证据删了，不是把预算清出来了）。"
      exit 1
    fi
    if [ "${_QM6_EXCEEDED:-0}" = "1" ]; then
      say "🔴 ESCALATED：外部评审已达轮次上限（${_QM6_ROUND}/${_QM6_CAP}），本轮**不再调用模型**，交人工裁决。"
      say "  这不是「评审通过」也不是「评审失败」，是「继续自动跑的边际收益已低于它消耗的额度」。"
      say "  要接着跑：人工确认后清掉该 change 的一条轮次记录，或直接人工收口 —— 不要手写 tier/evidence。"
      exit 1
    fi
  fi
  # 动手前的字节哈希只能在这里取：写回器要据此判断"本次驱动到底写过这条记录没有"。
  # 口径必须与判据侧一致（原始字节 sha256，与本脚本内容寻址段用的 sha256sum 同形），
  # 两侧不同形时 no-write 那一格会永久点不到火 —— 见 ccg-review-writeback.test.js ④-a2。
  _wb_before="$(sha256sum < "$REC" 2>/dev/null | cut -d' ' -f1)"
  # 动手前的**语义指纹**必须由共享实现算（`--print-fingerprint`），不得在 shell 里重抄规范化算法；
  # 只给字节哈希是不够的——外部深审 round 2 i1 就是漏了这一半，「只有时间戳在动」那一格
  # 在真实调用路径上永远触发不了。
  _wb_before_fp="$(node scripts/lib/ccg-delivery-digest.js --print-fingerprint="$REC" 2>/dev/null || true)"
  node "$DRIVER" "$@"
  _wb_rc=$?
  # 记账排在驱动返回**之后**（口径 ③），且必须排在写回之前 —— 写回那段之后就是 exit，
  # 挪到它后面就有不执行的可能（本仓「释放必须发生在控制流正确位置」同型）。
  # 同一 sha 已记过就不再记（口径 ②）。这一步失败不改评审 rc（旁路语义），但要把读数打出来。
  # 总是调用一次 record：计不计这一轮由 **(sha, 交付指纹)** 这个键在库里判，入口不预先跳过。
  # 旧写法是 `[ "$_QM6_SEEN" != "1" ]`（这个 sha 记过就不调用），那正是第二轮评审 i4 中的那一格——
  # 入口一跳过，"同一个 sha 又真跑出一批新交付"这件事在产物上就永远看不见。
  if [ -n "${_QM6_CHANGE:-}" ] && [ -n "$SHA" ]; then
    _qm6_post_fp="$(node scripts/lib/ccg-delivery-digest.js --print-fingerprint="$REC" 2>/dev/null || true)"
    printf '  [rounds] %s\n' "$(node scripts/lib/ccg-review-rounds.js record "$_QM6_CHANGE" "$SHA" --delivery "$_qm6_post_fp" 2>&1 || echo 'counted=0 error=1')"
  fi
  node scripts/ccg-review-writeback.js \
    --record="$REC" --expected-critic="$RB_CRITIC" --before-sha256="$_wb_before" --before-fingerprint="$_wb_before_fp" \
    --adjudication-evidence="$EVIDENCE_ARG" \
    || say "⚠ 写回器自身未能运行（它不改评审 rc）—— 本次 tier/evidence 不会被补齐，需人工核对记录。"
  exit "$_wb_rc"
}

if [ "$DRY" -eq 1 ]; then
  if [ "${DRY_NO_DRIVER:-0}" -eq 1 ]; then
    say ""
    say "[dry-run] 引擎缺失 ⇒ 到此为止（判定记录与模式判定已预览完毕）。"
    exit 0
  fi
  if [ -n "$RB_OVERRIDE_NOTE" ]; then
    say "→ 已向后端请求覆盖：--proposer $RB_PROPOSER --critic $RB_CRITIC"
    say "  （dry-run 不回写判定记录 —— 预览不该改产物；真跑时才会把请求值写进 $REC）"
    exec node "$DRIVER" --dry-run --sha "$SHA" --proposer "$RB_PROPOSER" --critic "$RB_CRITIC"
  fi
  exec node "$DRIVER" --dry-run --sha "$SHA"
fi
if [ -n "$RB_OVERRIDE_NOTE" ]; then
  say "→ 已向后端请求覆盖：--proposer $RB_PROPOSER --critic $RB_CRITIC"
  say "  ⚠ 驱动**验证层**（评审 diff）当前不应用这两个参数（覆盖块只挂在决策层分支），"
  say "    所以本次很可能是「请求了但驱动仍按自己的默认跑」—— 那会由判定记录的"
  say "    reviewBackends × deepReview.performedBy 对账判未闭合，不会被读成通过。"
  # ★ 评审时换了后端，必须把**请求值**写回那份判定记录。不写回的后果不是"少个字段"，
  #   而是假红：check-pr-exec-record.js 的 judgeBackendMismatch 拿记录里的 reviewBackends
  #   （= 提交时清单那份）去比驱动回填的 deepReview.performedBy，于是每一次合法覆盖
  #   都会被读成"请求了 codex、实际由 claude 评审"⇒ 该条深度审查未闭合。
  #   回写失败一律 exit 2：宁可这次审查不跑，也不留一份"会被判红但没人知道为什么"的记录。
  #   ⛔ 这里**不加** `[ -f "$REC" ]` 前置判断：能走到这一行意味着 MODE 已从某个 REC 读出，
  #   记录必然存在（无记录的路径在上面「故障 / 这本就不该有记录」那一分档就退了）。
  #   真出现读不到只可能是运行中途被删 —— 那同样 fail-closed，由 lib 报 ENOENT，
  #   而不是由入口新建一份判定产物（新建等于伪造判定），也不是"出声后继续跑"。
  node scripts/lib/ccg-review-backends.js --critic "$RB_CRITIC" --proposer "$RB_PROPOSER" \
    --record-request "$REC" \
    || { say "✗ 评审时请求的后端没能写回 $REC —— 停止，不启动审查"; exit 2; }
  run_driver_with_writeback --sha "$SHA" --proposer "$RB_PROPOSER" --critic "$RB_CRITIC"
fi
run_driver_with_writeback --sha "$SHA"
