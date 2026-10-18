# shellcheck shell=sh
# QM-6 评审后端对的 **shell 侧读取方**（单一实现；被 deep-review.sh 与 plan-review.sh source）。
#
# 为什么是 shell 文件而不是只留 node：`--check-deps` 是「node 本身可能就是坏的」时的
# 第一手诊断入口（见 deep-review.sh 0a 的落点说明），让它依赖 node 等于把要诊断的东西
# 当前提。于是本仓有两个读取方：本文件（sh）与 scripts/lib/ccg-review-backends.js（node）。
# 两个读取方必须逐字给出同一份后端表 —— 对账锁见 scripts/deep-review-deps.test.js
# 「两个读取方必须给出同一份后端表」，它把本文件的 backend_table 输出与 node 的
# --print-table 输出做字节比较，漂移当场判红。
#
# 用法（调用方）：
#   . scripts/lib/ccg-backends.sh
#   resolve_review_backends || exit 2
#   backend_table                  # 每行 <name>|<role>|<pkgHint>，critic 在前、同族只出一行
#
# 消费方不得自己再写一份后端名单（`for x in claude opencode` 那种形态就是本次的病灶）。

# 清单唯一真源：第一行 critic，第二行 proposer。相对仓库根，调用方须已 cd 到根。
BACKEND_LIST_FILE="${BACKEND_LIST_FILE:-scripts/ccg-review-backends.list}"
RB_CRITIC=""
RB_PROPOSER=""
RB_NAMES=""
RB_SOURCE="list"
RB_FROM_CRITIC=""
RB_FROM_PROPOSER=""
RB_OVERRIDE_NOTE=""

# 后端形态判据（shell 安全边界，不是风格）：首字符字母，其后只允许 [A-Za-z0-9._-]，长度 ≤ 32。
# 后端名最终会被拼进 `--backend <name>` 交给 codeagent-wrapper，所以这里挡的是注入字符本身；
# 也正因为过了这道判据，backend_table 才允许把 $RB_NAMES 不加引号交给 shell 拆词。
# （转给驱动的那两个参数**不依赖**这一点：它们逐值加引号，见 deep-review.sh 的 exec 段——
#   QM-6 外部评审的 Critical 就是提这个：拼串再展开等于把安全性单点押在本判据上。）
is_valid_backend() {
  case "$1" in
    [A-Za-z]*) : ;;
    *) return 1 ;;
  esac
  case "$1" in
    *[!A-Za-z0-9._-]*) return 1 ;;
    *) : ;;
  esac
  [ "${#1}" -gt 32 ] && return 1
  return 0
}

# 清单里的有效行（剥 CR、去空行与 # 注释）逐行打到 stdout。
backend_list_rows() {
  [ -f "$BACKEND_LIST_FILE" ] || return 1
  tr -d '\r' < "$BACKEND_LIST_FILE" | while IFS= read -r _l || [ -n "$_l" ]; do
    case "$_l" in
      "") continue ;;
      "#"*) continue ;;
    esac
    [ -n "$_l" ] && printf '%s\n' "$_l"
  done
}

# 与 lib/ccg-review-backends.js 的 roleOf 同表 —— 两张表由上面的对账锁钉在一起。
backend_role() {
  if [ "$1" = "$RB_CRITIC" ] && [ "$1" = "$RB_PROPOSER" ]; then printf '评审与出方案后端（同族单后端）'
  elif [ "$1" = "$RB_CRITIC" ]; then printf '评审后端（主力）'
  elif [ "$1" = "$RB_PROPOSER" ]; then printf '出方案后端 / 跨家族校验'
  else printf '登记后端（未参与本次配对）'
  fi
}

# 与 lib 的 INSTALL_HINT 同表。未登记的名字如实回显「对应 CLI」，
# 不得编造一个包名让人去装不存在的东西。
backend_pkg() {
  case "$1" in
    claude)   printf '@anthropic-ai/claude-code' ;;
    opencode) printf 'opencode-ai' ;;
    codex)    printf '@openai/codex' ;;
    gemini)   printf '@google/gemini-cli' ;;
    *)        printf '对应 CLI' ;;
  esac
}

