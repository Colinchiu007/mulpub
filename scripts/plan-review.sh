#!/bin/sh
# 质量节拍 — 决策层：方案对抗评审（动手写码之前）
#
# 分层（SKILL.md §5.6.3）：
#   决策层  Phase 1 出方案后、动手前  →  本脚本      objectType=plan
#   验证层  改完之后                  →  deep-review.sh  objectType=code
#
# 这是 adversarial-review-loop 引擎的主流程：
#   出方案 → 跨家族挑刺 → 逐条回应(可拒绝但须给证据) → 多轮收敛 → 才动手
#
# 用法：
#   sh scripts/plan-review.sh <方案文件>       # 对方案跑对抗评审
#   sh scripts/plan-review.sh <方案文件> --dry-run
#   （本入口没有"强制"旗标：判定器对方案输入恒不产出可跳过的那一档 ⇒ 分支不可达，旗标无对象。
#     实测与理由见下面原分支位置的注记。验证层 deep-review.sh 的 --force 另有其病灶。）
#   sh scripts/plan-review.sh <方案文件> --critic codex    # 临时换评审主力后端
#   sh scripts/plan-review.sh <方案文件> --proposer gemini # 临时换出方案后端
#   优先级：旗标 > MP_QM6_CRITIC/MP_QM6_PROPOSER > scripts/ccg-review-backends.list
#   ⚠ 决策层（本脚本，objectType=plan）这条路径**确实应用**覆盖参数；
#     验证层（deep-review.sh 评审 diff）那条路径驱动当前不应用，见其文件头说明。
#
# 退出码：0 收敛可动手 / 1 有阻断或已升级给人 / 2 环境问题

set -u

