---
record: vite-deps-cache-guard
task: Vite optimizeDeps 预构建缓存过期导致渲染层 does-not-provide-an-export 报错——在 dev.js spawn vite 前加机械预检，stale 即清 node_modules/.vite
date: 2026-10-13
sync_status: PENDING
sync_reason: PR 尚未合并，无法取 merge SHA；合并后由后续 docs PR 回填 PASS + merge SHA 并删除 ledger 登记项
sync_backfill_owner: 下一会话（合并后回填）
---

## 本次执行记录：Vite optimizeDeps 缓存过期预检（vite-deps-cache-guard，2026-10-13）【混合 PR】

| 环节 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离声明 | ✅ | 判定 `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → false（含 `apps/desktop/scripts/**` 运行时改动 + workflow 接线）→ 完整质量节拍。worktree `D:\Data\projects\mp-worktrees\mp-vite-deps-cache-guard`（D 盘）+ 裸分支 `vite-deps-cache-guard`。**诚实记录**：严格入口 `start-mp-task.ps1` 因共享根存在他人 26 项未提交 WIP 而 fail-closed 拒绝（`clean=false`），按项目 fallback 纪律改用 PowerShell 原生路径手工 `git worktree add`（未碰共享根任何文件），创建后以 `git worktree list` + `rev-parse --abbrev-ref HEAD` + `rev-parse --show-toplevel` + `status` 四重实证非半失效；`pre-code-edit-guard.ps1` worktree 内 exit 0 |
| 第一性原因 QM-5 ① | ✅ | `.vite/deps` 缓存生成于 10-11 19:44，而导出由 `dbe8e0fa2`（10-13 14:14，#3454）引入。Vite optimizeDeps 缓存指纹只含 lockfile+config、**不含 workspace 源码内容**；dev server 17:01 重启仍复用旧缓存（条目已在 optimized 列表，无新发现不触发重建）。与 504 空白页同根因族（skill 失败表已有 `-InvalidateViteCache` 但 opt-in 且只覆盖旧长流程） |
| 逃逸分析 QM-5 ② | ✅ | 缓存维度无任何机械检查（pre-flight 只校 git 对齐/依赖/端口/electron）；快链路（sync-app + applive-launcher → dev.js）无缓存校验；本次为手动排查发现 |
| 系统性漏洞 QM-5 ③ | ✅ | 启动链路 4 条路径（`pnpm dev` / applive-launcher / `start-desktop.ps1` / 直启 `dev.js`）全部汇到 `dev.js` 第 42 行 spawn vite，**无一处校验缓存新鲜度**——收口点唯一且明确 |
| 修复 QM-5 ④ | ✅ | 新增 `apps/desktop/scripts/vite-dep-cache.js`：mtime 判据（`packages/<pkg>/{src,dist}` 新于 `.vite/deps` ⇒ stale，双向覆盖切新/切旧提交；相等按 fresh；无 source 证据按 fresh 放行）。`dev.js` 在 spawn vite 前调用：stale 清整个 `node_modules/.vite`；清除失败 fail-closed 退出并给唯一修复动作；`MP_VITE_DEPS_CACHE_CHECK=0` 逃生阀（仅排障） |
| 防再犯 QM-5 ⑤ | ✅ | 13 例回归测试（假 fs + 真实 fs `os.tmpdir` 往返 + 反失明下界「真实仓库 source 根 ≥ 10」+ dev.js 接线结构锁）；**5 条变异反证全部 CAUGHT**（M1 判据恒 fresh / M2 清除 no-op / M3 只删 deps 不删 .vite / M4 判据方向反转 / M5 相等算 stale），变异脚本 `finally` 整体还原并复验；测试同 PR 接进 `quality-gate.yml` Gate 2b（未接线 = 永不执行） |
| TDD 与相关域全量 | ✅ | 先红（模块不存在）后绿 13/13。Gate 2b 5 文件 **67/67**；`workflow-contract.test.js` **37/37**（rebase 前 1 红，经 stash 对照实验证实为 origin/main 既有失败、非本 PR 引入，rebase 到 `51d3c0d87` 后由上游 #3477 修复而消失）；`check-unwired-tests.js` OK（180 文件全接线）；`check-step-failfast` 6/6 |
| 变异反证 | ✅ | 5/5 实测 CAUGHT（见上）。反证的是锁本身，不是业务改动 |
| 自纠错记录 | ✅ | 假 fs 初版未登记中间层包目录 ⇒ `readdir(packages)` 空转 ⇒ 4 个 stale 场景假红——正是「夹具对所有输入返回同一数据 ⇒ 对按输入区分的判据结构性免疫」的同型；改为自动补齐祖先目录后全绿 |
| 行尾对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致（提交前复验） |
| 品牌残留 / docs 同步 | ✅ | `check-no-brand-residue.js` 见 CI；无 locale 改动；无 spec 变更 |
| QM-1 打包 | N/A | 未改 `apps/desktop/electron/` 与 `packages/rpa-engine/`，仅 dev 启动脚本（`apps/desktop/scripts/`），打包路径无涉及 |
| QM-4 视觉 | N/A | 无 `.vue` / 样式 / DOM 结构变更 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`。**如实登记为未执行，不冒充已闭合** |
| 已知边界（不假装闭合） | ✅ | ①时间戳保留型拷贝（同步盘 / robocopy 保留 mtime）会漏判——概率极低，已写入模块头注；②裸跑 `node node_modules/vite/bin/vite.js` 绕过 dev.js 者不受保护（仓库无此路径）；③误报（编辑后还原）最坏多一次 ~10s 冷优化，无害 |
| 远程同步 | PENDING | PR 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H|%cI` 回填 PASS + merge SHA，`git ls-remote --heads origin <branch>` 0 行证分支已删，同一次提交删除 ledger 登记项 |

### 关键取证数字
- 缓存 mtime 2026-10-11 19:44（`.vite/deps` 全部条目）vs 导出引入 2026-10-13T06:14Z（`dbe8e0fa2`）；dev server PID 32496 启动 17:01:39 仍复用旧缓存
- 修复后实证：重建产物含 `PLATFORM_CREATOR_HOME_URLS`（文件层 + HTTP `/@fs/` 层双证，200 text/javascript）
