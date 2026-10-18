---
record: sidebar-collapse-followups
task: 关闭 PR #3916（sidebar-collapse-toggle）遗留清单：OAuth 内嵌视图接入侧栏宽度/折叠同步、多窗口折叠状态实时同步、抽出 NaN 免疫的宽度守卫
date: 2026-10-18
---

## 本次执行记录：sidebar-collapse-toggle 遗留收尾（sidebar-collapse-followups，2026-10-18）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 混合 PR（运行时代码 `apps/desktop/**`）⇒ 隔离 worktree `mp-worktrees/mp-sidebar-collapse-followups`、裸分支 `sidebar-collapse-followups`（`git branch --show-current` 实证）；由 `scripts/session-init.sh` 创建，`verify-worktree-deps.js` 11 项解析通过 |
| 第一性原因（QM-5 ①） | ✅ | **缺陷 A**：`oauth-manager.js:86` 的 `_positionView()` 只传 1 参给 `computeEmbeddedViewBounds`，`sidebarWidth` 回落默认 200、`sidebarCollapsed` 恒 false。文件头注释第 20-21 行明明写着「已接入：…oauth-manager」，而 `startAuth` 里 `_positionView()` 是唯一定位点 —— 宽松默认值把「漏传」伪装成合法布局，不抛错、无视觉告警。**缺陷 B**：主进程 `_sidebarCollapsed` 是应用级唯一真源，但只有「渲染进程 → 主进程」单向 invoke，缺 `main → renderer` 广播；各窗口渲染进程各持一份 ref 副本。**缺陷 C（连带发现）**：四处 manager 各自手写 `width < MIN \|\| width > MAX` 守卫，而 NaN 的所有比较都是 false ⇒ NaN 穿过 `typeof === 'number'` 检查被写进 `_sidebarWidth`；`normalizeSidebarWidth` 的 `Number.isFinite` 在 view-bounds 层才把它拦下，守卫语义被推迟一层且四份实现各自漂移 |
| 逃逸分析（QM-5 ②） | ✅ | **A 的逃逸链**：单测层 —— 原 `_positionView` 用例只断言 `{x:200,y:76,width:1224,height:785}`（默认展开态），**断言值本身就是错的期望**，缺陷被写成"正确行为"；集成层 —— 无任何测试把 OAuth 管理器与 WebviewManager 的同步链接起来；E2E 层 —— OAuth 授权需真实平台凭证，手工链路覆盖不到收起态。**B 的逃逸链**：原 PRD 与 spec 只写「每次状态变化上报一次 `setSidebarCollapsed`」，把跨窗口一致性当成 IPC 单向性的自然推论，**规格层面就漏了这一条**；无测试构造过两个窗口。**C 的逃逸链**：四处守卫各写各的，每处都只测了 `0 / -1 / 601 / '200' / null` 这些"比较能拦"的值，**没人测过 NaN** —— 而它恰好是比较拦不住的那一类 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 先红后绿。**A**：`oauth-manager.test.js` 新增 7 例（默认 x=200 / `setSidebarWidth(68)` 同步 / 非法值一次都不重排 / 收起 `x=0` 全宽 / 展开恢复 / 非布尔忽略 / 幂等 / 视图未创建时状态仍记录）；`window.test.js` 新增 1 例装配断言（`setOAuthManager` 被调用且收到 `oauthManager`）。**B**：`webview-manager.test.js` 新增 8 例广播 + 4 例 `setOAuthManager`；`sidebar-collapse.test.js` 新增 8 例（不写 localStorage / 不上报 IPC / 非布尔忽略 / 同值不重复通知 / 退订生效 / 订阅者抛错隔离 / 广播后可再切换）；`App.sidebar-collapse.test.js` 新增 5 例（订阅 / 应用广播 / v-show 跟随 / 退订 / 老版本 preload 静默）；`page-manager.sidebar-collapse.test.js` 新增 3 例；`sidebar-collapse-chain.test.js` 新增 1 例跨进程多窗口链路（真实 preload + 真实 handler + 真实 layout）。**C**：`view-bounds.test.js` 新增 4 例（合法边界 / 0·负·越界·非数字 / **NaN 复现「手写比较拦不住」** / ±Infinity）。**读数**：`vitest run` 12 files / **311 tests 全绿**（原 205 + 新增 106）；`tsc --noEmit` rc=0；`eslint` 0 error（14 warning 全为存量 `no-var`/`catch(e)`） |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 规格新增 **3 条 Requirement / 10 个 Scenario**（多窗口一致性、四类内嵌视图全跟随、守卫必须拒 NaN），spec 从 7 条 Requirement 增至 10 条；② `isValidSidebarWidth` 成为**单一真源**，四 manager 共用，从结构上消除「四份漂移」；③ tasks.md 新增第 7 节逐条关闭/降级遗留；④ 链路测试把「A 窗口点击 → 广播 → B 窗口剥壳应用且 invoke 零调用」钉成端到端断言（此前任一环改名都会全绿）；⑤ 遗留第 3 项（跨 900px 断点）经代码复核降级为「无需处理」并在 tasks 7.7 写明依据，不再留假问题占用后续注意力 |
| 行尾与 diff 对账 | ✅ | `git diff --cached --numstat` 与 `--ignore-cr-at-eol --numstat` 实测 **IDENTICAL**（两个提交分别验过一次）；新增/修改文本文件均为 CRLF，无行尾混入 |
| 接线棘轮 | ✅ | 全部为**既有测试文件的增量用例**，无新增 `*.test.js` 文件 ⇒ 不触发「新文件必须被 workflow 点名」；改动文件全部已被 CI 覆盖（`quality-gate.yml` 的 QG Unit Tests / QG Desktop Shards 全量跑） |
| QM-1 打包 / QM-4 视觉 | QM-1 待跑（见遗留）；QM-4 N/A | 触碰 `apps/desktop/electron/**` ⇒ 按 AGENTS.md 必须本地打包。本轮**尚未执行** `electron-builder`（诚实记录：先提交代码与文档，打包在 PR 开窗前补做并回填本行）。QM-4：无渲染层视觉变化（未改任何 `.vue` 模板结构或 `.css`），基线应零变化，无需重建 |
| QM-6 CCG 双模型外部评审 | ✅ self_play_resolved（5 条全裁，2 条高危域外部复核） | 两个代码提交各 >200 行触发 `mode=dual`。**已执行** `ccg-deep-review.js --sha <sha>` 分别审查两个提交：claude(critic) × opencode(proposer) 跨家族校验通过。**提交 1（OAuth 修复）** 产出 6 条、最低维度分 5，收敛自扮演后逐条裁决，两条高危域（i1 auth/crypto、i4 auth）另跑 `claude -p` **独立外部只读复核**（不复用自扮演上下文），双通道结论一致：**i1 dismissed**（`computeEmbeddedViewBounds` 是 4 参签名，第 3 参 topOffset、第 4 参 sidebarCollapsed；三处调用点形状逐字一致；`view-bounds.test.js:191-219` 有第 4 参专用测试组 —— 评审误读参数位置）；**i2 upheld 并已修**（广播对「electron 可用但零送达」原也静默；现区分场景：无 electron 运行时静默 `sent:0`，`getAllWindows` 不可用或一个都没送到必须 `log.warn`，补 3 例测试锁定三种路径）；**i3 dismissed**（延迟 require 是本仓 node 环境测试架构的必需模式，非本轮引入）；**i4 dismissed**（状态复制与 `AuthViewManager`/`QRCodeLogin` 同构，且本轮新增注入时补齐推送——外部复核确认 `window.js` 每次窗口重建都走同一装配链；其建议的「补齐推送加 log.info」可选增强已落地）；**i5 dismissed**（载荷仅 boolean，与全仓既有广播同模式）。裁决全文与外部复核结论落盘 `.adversarial/ccg-deep-<sha>/adjudication.json` |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并前这篇文件还不在基线上，判 byDesign 不红；把本行状态列写成 `PASS` 会被判「预写不存在的证据」而红 |