# 与 deep-review.sh 同一形态：不依赖 dirname（git 钩子/贫瘠 PATH 下会丢工具目录），
# 且必须认 Windows 绝对路径 —— 只匹配 `*/` 的话，调用方传 `D:\...\plan-review.sh`
# 会落到 `_self_dir="."`，ROOT 变成**仓库的父目录**，之后每一处仓库相对读都错位。
# 旧版靠 dirname 也是同一结果（无 `/` 时返回 "."），只是从前脚本里没有仓库相对读，
# 于是错位的 cwd 被 `[ -f ... ]` 挡成「不存在」，看起来一切正常。
_self_dir="$0"
case "$_self_dir" in
  */*) _self_dir="${_self_dir%/*}" ;;
  *\\*) _self_dir="${_self_dir%\\*}" ;;
  *)   _self_dir="." ;;
esac
ROOT="$(cd "$_self_dir/.." && pwd)"
_self_dir_abs="$(cd "$_self_dir" 2>/dev/null && pwd)" || _self_dir_abs="$_self_dir"
cd "$ROOT" || exit 2

# say() 必须定义在参数解析之前：参数错误分支要用它出声（deep-review.sh 同一形态，
# 那里实测漏过一次 —— `--critic` 缺值时报的是 "say: command not found"）。
say() { printf '%s\n' "$1"; }

# 后端对的 shell 侧读取方（单一实现，与 deep-review.sh 共用同一份）。
# 两个入口不得各抄一份名单 —— 那正是 2026-10-18「六份字面量互不认账」的病灶。
# 找不到就当场 fail-closed（与 deep-review.sh 同形）：后续那些
# "resolve_review_backends: command not found" 会把真因（没 source 上）伪装成功能故障。
[ -f "$_self_dir_abs/lib/ccg-backends.sh" ] || {
  say "✗ 找不到评审后端读取方：$_self_dir_abs/lib/ccg-backends.sh"
  say "  入口必须由仓库内路径调用（sh scripts/plan-review.sh），不得经符号链接复制出去跑。"
  exit 2
}
. "$_self_dir_abs/lib/ccg-backends.sh"

PROPOSAL=""
DRY=0
CRITIC_ARG=""
PROPOSER_ARG=""
# 改成 while+shift：原来的 `for a in "$@"` 只认无值旗标，带值旗标会把它的值
# 当成一个陌生参数**静默丢掉** —— 那是「传了等于没传」的直接成因。
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --critic|--proposer)
      _v="${2:-}"
      case "$_v" in
        ""|-*)
          say "✗ 旗标 $1 缺值（必须紧跟一个后端名，例如 --critic codex）"
          exit 2 ;;
      esac
      if [ "$1" = "--critic" ]; then CRITIC_ARG="$_v"; else PROPOSER_ARG="$_v"; fi
      shift ;;
    --help|-h)
      sed -n '2,/^set -u/{/^set -u/!p}' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    -*)
      # 不再静默吞掉未知旗标：出声但不拒（本入口历史上对 -\* 是宽容的，
      # 直接改判红会把别的会话的调用一起打死）。
      say "⚠ 忽略未知旗标：$1（本入口不认它；本脚本只认 --dry-run / --critic <名> / --proposer <名>）" ;;
    *) [ -z "$PROPOSAL" ] && PROPOSAL="$1" ;;
  esac
  shift
done

say() { printf '%s\n' "$1"; }

# ==========================================================================
#  产物目录碰撞拦截（仓侧守卫；根因在仓外引擎）
# ==========================================================================
# 引擎（用户级技能 ~/.claude/skills/adversarial-review-loop/scripts/ccg-deep-review.js）
# 把决策层产物写到 .adversarial/ccg-plan-<slug>/，而 slug = "ccg-plan-" + basename(方案文件去扩展名)
# + "-" + critic —— **只用文件名，不带所在目录**。两个 change 的规划文件都叫 design.md ⇒ 同一 slug
# ⇒ 后跑的静默覆盖先跑的评审现场（critique-v1.md / proposal-v1.md / adjudication.json 全没）。
#
# 实测事故（2026-10-17）：本会话评审 gate-record-sync-derived-status/design.md 时，覆盖了
# commit f66081aec 中另一会话 B1 RPA 反检测评审的 critique-v1.md；那份产物是 tracked 的，
# 靠 git restore 精确路径才救回。引擎住在 git 之外（改它=影响所有会话且下次技能升级会漂移），
# 所以守卫装在仓侧调用点：**先看目的地有没有别人的东西**，有就拒绝运行并给出路。
#
# MP_ARTIFACT_ROOT 仅供回归测试与例外场景覆盖，默认仓库根（与引擎的 REPO 同义）。
ART_ROOT="${MP_ARTIFACT_ROOT:-$ROOT}"
# 覆盖时必须出声（评审 F5）：把 MP_ARTIFACT_ROOT 指到一个空目录就能让守卫看不见任何东西，
# 静默覆盖等于把守卫改成"愿意被摘的锁"。默认路径不打印，避免每次跑都刷一行噪声。
if [ -n "${MP_ARTIFACT_ROOT:-}" ] && [ "$MP_ARTIFACT_ROOT" != "$ROOT" ]; then
  echo "plan-review: 产物根被 MP_ARTIFACT_ROOT 覆盖为 $MP_ARTIFACT_ROOT（碰撞守卫只在被覆盖后的目录里检查；仅供测试）" >&2
fi
# 方案文件不可达时守卫整块被跳过——那正是一条"愿意被摘的锁"。本脚本在第 21 行就
# cd 到 $ROOT，所以从子目录传进来的相对路径到此处已解不进原文件（外部评审 F5 命中，
# 本机实测：守卫一声不吭地放行）。判据不看 rc 也不看内容，只看这一行有没有出声。
if [ -n "$PROPOSAL" ] && [ ! -f "$PROPOSAL" ]; then
  echo "plan-review: 方案文件在仓库根下不可达（$PROPOSAL）⇒ 产物目录碰撞守卫已跳过，请改传绝对路径" >&2
fi
if [ -n "$PROPOSAL" ] && [ -f "$PROPOSAL" ] && [ -d "$ART_ROOT/.adversarial" ]; then
  _pb=$(basename -- "$PROPOSAL"); _pb=${_pb%.*}
  _pb=$(printf '%s' "$_pb" | tr 'A-Z' 'a-z')
  _collide=""
  for _d in "$ART_ROOT/.adversarial/ccg-plan-$_pb-"*; do
    [ -d "$_d" ] || continue
    _stored="$_d/proposal-v1.md"
    [ -f "$_stored" ] || continue
    # 同一份方案（重跑/续跑）不算碰撞；内容不同才是别人的东西。
    cmp -s "$_stored" "$PROPOSAL" || _collide="$_collide ${_d#$ART_ROOT/}"
  done
  if [ -n "$_collide" ]; then
    say "✗ 产物目录碰撞：${_collide# }（方案名「$_pb」在别的方案里已被用过）"
    say "  那些目录里的 proposal-v1.md 与本次方案不是同一份 ⇒ 引擎会按同一个 slug 覆盖别人的评审现场。"
    say "  根因：引擎 slug 只用方案文件名、不带所在目录（2026-10-10 那次修复加了 critic，没加目录维度）。"
    say "  出路：①方案文件起唯一名（推荐，如 design-<change>.md 或直接用 change 目录里的路径名）；"
    say "        ②确属同一方案 ⇒ 先把旧产物目录归档再重跑；"
    say "        ③知情放行：MP_ALLOW_PLAN_COLLISION=1（会在 stderr 留痕，不会静默）。"
    echo "plan-review: 拒绝运行，产物目录碰撞:$_collide" >&2
    [ "${MP_ALLOW_PLAN_COLLISION:-}" = "1" ] || exit 2
    echo "plan-review: 已按 MP_ALLOW_PLAN_COLLISION=1 放行，将覆盖:$_collide" >&2
  fi
fi

# ==========================================================================
#  环境闸：拒绝 WSL
# ==========================================================================
# 与 deep-review.sh 同源的一道闸，防的是**报错文案把人带偏**：
# 本机裸 bash 解析到 WSL shim（C:\windows\system32\bash.exe）时，$HOME 变成
# WSL 的 /home/<user>，Windows 侧的 node / 后端 CLI / codeagent-wrapper 全不可见，
# 本脚本于是打印「找不到 ccg-review-decider.js」并建议设置 CCG_ARL_DIR ——
# 而该变量在 Process/User/Machine 三级作用域**都不存在**，追它是死路。
#
# 决策层（plan）比验证层（code）更没有退路：它还缺 --check-deps 这个诊断入口，
# 真出事时连一条能问的命令都没有，所以更需要在入口就把根因说破。
#
# ⚠ 只拦 WSL，不拦真 Linux（含 GitHub Actions ubuntu runner）——
#   POSIX 分支在真 Linux 上是能工作的，判据写成「必须是 Git Bash」会打死 CI。
#   判据与检测手段的取舍见 deep-review.sh 同名段落（此处不重复展开）。
_is_wsl() {
  [ -n "${WSL_DISTRO_NAME:-}" ] && return 0
  [ -n "${WSL_INTEROP:-}" ] && return 0
  # 兜底：环境变量被 wrapper 清洗过时，只剩内核版本串可认。
  #
  # ⚠⚠ 判据必须**同时**满足「行首是 Linux 内核串」**且**「含 microsoft/WSL」——
  # 不能单看 Microsoft。Git Bash 也有虚拟 /proc 且**可读**（实测本机读到
  # `MINGW64_NT-10.0-26200 version 3.6.9-...`，见 QM-6 评审 i1）：
  # 只认 Microsoft 就可能把 **Git Bash 判成 WSL 而 exit 2**，
  # 恰好打死本闸要保护的那个平台。两者取交集才是无歧义判据。
  # shell 内建 read + 重定向，不经 cat —— 入口不得依赖 PATH 里的工具目录。
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
  say "  WSL 的 \$HOME 是 /home/<user>，Windows 侧的 node、后端 CLI、"
  say "  codeagent-wrapper 全部不可见，所以下面任何「找不到」都是假象。"
  say ""
  say "  根因通常是「裸 bash 解析到了 WSL shim」："
  say "    C:\\windows\\system32\\bash.exe  ← WSL 入口（裸 bash 命中的是它）"
  say "    <Git 安装目录>\\usr\\bin\\bash.exe ← Git Bash（要用的是这个）"
  say ""
  say "  正确跑法（推荐：PowerShell 入口会自动定位 Git Bash 并校验身份）："
  say "    .\\scripts\\ccg-review.ps1 -Mode Plan -Proposal <方案文件>"
  say ""
  say "  最后一句：这**不是**环境变量没传进来。不要去查、不要去设 CCG_ARL_DIR ——"
  say "  该变量在 Process/User/Machine 三级作用域本来就不存在，追它是死路。"
  exit 2
fi

[ -n "$PROPOSAL" ] || {
  say "用法: sh scripts/plan-review.sh <方案文件> [--dry-run]"
  say ""
  say "方案文件通常是 Phase 1 产出的 plan.md / PRD / 技术方案。"
  exit 2
}
[ -f "$PROPOSAL" ] || { say "✗ 找不到方案文件: $PROPOSAL"; exit 2; }

# ---------- 1. node ----------
if ! command -v node >/dev/null 2>&1; then
  [ -d "$HOME/.fnm" ] && eval "$(fnm env --shell sh 2>/dev/null)" 2>/dev/null
fi
command -v node >/dev/null 2>&1 || {
  say "✗ 找不到 node。git 钩子不继承登录 shell 的 PATH，node 常在这里丢失。"
  exit 2
}

# ---------- 2. 定位工具 ----------
DECIDER=""
for c in "$ROOT/scripts/ccg-review-decider.js" \
         "${CCG_ARL_DIR:+$CCG_ARL_DIR/../quality-rhythm/installer/ccg-review-decider.js}"; do
  [ -n "$c" ] && [ -f "$c" ] && DECIDER="$c" && break
done
DRIVER=""
for c in "$ROOT/scripts/ccg-deep-review.js" \
         "${CCG_ARL_DIR:+$CCG_ARL_DIR/ccg-deep-review.js}" \
         "$HOME/.claude/skills/adversarial-review-loop/scripts/ccg-deep-review.js"; do
  [ -n "$c" ] && [ -f "$c" ] && DRIVER="$c" && break
done
[ -n "$DECIDER" ] || { say "✗ 找不到 ccg-review-decider.js（判定器）"; exit 2; }
[ -n "$DRIVER" ]  || { say "✗ 找不到 ccg-deep-review.js（引擎驱动）"; exit 2; }

# ---------- 3. 判定方案复杂度（决策层） ----------
say "═══ 决策层：方案对抗评审 ═══"
say "方案: $PROPOSAL"
say ""
DEC_OUT="$(node "$DECIDER" --input "$PROPOSAL" --print 2>&1)"
printf '%s\n' "$DEC_OUT"
say ""

MODE="$(printf '%s' "$DEC_OUT" | sed -n 's/.*判定 \[\?[^]]*\]\?: *\([A-Z]*\).*/\1/p' | head -1)"
[ -n "$MODE" ] || MODE="$(printf '%s' "$DEC_OUT" | grep -o '\(SKIP\|SINGLE\|DUAL\)' | head -1)"
say "判定: $MODE ⇒ 决策层没有「按规模跳过」那一档（判定器对方案输入恒不给那个档），本入口一律把方案交给驱动评审。"

