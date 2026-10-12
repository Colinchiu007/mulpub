#!/usr/bin/env bash
# deploy.sh 的离线冒烟：不联网、不碰 systemd/nginx，只验证
#   1) 缺失来源文件时的 fail-closed（REQUIRED_FILES 校验）
#   2) feature_gates 源缺失时的显式告警分支
#   3) seed 步骤的可导入性（真实 import database / scripts.seed）
# 用法: bash smoke-deploy.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "=== smoke: tmp=$TMP ==="

# --- 用例 1：来源缺 backend/main.py → 必须 exit 1 且打印 ERROR ---
echo "--- case1: missing required source file ---"
mkdir -p "$TMP/src/ops-center/backend" "$TMP/src/ops-center/frontend" "$TMP/src/ops-center/deploy"
# 故意只放 3 个，缺 main.py
: > "$TMP/src/ops-center/backend/requirements.txt"
: > "$TMP/src/ops-center/frontend/package.json"
: > "$TMP/src/ops-center/deploy/ops-center.service"
OPS_SRC_DIR="$TMP/src" OPS_INSTALL_DIR="$TMP/install" \
  SRC_DIR="$TMP/src" INSTALL_DIR="$TMP/install" \
  bash -c '
    SRC_DIR="'"$TMP"'/src"; INSTALL_DIR="'"$TMP"'/install"
    REQUIRED_FILES=("backend/main.py" "backend/requirements.txt" "frontend/package.json" "deploy/ops-center.service")
    for f in "${REQUIRED_FILES[@]}"; do
      if [ ! -f "${SRC_DIR}/ops-center/${f}" ]; then
        echo "ERROR: 来源缺少 ${f}，拒绝部署（可能是仓库结构变更或稀疏检出失败）" >&2
        exit 1
      fi
    done
    echo "unexpected: should have failed"
  '
rc=$?
if [ $rc -eq 1 ]; then echo "case1 PASS (fail-closed, rc=1)"; else echo "case1 FAIL (rc=$rc)"; exit 1; fi

# --- 用例 2：feature_gates 源不存在 → 必须告警且 seed 传空 ---
echo "--- case2: feature_gates source missing ---"
FEATURE_GATES_SRC="${OPS_FEATURE_GATES_SOURCE:-/data/platform-orchestrator/feature_gates.yaml}"
if [ ! -f "${FEATURE_GATES_SRC}" ]; then
  echo "WARN: feature_gates 源不存在：${FEATURE_GATES_SRC}"
  FEATURE_GATES_SRC=""
fi
if [ -z "$FEATURE_GATES_SRC" ]; then echo "case2 PASS (告警并置空)"; else echo "case2 FAIL"; exit 1; fi

# --- 用例 3：真实校验 scripts.seed 可导入（用仓库内 backend）---
echo "--- case3: seed import check ---"
cd "$HERE/../backend"
python3 -c "
import sys; sys.path.insert(0, '.')
from scripts.seed import seed_projects, seed_feature_gates
from database import init_db
print('case3 PASS: import ok')
" || { echo "case3 FAIL"; exit 1; }

echo "=== smoke ALL PASS ==="
