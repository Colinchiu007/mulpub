#!/usr/bin/env bash
# start-desktop-wsl.sh — Multi-Publish 桌面启动（WSL/Ubuntu-E 环境）
#
# 与 start-desktop.ps1（Windows）对应，保证 WSL 端启动 = 最新代码 + 共享数据。
#
# 设计要点（2026-09-03 双环境支持）：
#  1) 共享 userData：仓库根 shared-user-data/.shared-data-anchor 锚点已建，
#     startup-compat.js 会自动检测并启用共享目录（WSL/Windows 数据一致）。
#     ⚠️ 因此默认【不传】ELECTRON_USER_DATA_DIR / --user-data-dir ——
#     显式值优先级最高，会绕过锚点导致数据分裂。需要临时隔离时才显式传。
#  2) Electron 二进制：项目 node_modules/electron/dist/electron 是 Linux ELF，
#     但缺 5 个 GUI 库（libnspr4/libnss3/libnssutil3/libsmime3/libasound），
#     通过 LD_LIBRARY_PATH 指向持久库目录 ~/mp-wsl-deps/electron-libs。
#  3) 依赖树：项目 node_modules 是 Windows 版（缺 @rollup/rollup-linux-x64-gnu），
#     WSL 端必须用 Linux 版依赖树 —— 本脚本所在 worktree 即 Linux 安装。
#  4) 端口：默认 vite=5174 cdp=9222（与 Windows 端不同时跑）；可用
#     MP_VITE_PORT / MP_CDP_PORT 覆盖（9222 常被无关 Chrome 占用）。
#
# 用法：
#   bash scripts/start-desktop-wsl.sh [--worktree <dir>] [--no-sync] [--json]
#   bash scripts/start-desktop-wsl.sh --electron-bin <path> --libs-dir <dir>  # 手动指定

set -euo pipefail

# ── 参数 ─────────────────────────────────────────────────────────────
WORKTREE=""
NO_SYNC=0
JSON=0
ELECTRON_BIN=""
LIBS_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --worktree) WORKTREE="$2"; shift 2 ;;
    --no-sync) NO_SYNC=1; shift ;;
    --json) JSON=1; shift ;;
    --electron-bin) ELECTRON_BIN="$2"; shift 2 ;;
    --libs-dir) LIBS_DIR="$2"; shift 2 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${WORKTREE:-$(cd "$SCRIPT_DIR/.." && pwd)}"

# ── 0. 环境判定 ─────────────────────────────────────────────────────
if [[ "$(uname -s)" != "Linux" ]]; then
  echo "❌ 本脚本只在 WSL/Linux 下运行；Windows 请用 start-desktop.ps1" >&2
  exit 1
fi

# ── 1. 依赖树（Linux 版）── 自动探测 Linux 依赖 worktree ────────────
# 项目 node_modules 是 Windows 版（缺 @rollup/rollup-linux-x64-gnu 等），
# WSL 端必须用独立 Linux 依赖树。默认 ~/mp-wsl-deps/mp-wsl（持久，WSL 重启不丢）。
# 可用 --worktree 指向该 Linux worktree（REPO_ROOT 即它）。
LINUX_DEPS_ROOT="${WORKTREE:-$HOME/mp-wsl-deps/mp-wsl}"
if [[ ! -d "$LINUX_DEPS_ROOT/node_modules/vite" ]]; then
  echo "❌ Linux 依赖树缺失: $LINUX_DEPS_ROOT/node_modules/vite" >&2
  echo "   请先搭建 WSL 持久依赖 worktree：" >&2
  echo "     git -C <repo> worktree add -b local/wsl-run ~/mp-wsl-deps/mp-wsl origin/main" >&2
  echo "     cd ~/mp-wsl-deps/mp-wsl && pnpm install --frozen-lockfile && node scripts/ensure-electron.js" >&2
  exit 1
fi
# REPO_ROOT 指向 Linux 依赖 worktree（代码 + Linux node_modules 一体）
REPO_ROOT="$LINUX_DEPS_ROOT"

# ── 2. 同步最新代码（可选）──────────────────────────────────────────
if [[ "$NO_SYNC" -ne 1 ]]; then
  echo "→ git fetch + 落后则同步 ..."
  git -C "$REPO_ROOT" fetch origin 2>/dev/null || true
  counts="$(git -C "$REPO_ROOT" rev-list --left-right --count HEAD...origin/main 2>/dev/null || echo "0 0")"
  read -r ahead behind <<<"$counts"
  if [[ "${behind:-0}" -gt 0 ]]; then
    echo "  落后 origin/main ${behind} 个提交，merge --ff-only ..."
    git -C "$REPO_ROOT" merge --ff-only origin/main
  fi
  # 合并后校验：落后必须为 0
  after="$(git -C "$REPO_ROOT" rev-list --left-right --count HEAD...origin/main 2>/dev/null || echo "0 0")"
  read -r _after_a _after_b <<<"$after"
  if [[ "${_after_b:-1}" -gt 0 ]]; then
    echo "❌ 同步后仍落后 origin/main（$after）——拒绝启动，避免用旧代码" >&2
    exit 1
  fi