# （这里原先是一格「判定为最低档就跳过对抗评审，带旗标可强制」的早退分支。2026-10-22 实测
#  它不可达：判定器 isDocsOnly() 对 staged.proposal 首行直接短路，决策层拿不到那个档 ——
#  两种路径形状的 2 行方案都判 SINGLE。于是那行"跳过（可强制）"永远不会打印，旗标也没有
#  可作用的对象，属第二处装饰性承诺，随切片 ccg-force-flag-honest 一并删除（行为逐字不变：
#  S 复杂度方案本来就走到这里再交给驱动）。要引入"方案可按规模豁免"是一个新的门禁豁免，
#  须另立一刀并经人工过目；锁见 scripts/plan-review-deps.test.js 的「不得复活」那条。）

# ---------- 4. 依赖体检 ----------
# 体检体系与 deep-review.sh 同源（ABS-prepend），为什么不只靠 command -v
# 的完整论证见该文件「后端解析」段。要点复述：
#   · 本机进程 PATH 的 C: 盘条目被剥掉盘符，按 cwd 盘符解析，没有任何一条
#     能同时对两个盘符有效 ⇒ command -v 命中不可靠；
#   · wrapper 是 Go 原生进程，exec.LookPath 对无盘符条目拿相对路径后
#     ErrDot 拒绝执行，而 bash 的 command -v 照样成功 ⇒「裸名能解析」
#     推不出「wrapper 能起」。唯一可靠修法是把绝对目录顶到 PATH 最前并导出。
# 决策层（plan）比验证层更不能容忍静默降级：它是质量节拍的第一道闸，
# 在这里少一路跨家族，等于「先对抗再动手」的承诺名存实亡。
WRAPPER="${CODEAGENT_WRAPPER:-$HOME/.claude/bin/codeagent-wrapper.exe}"
{ [ -x "$WRAPPER" ] || [ -f "$WRAPPER" ]; } || {
  say "✗ 找不到 codeagent-wrapper: $WRAPPER"
  say "  生成：npx ccg-workflow"
  exit 2
}