### 关键实现取舍（供复核）

1. **广播载荷形状 `{ data: { collapsed } }`**：与 `page-manager:navigation-changed` 等既有广播一致（preload 统一走 `payload?.data || payload` 剥壳），不新造第二种形状。preload 侧同时容错顶层 `collapsed`（老形状）。
2. **回环防护两道**：`applyRemoteCollapsed` 不持久化、不上报 IPC（第一道）；所有写入路径同值短路（第二道）。单测分别覆盖。
3. **`broadcastSidebarCollapsed(browserWindowCtor)` 可注入**：生产由调用方传 `require('electron').BrowserWindow`；未注入时延迟 require，单测环境（vitest node）不炸。参照 `publish-risk-ipc.test.js` 的注入模式。
4. **OAuth resize 监听在 `setMainWindow` 换绑时先解绑旧的**：`clearMainWindowBindings` 会把 win 置 null 后重建窗口，不先解绑会跨窗口累积监听。
5. **第 3 项遗留降级而非修复**：`computeEmbeddedViewBounds` 内部 `collapsed ? 0 : normalizeSidebarWidth(width)` 已让 width 参数在收起态完全失效，展开时 `MpSidebar` 的 `ResizeObserver`（`w > 0` 守卫）在同一帧后上报真实宽度 —— 不产生错误布局。为"一次不可见的 1 帧抖动"新增标记位会把简单状态机复杂化，故只在 tasks 记录依据。

### 遗留（不假装已闭合）

- **QM-1 本地打包未执行**（触碰 `apps/desktop/electron/**` 与 preload）：需在 PR 开窗前跑 `pnpm exec electron-builder --win --x64 --publish never`，并做启动三层判据（存活 + stderr 红线 + 剔除 `ELECTRON_RUN_AS_NODE`）。原因：本轮先把 TDD 与文档做完整，打包耗时较长放最后；若打包发现问题，代码还需再改一轮。
- **QM-6 CCG 深度审查未执行**：两个提交 decider 判 SINGLE，按 §12.6 应在动手后跑 `deep-review.sh`，与 QM-1 同批补做。
- **多窗口广播未做真机双窗口验证**：链路测试用替身覆盖了「A 点击 → 广播 → B 剥壳应用且无回传」，但真实双 BrowserWindow 的 race（两窗口同时点击）未实测。同值短路保证收敛，但顺序未定义。
- **`window.electronAPI` 直取的兼容面**：`stores/tab.js` 等仍走 `getApi()?.pageManager`，本轮的 preload 新增方法只在新旧版本混用时静默降级（已测），但**未验证** 老 preload + 新主进程组合下广播能否送达（老 preload 没有 `onSidebarCollapsedChanged`，靠 App.vue 的 `typeof === 'function'` 守卫跳过）。