fi

HEAD_SHORT="$(git -C "$REPO_ROOT" log -1 --format='%h %s')"
BRANCH="$(git -C "$REPO_ROOT" branch --show-current)"

# ── 3. 端口 ─────────────────────────────────────────────────────────
VITE_PORT="${MP_VITE_PORT:-5174}"
CDP_PORT="${MP_CDP_PORT:-9222}"

# ── 4. 定位 electron 与 GUI 库 ──────────────────────────────────────
ELECTRON_BIN="${ELECTRON_BIN:-$REPO_ROOT/node_modules/electron/dist/electron}"
LIBS_DIR="${LIBS_DIR:-$HOME/mp-wsl-deps/electron-libs}"

if [[ ! -x "$ELECTRON_BIN" ]]; then
  echo "❌ electron 二进制不存在/不可执行: $ELECTRON_BIN" >&2
  exit 1
fi
if [[ ! -f "$LIBS_DIR/libnspr4.so" ]]; then
  echo "❌ GUI 库目录缺少 libnspr4.so: $LIBS_DIR" >&2
  echo "   请先准备持久库目录（从 /tmp/electron-libs/extracted/usr/lib/x86_64-linux-gnu/ 复制）" >&2
  exit 1
fi
export LD_LIBRARY_PATH="$LIBS_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export DISPLAY="${DISPLAY:-:0}"

# ── 4b. 共享 userData（WSL/Windows 数据一致）────────────────────────
# 锚点位于共享主仓库 /mnt/d/Data/projects/mulpub/shared-user-data。
# Linux worktree（~/mp-wsl-deps/mp-wsl）不含该目录，startup-compat 上溯找不到锚点，
# 因此这里显式传 --user-data-dir 指向共享目录，确保两端共用同一数据。
SHARED_DATA_DIR="/mnt/d/Data/projects/mulpub/shared-user-data"
if [[ ! -f "$SHARED_DATA_DIR/.shared-data-anchor" ]]; then
  echo "❌ 共享数据锚点缺失: $SHARED_DATA_DIR/.shared-data-anchor" >&2
  echo "   请先在 Windows PowerShell 或 WSL 创建：" >&2
  echo "     mkdir -p $SHARED_DATA_DIR && printf 'anchor' > $SHARED_DATA_DIR/.shared-data-anchor" >&2
  exit 1
fi
mkdir -p "$SHARED_DATA_DIR"

# ── 5. 启动 vite（后台）+ electron（前台）────────────────────────────
cd "$REPO_ROOT/apps/desktop"

# 先停同 worktree 的旧 vite/electron
pkill -f "vite.*--port $VITE_PORT" 2>/dev/null || true
pkill -f "electron/dist/electron.*$REPO_ROOT/apps/desktop" 2>/dev/null || true

echo "→ 启动 vite :$VITE_PORT ..."
node "$REPO_ROOT/node_modules/vite/bin/vite.js" --host 127.0.0.1 --port "$VITE_PORT" --strictPort &
VITE_PID=$!

# 等 vite 就绪（最多 60s）
for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:$VITE_PORT/" >/dev/null 2>&1; then break; fi
  sleep 1
done

echo "→ 启动 electron（共享 userData: $SHARED_DATA_DIR）..."
echo "  bin: $ELECTRON_BIN"
echo "  cdp: $CDP_PORT"
export ELECTRON_USER_DATA_DIR=""
export DEV_SERVER_PORT="$VITE_PORT"
"$ELECTRON_BIN" \
  --no-sandbox \
  --disable-gpu \
  --in-process-gpu \
  --disable-gpu-compositing \
  "--user-data-dir=$SHARED_DATA_DIR" \
  "--remote-debugging-port=$CDP_PORT" \
  "$REPO_ROOT/apps/desktop/electron/main.js" &
ELECTRON_PID=$!

echo "---"
echo "worktree : $REPO_ROOT"
echo "branch   : $BRANCH"
echo "head     : $HEAD_SHORT"
echo "vitePort : $VITE_PORT"
echo "cdpPort  : $CDP_PORT"
echo "vitePid  : $VITE_PID"
echo "electronPid: $ELECTRON_PID"

trap 'kill $VITE_PID $ELECTRON_PID 2>/dev/null || true' EXIT INT TERM
wait "$ELECTRON_PID"