# Windows 风格路径 → POSIX 风格（npm prefix -g 在 Windows 返回反斜杠路径）。
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

# 候选目录清单：与 PATH 无关的三条 + npm prefix + CCG_BACKEND_BIN_DIRS（分号分隔）。
# ⚠ 每个变量都必须写 ${VAR:-}：本函数在 set -u 下运行，
#   `[ -n "$APPDATA" ]` 在未设时会直接中止整个函数、候选列表静默截短
#   （deep-review.sh 的「含空格候选目录」回归测试当场抓过这个坑）。
candidate_dirs() {
  _cd_emit() { _cd_q="$(posix_dir "$1" 2>/dev/null)" || _cd_q=""; [ -n "$_cd_q" ] && printf '%s\n' "$_cd_q"; return 0; }
  [ -n "${HOME:-}" ] && { _cd_emit "$HOME/.local/bin"; _cd_emit "$HOME/bin"; }
  [ -n "${APPDATA:-}" ] && _cd_emit "$APPDATA/npm"
  if command -v npm >/dev/null 2>&1; then
    _pp="$(npm prefix -g 2>/dev/null)" || _pp=""
    [ -n "$_pp" ] && _cd_emit "$_pp"
  fi
  if [ -n "${CCG_BACKEND_BIN_DIRS:-}" ]; then
    _cd_raw_list="$(printf '%s\n' "$CCG_BACKEND_BIN_DIRS" | tr ';' '\n')"
    while IFS= read -r _cd_raw || [ -n "$_cd_raw" ]; do
      [ -n "$_cd_raw" ] && _cd_emit "$_cd_raw"
    done <<EOF
$_cd_raw_list
EOF
  fi
  return 0
}

