#!/bin/bash
set -e
echo "=== OpsCenter Deploy ==="

# ---- 部署根与安装目录（唯一事实源）----
# ⚠️ 曾长期不一致：setup-service.sh 用 /opt/ops-center（systemd WorkingDirectory 也指向它），
#    而本脚本用 /root/ops-center —— 后部署者会把代码放到 systemd 不认的位置，服务起不来。
#    现以 ops-center.service 的 WorkingDirectory 为准，两处统一为 INSTALL_DIR；
#    仍可用 OPS_INSTALL_DIR 覆盖（覆盖时三个文件必须同时生效，见 FILES 校验）。
INSTALL_DIR="${OPS_INSTALL_DIR:-/opt/ops-center}"
SRC_DIR="${OPS_SRC_DIR:-/root/ops-center-src}"

# ---- 1. Sync code from GitHub ----
# ⚠️ 曾 clone Colinchiu007/ops-center —— 该仓库 2026-08-10 已并入 mulpub（git subtree）并归档，
#    其 deploy/ 缺 setup-service.sh（最后一条提交即「标注本仓库已并入 Multi-Publish（归档）」）。
#    从它 clone 会把 2026-08 的归档快照部署上线。现统一从 mulpub 取 ops-center/ 子目录。
REPO_URL="${OPS_REPO_URL:-https://github.com/Colinchiu007/mulpub.git}"
if [ -d "${SRC_DIR}/.git" ]; then
    git -C "${SRC_DIR}" fetch --depth 1 origin main
    git -C "${SRC_DIR}" checkout --force FETCH_HEAD
else
    rm -rf "${SRC_DIR}"
    git clone --depth 1 --filter=blob:none --sparse "${REPO_URL}" "${SRC_DIR}"
    git -C "${SRC_DIR}" sparse-checkout set ops-center
fi

# 2. Install backend deps + stage code to INSTALL_DIR
mkdir -p "${INSTALL_DIR}"
# 先校验来源完整，再 rsync：避免半成品覆盖线上代码（rsync --delete 会删掉目标独有文件）
REQUIRED_FILES=("backend/main.py" "backend/requirements.txt" "frontend/package.json" "deploy/ops-center.service")
for f in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "${SRC_DIR}/ops-center/${f}" ]; then
        echo "ERROR: 来源缺少 ${f}，拒绝部署（可能是仓库结构变更或稀疏检出失败）" >&2
        exit 1
    fi
done
cp -r "${SRC_DIR}/ops-center/." "${INSTALL_DIR}/"
cd "${INSTALL_DIR}/backend"
pip install -r requirements.txt --break-system-packages -q

# 3. Seed DB (idempotent)
# feature_gates 源：未显式配置时 scripts/seed.py 只探测 Windows 开发机路径与 ~/，
# 服务器上必然缺失 → 功能开关静默为空（页面 404）。故默认给服务器上常见位置，并显式告警。
FEATURE_GATES_SRC="${OPS_FEATURE_GATES_SOURCE:-/data/platform-orchestrator/feature_gates.yaml}"
if [ ! -f "${FEATURE_GATES_SRC}" ]; then
    echo "WARN: feature_gates 源不存在：${FEATURE_GATES_SRC}" >&2
    echo "      → 功能开关将不导入（功能开关页会空/404）。" >&2
    echo "      → 请放置该文件或用 OPS_FEATURE_GATES_SOURCE 指定正确路径后重跑。" >&2
    FEATURE_GATES_SRC=""
fi
python3 -c "
import asyncio, sys
sys.path.insert(0, '.')
from database import init_db
from scripts.seed import seed_projects, seed_feature_gates
async def main():
    await init_db()
    await seed_projects()
    src = sys.argv[1] or None
    n = await seed_feature_gates(src)
    print('feature gates seeded:', n, 'from', src or '(none)')
asyncio.run(main())
" "${FEATURE_GATES_SRC}"

# 4. Build frontend
cd "${INSTALL_DIR}/frontend"
npm install --silent
npm run build

# 5. Copy frontend static files to nginx path
mkdir -p /var/www/ops-center
cp -r dist/* /var/www/ops-center/

# 6. Update nginx config
if [ -f /tmp/nginx-ops.conf ]; then
    cp /tmp/nginx-ops.conf /etc/nginx/conf.d/ops-center.conf
    nginx -t && systemctl reload nginx
fi

# 7. Restart service
cp "${INSTALL_DIR}/deploy/ops-center.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable ops-center
systemctl restart ops-center

echo "=== OpsCenter deployed ==="
echo "install dir: ${INSTALL_DIR}"
curl -s http://127.0.0.1:8010/health
