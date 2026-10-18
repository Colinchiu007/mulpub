---
record: sidebar-collapse-toggle
task: 主窗口全局新增「左侧菜单收起/展开」按钮，并同步主进程内嵌视图全宽重排
date: 2026-10-18
---

## 本次执行记录：主窗口左侧菜单收起/展开（sidebar-collapse-toggle，2026-10-18）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 混合 PR：运行时代码（`apps/desktop/src/**`、`apps/desktop/electron/**`）⇒ 隔离 worktree `mp-worktrees/mp-sidebar-collapse-toggle`（相对仓库父目录）、裸分支 `sidebar-collapse-toggle`（`git branch --show-current` 实证）；文档（`01-docs/`、`openspec/`、`CHANGELOG.md`）同分支随同一 PR 落地，不直推 `main` |
| 第一性原因（QM-5 ①） | 新功能（无历史缺陷可追溯） | 设计动因见 `01-docs/PRD-SIDEBAR-COLLAPSE-TOGGLE-2026-10-18.md` §1：①侧栏只有 200px/68px 两态、无用户可控收起；②内嵌 `WebContentsView` 由主进程定位、不跟随 DOM，仅 CSS 隐藏会造成左侧死区；③`MIN_SIDEBAR_WIDTH=1` 守卫禁止用 `width=0` 表达收起 |
| 逃逸分析（QM-5 ②） | N/A（新功能） | 本 change 不修复既有缺陷；把「实现漏环（preload/通道/handler/两个子管理器任一缺失）」当作潜在缺陷面，逐环回归锁见下一行 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 先红后绿：新增 9 个测试文件 + 4 个既有文件补用例。**通过读数**：① 受影响面定向跑 `vitest run src/stores/sidebar-collapse.test.js src/components/SidebarToggleButton.test.js src/components/TabBar.sidebar-toggle.test.js src/App.sidebar-collapse.test.js src/sidebar-collapse-chain.test.js` ⇒ 5 files / 23 tests 全绿（含跨进程链路 3 例）；② 主进程面 `vitest run electron/services/{view-bounds,webview-manager,auth-view-manager,qrcode-login}.test.js electron/preload/page-manager.sidebar-collapse.test.js` ⇒ 5 files / 182 tests 全绿；③ 既有契约面 `vitest run src/components/TabBar.test.js src/shell-mode-6a.test.js src/tab-independent-home.test.js src/icon-usage.test.js src/locales/structure-lock.test.js src/publish-draft-keepalive.test.js src/publish-tab-state-keepalive.test.js electron/tests/ipc-exposure-contract.test.js electron/window.test.js` ⇒ 9 files / 148 tests 全绿；④ `src/App.dispatch-failed.test.js` + `src/main.bundle-contract.test.js` ⇒ 2 files / 13 tests 全绿。**全量本地套件未跑完（按设计不等）**：本机 `vitest run` 约 1000 个测试文件、每文件 jsdom 环境初始化数十秒，48 个文件全绿后主动终止；全量由 CI `QG Unit Tests` + `QG Desktop Shards` 覆盖。**手工 UI 验证**：Playwright 起本 worktree 的 Vite（5175）实跑 18 项断言全过（TabBar36/NavBar40=76px、按钮贴标签区最左、双 chevron SVG、aria-pressed/label 翻转、收起后 workspace 1280 全宽、刷新后保持收起、再点恢复 200px/1080px、无控制台错误）；截图在 `%TEMP%\mp-sidebar-toggle-verify\`（不入库） |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 规格把跨进程链路写成 7 条 Requirement / 15 个 Scenario（`openspec/changes/sidebar-collapse-toggle/specs/sidebar-collapse-toggle/spec.md`，漏一环即有一条 Scenario 无对应实现）；② 新增回归锁覆盖「持久化非法值/读写抛错/幂等/非布尔忽略」「按钮 DOM 位置与 tablist 收窄」「登录/扫码视图同步全宽」「width=0 守卫不被绕过」「preload 通道名」；③ **跨进程链路端到端锁** `src/sidebar-collapse-chain.test.js`：真实 preload + 真实 ipc-handlers + 真实 layout + 真实 view-bounds 串成一条链，关闭深度审查 i2（避免「每跳都有测试、整链从未接起来」的假绿）；④ `01-docs/learnings.md` 沉淀 5 条可复用判据（全局 UI 必然改全部基线、width=0 不可表达收起、原生视图必须同步重排、tablist 只包 tab、w>0 守卫复用）；⑤ 接线棘轮见下一行 |
| 行尾与 diff 对账 | ✅ | `git diff --cached --numstat` 与 `git diff --cached --ignore-cr-at-eol --numstat` 逐字节一致（35 files / +1980 / −14）；全部改动/新增文本文件工作树为 CRLF（无 BOM），`.gitattributes` 的 `* text=auto` 负责入库归一。删除数归因（合计 14 行、无整文件删除，全部是被替换的旧行）：`THIRD-PARTY-NOTICES.md` 1、`preload/page-manager.js` 1、`auth-view-manager.js` 2、`qrcode-login.js` 2、`view-bounds.js` 3、`webview-manager/layout.js` 2、`App.vue` 1、`TabBar.vue` 2 |
| 接线棘轮 | ✅ | 新增测试文件均落在 `apps/desktop/src/**/*.test.js` 与 `apps/desktop/electron/preload/**/*.test.js`；`apps/desktop/vitest.config.js` 的 `include` 白名单已含 `src/**/*.test.{js,ts}`、`electron/services/**/*.test.{js,ts}`、`electron/preload/**/*.test.{js,ts}`，新文件被自动收集，不落在 `scripts/` 检查域内 |
| QM-1 打包 / QM-4 视觉 | QM-1 ✅；QM-4 ✅（CI 同源重建 + 逐像素复核） | QM-1：`pnpm exec electron-builder --win --x64 --publish never` exit 0；产物 `app.asar` 150026 KB / `Multi-Publish.Setup.0.2.0.exe` 生成。启动三层判据：`spawnSync` 8s 窗口 `ETIMEDOUT`（存活、未提前退出），stderr 空（0 字节）；子进程 env 已剔除 `ELECTRON_RUN_AS_NODE`（父环境确实带着该变量，已出声告警，未静默剔除）。产物核验 17 项全 PASS：asar 含 view-bounds/layout/ipc-handlers/auth-view-manager/qrcode-login/preload page-manager/preload bundle/renderer bundle，测试文件未入包；产物内 `computeEmbeddedViewBounds` 实算展开 x=200/1224、收起 x=0/1424、width=0 仍回落 200；layout/ipc/preload 源码含新方法与新通道。QM-4：CI round2 `QG Visual` 的 `Gate 7`（6% 阈值）与 `Gate 7c` 暗档对比度均 PASS，`Gate 7b` 按预期红（round1 38/43、round2 36/43，2 张单轮证据），变化像素全部落在顶部壳层（pixelmatch threshold=0.1：487–513 px / 0.023–0.025%）。已从同 run artifact 重建 38 张基线（20 暗 + 18 亮；其中 `home-baseline.png` / `create-story2video-detail.png` 因 round2 未重采，取同 run round1 的 `-current` 渲染），3 张 autonomous-loop 专属基线（settings-general / login-form / analytics-overview）不受影响、保持不变。重建后 `node scripts/check-baseline-freshness.js --renders=<merged CI renders> --partial` 实测：检查 43 / 违规 0 / 40 张逐像素相等 / 3 张已知无渲染；另用 pngjs 逐像素审计确认 33/38 差异完全限于顶部壳层，5 张在阈值 0.1 下不计的亚像素 AA 噪声（≤7,728 px），未发现内容区/侧栏布局变化。PR 内未执行本机 `--update-baseline` |
| QM-6 CCG 双模型外部评审 | ✅ needs_revision（2 Warning：i1 假阳性、i2 已修复） | 本机后端实测可用（`codeagent-wrapper` + `claude` + `opencode`，`-CheckDeps` PASS），执行 `powershell -File scripts/ccg-review.ps1 -Mode Deep`：claude(critic) × opencode(proposer) 双模型、最多 3 轮，产出 2 条 Warning、0 Critical、dimension 最低 6；第 3 轮收敛到自扮演出口。**逐条处置**：i1「`.ccg/reviews` 元文件误提交」判**假阳性**（pre-commit 自动 stage、`check-pr-exec-record` 的 `AUDIT_ARTIFACT_RE` 明确接纳、上游 squash 提交同含此文件）；i2「跨进程链路缺少单条端到端断言」**属实**，已补 `src/sidebar-collapse-chain.test.js` 3 例关闭。按门禁合规出口（「写明原因并把 status 置为闭环值」）将记录状态置 `needs_revision`，`check-pr-exec-record --mode=enforce` 实测 rc=0；原始判定与逐条 rationale 见 `.ccg/reviews/a2bf…json` |
| 远程同步 | 由门禁推导 | 本行不需要事后改写：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并前本文尚不在基线上，判 byDesign 不红；把本行状态列写成 `PASS` 会被判「预写不存在的证据」而红 |

- 保留门禁：判定 docs-only=false（混合 PR，走完整质量节拍）| 行尾对账 ✅（两口径 numstat 一致）| 品牌残留/文档同步随 CI | 旧载体 `.quality-gates.md` 与 ledger 零改写 | 远程同步 由门禁推导（无需回填）

### 本次变更范围（供回填时核对）

- 渲染层：`apps/desktop/src/stores/sidebar-collapse.js`（新增）、`apps/desktop/src/components/SidebarToggleButton.vue`（新增）、`apps/desktop/src/components/icons/SidebarToggleIcon.vue`（新增）、`apps/desktop/src/components/TabBar.vue`、`apps/desktop/src/App.vue`、`apps/desktop/src/locales/tab-bar/{zh,en}.js`
- 测试：`apps/desktop/src/stores/sidebar-collapse.test.js`（新增）、`apps/desktop/src/App.sidebar-collapse.test.js`（新增）、`apps/desktop/src/components/TabBar.sidebar-toggle.test.js`（新增）、`apps/desktop/src/components/SidebarToggleButton.test.js`（新增）、`apps/desktop/src/sidebar-collapse-chain.test.js`（新增，跨进程链路端到端锁）、`apps/desktop/electron/preload/page-manager.sidebar-collapse.test.js`（新增），以及 `view-bounds.test.js` / `webview-manager.test.js` / `auth-view-manager.test.js` / `qrcode-login.test.js`（补用例）
- 主进程：`apps/desktop/electron/services/view-bounds.js`、`apps/desktop/electron/services/webview-manager/{layout,ipc-handlers,index}.js`、`apps/desktop/electron/services/auth-view-manager.js`、`apps/desktop/electron/services/qrcode-login.js`
- 桥接：`apps/desktop/electron/preload/page-manager.js`
- 文档：`01-docs/PRD-SIDEBAR-COLLAPSE-TOGGLE-2026-10-18.md`、`openspec/changes/sidebar-collapse-toggle/**`、本记录、`CHANGELOG.md`、`01-docs/PRD.md`、`01-docs/DESIGN.md`、`01-docs/i18n-glossary.md`、`01-docs/learnings.md`

### 遗留（不假装已闭合）

- **OAuth 内嵌视图不跟随侧栏宽度**：`apps/desktop/electron/services/oauth-manager.js:86` 调用 `computeEmbeddedViewBounds(this.mainWindow)` 时不传侧栏宽度，始终按默认 200 定位；收起侧栏后 OAuth 页左侧会留 200px 空白。既有实现本就不跟随 ≤900px 的 68px，本轮不扩大改动面，登记为已知限制。
- **视觉基线需一次重建**：按钮是全局壳层可见 UI，含 TabBar 的基线都会变化；**并非全部 43 张都含壳层**（如 `first-run` 走 `.fullscreen-main`）。最终变化清单以 CI `Gate 7b` 点名与重建记录为准，重建必须在 CI 同源渲染环境完成并逐张审核；本轮不提供本机覆盖基线的替代证据。
- **多窗口不实时同步**：折叠状态只在各窗口启动时从 `localStorage` 读取，运行期互不感知；实时同步需另立 `storage` 广播能力。
- **窄屏断点时序窗口**：收起期间跨越 900px 断点，`_sidebarWidth` 可能短暂沿用旧断点值，展开后由侧栏重新有宽度时的下一次上报纠正（一次重排，不造成死区）。
- **合并后回读**：基线重建 PR 与 main push 的回读结果在合并时补记于本记录（远程同步行由 merge-ledger 推导，不手写状态词）。