# `command -v` 报出的路径可能省略 .exe（Git Bash 自动补但不在回报里写回）；
# 且 MSYS 文件测试对扩展名不敏感，必须先查无歧义扩展名再回落裸名。
_resolve_hit() {
  for _rh_c in "$1.exe" "$1.com" "$1.cmd" "$1.bat"; do
    if [ -f "$_rh_c" ]; then
      printf '%s' "$_rh_c"
      return 0
    fi
  done
  printf '%s' "$1"
}

# 探一个后端：命中候选目录即把该目录 prepend 到 PATH 最前并**导出**。
# ⚠ 结果写全局 _RB_CODE/_RB_MSG，绝不走 $(...) 收集——命令替换开子 shell，
#   PATH 修复一退出就丢（deep-review.sh 实测踩过的假绿灯）。
resolve_backend() {
  _rb_tool="$1"
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
  if _rb_hit="$(command -v "$_rb_tool" 2>/dev/null)"; then
    _rb_real="$(_resolve_hit "$_rb_hit")"
    if [ -n "${_rb_prepended:-}" ]; then
      _RB_CODE=ABS
      _RB_MSG="已把绝对目录 $_rb_prepended 补到 PATH 最前；裸名解析到 $_rb_real"
    else
      # PATH 分支不得直接计为可用（QM-6 评审 i1，Critical）：
      # 裸名命中但候选目录未命中，说明后端来自一条「来历不明」的 PATH 条目——
      # 恰是本脚本要防的坏环境（无盘符条目按 cwd 解析 / Go wrapper ErrDot）。
      # 此时「command -v 成功」推不出「wrapper 能起」（见上方 ErrDot 论证），
      # 静默计入可用 = wrapper 起不来仍当双后端用，无告警无修法。
      # 修法：从命中项反推绝对目录并 prepend（升级成 ABS）；推不出就按 MISS。
      # ${_rb_real%/*} 参数展开取目录，不经 dirname——零外部依赖。
      _rb_dir="${_rb_real%/*}"
      if [ -n "$_rb_dir" ] && [ "$_rb_dir" != "$_rb_real" ] && [ -d "$_rb_dir" ]; then
        PATH="$_rb_dir:$PATH"
        export PATH
        _RB_CODE=ABS
        _RB_MSG="裸名命中来自非候选目录，已把其所在目录 $_rb_dir 补到 PATH 最前（裸名 → $_rb_real）"
      else
        _RB_CODE=MISS
        _RB_MSG="裸名解析到 $_rb_real，但无法定位其目录以修复 PATH——按缺失处理"
        return 1
      fi
    fi
    return 0
  fi
  _RB_CODE=MISS
  _RB_MSG="找不到（PATH 与候选目录均未命中）"
  return 1
}