# 渲染后端表：critic 在前、proposer 在后，同族（两格同名）只出一行。
# 用 heredoc 而不是管道喂调用方的 while 循环 —— 管道会把循环体推进子 shell，
# 而 resolve_backend 对 PATH 的修复必须留在调用方那个 shell 里（deep-review.sh 的既有教训）。
backend_table() {
  _bt_seen=""
  for _bt_b in $RB_NAMES; do
    case " $_bt_seen " in
      *" $_bt_b "*) continue ;;
    esac
    _bt_seen="$_bt_seen $_bt_b"
    printf '%s|%s|%s\n' "$_bt_b" "$(backend_role "$_bt_b")" "$(backend_pkg "$_bt_b")"
  done
}

# 解析顺序：旗标 > 环境变量 > 清单文件。
# CRITIC_ARG / PROPOSER_ARG 由调用方从自己的命令行解析出来（本文件不碰 "$@"，
# 因为两个入口的参数形状不同：plan-review.sh 还有一个位置参数 <方案文件>）。
resolve_review_backends() {
  _rr_rows="$(backend_list_rows 2>/dev/null)" || _rr_rows=""
  _rr_n=0
  _rr_c=""
  _rr_p=""
  if [ -n "$_rr_rows" ]; then
    while IFS= read -r _rr_l; do
      [ -n "$_rr_l" ] || continue
      _rr_n=$((_rr_n + 1))
      if [ "$_rr_n" -eq 1 ]; then _rr_c="$_rr_l"; else _rr_p="$_rr_l"; fi
    done <<EOF
$_rr_rows
EOF
  fi
  if [ -z "$_rr_rows" ]; then
    # 清单缺失：回落与 node 侧 DEFAULTS 同一对值，并**出声**（静默回落会把
    # 「改了清单但没人读到」重新变成不可见）。
    _rr_c="claude"
    _rr_p="opencode"
    RB_SOURCE="default(missing list)"
    printf '%s\n' "⚠ 评审后端清单缺失（$BACKEND_LIST_FILE），已回落默认 critic=claude proposer=opencode。"
  elif [ "$_rr_n" -ne 2 ]; then
    printf '%s\n' "✗ 评审后端清单形态不合法：$BACKEND_LIST_FILE 有效行数=$_rr_n（必须是 2 行：第一行 critic、第二行 proposer）。"
    return 2
  fi
  RB_CRITIC="$_rr_c"
  RB_PROPOSER="$_rr_p"
  RB_FROM_CRITIC="$RB_SOURCE"
  RB_FROM_PROPOSER="$RB_SOURCE"
  if [ -n "${MP_QM6_CRITIC:-}" ]; then RB_CRITIC="$MP_QM6_CRITIC"; RB_FROM_CRITIC="env"; fi
  if [ -n "${MP_QM6_PROPOSER:-}" ]; then RB_PROPOSER="$MP_QM6_PROPOSER"; RB_FROM_PROPOSER="env"; fi
  if [ -n "${CRITIC_ARG:-}" ]; then RB_CRITIC="$CRITIC_ARG"; RB_FROM_CRITIC="cli"; fi
  if [ -n "${PROPOSER_ARG:-}" ]; then RB_PROPOSER="$PROPOSER_ARG"; RB_FROM_PROPOSER="cli"; fi
  for _rr_v in "$RB_CRITIC" "$RB_PROPOSER"; do
    if ! is_valid_backend "$_rr_v"; then
      printf '%s\n' "✗ 评审后端名不合法：$_rr_v（只允许字母开头的 [A-Za-z0-9._-]，长度 ≤ 32）。"
      printf '%s\n' "  来源可能是清单文件 $BACKEND_LIST_FILE、MP_QM6_CRITIC/MP_QM6_PROPOSER 或 --critic/--proposer。"
      return 2
    fi
  done
  # 覆盖判据取「与清单里的值是否不同」而不是「有没有传旗标」：env 显式写了与清单相同的值
  # 不构成覆盖，那种情况报覆盖会给每个正常 PR 多打一行噪声。
  if [ "$RB_CRITIC" = "$_rr_c" ] && [ "$RB_PROPOSER" = "$_rr_p" ]; then
    RB_OVERRIDE_NOTE=""
  else
    RB_OVERRIDE_NOTE="critic=$RB_CRITIC proposer=$RB_PROPOSER"
  fi
  RB_NAMES="$RB_CRITIC $RB_PROPOSER"
  return 0
}
