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
#   sh scripts/deep-review.sh --force      # 忽略 mode=skip，强制跑
#   sh scripts/deep-review.sh --dry-run    # 只打印将要做什么
#   sh scripts/deep-review.sh --check-deps # 只体检评审后端依赖（不需要 node / git 记录）
#
# 退出码：0 无阻断 / 1 有阻断 / 2 环境或配置问题

set -u

# 刻意不依赖 dirname：这行在任何别的检查之前跑，是全脚本第一个外部依赖。
# 用 dirname 的话，--check-deps 这个「环境坏掉时的第一手诊断」会先被
# `dirname: command not found` 打死——而本机 PATH 恰恰是会丢工具目录的那种
# （见下面「后端解析」注释）。参数展开版对相对/绝对 $0 语义完全一致。
_self_dir="$0"
case "$_self_dir" in
  */*) _self_dir="${_self_dir%/*}" ;;
  *)   _self_dir="." ;;
esac
ROOT="$(cd "$_self_dir/.." && pwd)"
cd "$ROOT" || exit 2

FORCE=0
DRY=0
CHECK_DEPS=0
for a in "$@"; do
  case "$a" in
    --force) FORCE=1 ;;
    --dry-run) DRY=1 ;;
    --check-deps) CHECK_DEPS=1 ;;
    --help|-h)
      sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
  esac
done

say() { printf '%s\n' "$1"; }

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
  for _sb_b in claude opencode; do
    if _sb_hit="$(command -v "$_sb_b" 2>/dev/null)"; then
      say "  · 裸名自检 $_sb_b → $(_resolve_hit "$_sb_hit")"
    else
      say "  · 裸名自检 $_sb_b → 仍不可解析"
      _RB_SELF_RC=2
    fi
  done
}

# 逐个后端体检并打印。
# 退出码刻意分三档而不是「有一个能跑就算过」——单后端正是本条坑造成的降级形态，
# 把它做成 0 会让体检失去意义：
#   0  两个后端都在（双模型齐备）
#   2  有后端缺失（能跑则降级；两个都缺时另加硬提示）
#
# 副作用：把 _RB_OK / _RB_RC 暴露给调用方，主流程要靠它决定是继续还是早退。
report_backends() {
  _rb_rc=0
  _rb_n=0
  for _rb_b in claude opencode; do
    case "$_rb_b" in
      claude)   _rb_why="评审后端（主力）"; _rb_pkg='@anthropic-ai/claude-code' ;;
      opencode) _rb_why="出方案后端 / 跨家族校验"; _rb_pkg='opencode-ai' ;;
    esac
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
  done
  # ⚠ 必须按**计数**分档，不能只看「有没有」。
  #   只看 0/1 标志时，2/2 可用与 1/2 可用长得一模一样，
  #   于是双模型齐备也会打印「只剩单后端」（本 PR 自查时当场发现）。
  case "$_rb_n" in
    0)
      say ""
      say "  ✗ 没有任何评审后端可用 —— 深度审查根本起不来。" ;;
    1)
      say ""
      say "  ⚠ 只剩单后端可用 —— 评审能跑，但跨家族交叉验证会缺失（这正是本条坑的形态）。" ;;
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
  say "✗ 找不到 ccg-deep-review.js。"
  say "  三种解法任选其一："
  say "    a) 把 adversarial-review-loop 的 scripts/ vendor 到本仓库 scripts/ 下"
  say "    b) 安装技能：npx ccg-workflow"
  say "    c) 设置 CCG_ARL_DIR 指向引擎目录"
  exit 2
fi

# ---------- 3. 读判定记录 ----------
SHA="$(git rev-parse HEAD 2>/dev/null || echo '')"
[ -n "$SHA" ] || { say "✗ 不在 git 仓库内"; exit 2; }
# 相对路径：node 的 require() 不认 POSIX 路径，脚本已 cd 到仓库根，用相对路径最稳
REC=".ccg/reviews/$SHA.json"

MODE=""
if [ -f "$REC" ]; then
  MODE="$(node -e "try{process.stdout.write(require('./$REC').mode||'')}catch(e){}" 2>/dev/null)"
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
    MODE="$(node -e "try{process.stdout.write(require('./$REC').mode||'')}catch(e){}" 2>/dev/null)"
    [ -n "$MODE" ] && say "判定记录按父提交 sha 命中：${_PARENT%${_PARENT#????????}}（提交时 HEAD 即父提交）"
  fi
fi

say "═══ CCG 深度审查（本地） ═══"
say "HEAD: ${SHA%${SHA#????????}}"
if [ -z "$MODE" ]; then
  say "判定记录: 无 —— 提交时没跑判定器"
  say ""
  say "请先提交一次（pre-commit 会生成 .ccg/reviews/<sha>.json），再跑本脚本。"
  say "或用 --dry-run 看本脚本将要做什么。"
  exit 0
fi
say "判定: $(echo "$MODE" | tr '[:lower:]' '[:upper:]')"

if [ "$MODE" = "skip" ] && [ "$FORCE" -eq 0 ]; then
  say "→ S 复杂度低风险，按决策矩阵跳过深度审查（--force 可强制）"
  exit 0
fi

# ---------- 4. 依赖体检 ----------
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

# ---------- 5. 跑 ----------
if [ "$DRY" -eq 1 ]; then
  exec node "$DRIVER" --dry-run --sha "$SHA"
fi
exec node "$DRIVER" --sha "$SHA"