# 逐后端体检并打印。退出码两档：0 配置名单里的后端全部解析到 / 2 有缺失（含 0 个）。
# 必须按**计数**分档（0/1 标志会让「2/2 可用」与「1/2 可用」长得一样），
# 而分母取自 backend_table 的行数，不是写死的 2 —— 同族单后端配置下只有一行，
# 拿 1 当降级会把一份显式配置读成故障。
report_backends() {
  _rb_rc=0
  _rb_n=0
  _rb_total=0
  # 名单来自单一真源（scripts/ccg-review-backends.list + 覆盖），不再写死 claude/opencode。
  # heredoc 而不是管道：管道会把循环体推进子 shell，PATH 的修复就留在子 shell 里了。
  while IFS='|' read -r _rb_b _rb_why _rb_pkg; do
    [ -n "$_rb_b" ] || continue
    _rb_total=$((_rb_total + 1))
    resolve_backend "$_rb_b" || true
    say "  · $_rb_b  [$_RB_CODE] $_RB_MSG（$_rb_why）"
    case "$_RB_CODE" in
      PATH|ABS) _rb_n=$((_rb_n + 1)) ;;
      MISS)
        _rb_rc=2
        say "      ↳ 修法：装一个（npm i -g $_rb_pkg），"
        say "        或把它所在目录写进系统 PATH 后重开终端；"
        say "        也可用 CCG_BACKEND_BIN_DIRS 显式指一个目录" ;;
    esac
  done <<EOF
$(backend_table)
EOF
  case "$_rb_n" in
    0)
      say ""
      say "  ✗ 没有任何评审后端可用 —— 对抗评审根本起不来。" ;;
    "$_rb_total")
      if [ "$RB_CRITIC" = "$RB_PROPOSER" ]; then
        say ""
        say "  ℹ 同族单后端（critic=proposer=$RB_CRITIC）：能跑，但按配置**不参与**跨家族交叉验证。"
      fi ;;
    *)
      say ""
      say "  ⚠ 仅 $_rb_n/$_rb_total 个后端可用 —— 评审能跑，但跨家族交叉验证会缺失。" ;;
  esac
  _RB_OK=$([ "$_rb_n" -ge 1 ] && echo 1 || echo 0)
  return "$_rb_rc"
}

# 先解析后端对再体检：体检消费解析结果，顺序反了就会按老名单出结论
# （六份字面量互不认账就是这个顺序造成的）。解析失败一律早退，不得读成「没配」。
resolve_review_backends || exit 2
if [ -n "$RB_OVERRIDE_NOTE" ]; then
  say "ℹ 评审后端已覆盖：$RB_OVERRIDE_NOTE（critic 来源 $RB_FROM_CRITIC，proposer 来源 $RB_FROM_PROPOSER）"
fi

report_backends || true
say ""
if [ "$_RB_OK" -eq 0 ]; then
  say "✗ 没有可用评审后端，对抗评审起不来。修法见上方逐条。"
  exit 2
fi
say ""
say "开始跨家族对抗评审（出方案 → 挑刺 → 逐条回应 → 收敛，15 分钟以上）…"
say ""

# ---------- 5. 跑引擎（objectType=plan） ----------
# 决策层这条路径**是**驱动真正应用 --proposer/--critic 的地方（覆盖块就挂在
# objectType:"plan" 分支里），所以这里转发即生效。
# 参数逐个加引号、按是否覆盖分成两条 exec（与 deep-review.sh 同一形态，
# 取自 QM-6 外部评审的 Critical 建议）：不拼串就不会把安全性押在字符集正则那一道上。
if [ "$DRY" -eq 1 ]; then
  if [ -n "$RB_OVERRIDE_NOTE" ]; then
    say "→ 已向后端请求覆盖：--proposer $RB_PROPOSER --critic $RB_CRITIC"
    exec node "$DRIVER" --dry-run --proposal "$PROPOSAL" --proposer "$RB_PROPOSER" --critic "$RB_CRITIC"
  fi
  exec node "$DRIVER" --dry-run --proposal "$PROPOSAL"
fi
if [ -n "$RB_OVERRIDE_NOTE" ]; then
  say "→ 已向后端请求覆盖：--proposer $RB_PROPOSER --critic $RB_CRITIC"
  exec node "$DRIVER" --proposal "$PROPOSAL" --proposer "$RB_PROPOSER" --critic "$RB_CRITIC"
fi
exec node "$DRIVER" --proposal "$PROPOSAL"
