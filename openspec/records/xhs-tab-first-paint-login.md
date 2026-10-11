---
record: xhs-tab-first-paint-login
task: 账号标签首屏登录态——凭证 localStorage 的 document-start 注入从未生效（小红书开卡「先登录页 → 刷新 → 进创作者中心」）
date: 2026-10-11
sync_status: PENDING
sync_reason: 本 PR 尚未合并；合并后由后续回填 PR 将 .quality-gates.md 的远程同步行改写为 PASS + merge SHA，并在同一次提交删除 scripts/gate-record-debt-ledger.json 的本条登记
sync_backfill_owner: xhs-tab-first-paint-login 记录作者
---

## 本次执行记录：账号标签首屏登录态（xhs-tab-first-paint-login，2026-10-11）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（`electron/services/webview-manager/{utils,tab-lifecycle,constants}.js` + 2 个测试文件）+ 文档 ⇒ `classify-docs-only` 判 false（混合 PR）；隔离 worktree `<worktree-root>/mp-xhs-tab-first-paint-login`（D 盘），裸分支 `xhs-tab-first-paint-login`，基线 `origin/main` = `828ddece3`；共享根保持 main（worktree 创建前后 `git status --porcelain --untracked-files=no` 指纹对比：唯一差异是另一并发会话自己的 `.ccg/reviews/…` 由 `A ` 变 `AM `，非本会话所为） |
| 第一性原因（QM-5 ①） | ✅ | 旧 `_injectLocalStorageAtDocumentStart` 只发 `Page.addScriptToEvaluateOnNewDocument`：①**不建立 CDP Page 目标** ⇒ 全新 `WebContentsView` 上 Page 域命令**永久挂起**（真机探针 6s 无响应）⇒ 必然走到 2500ms 超时 ⇒ 首个文档无凭证 ⇒ 平台 SPA 弹登录页 ⇒ 降级路径补注入 + 整页重载；②**从不 `Page.enable`** ⇒ 命令返回 `{identifier}` 但脚本永不执行（静默 no-op，会把失败上报成成功）。真机日志 3/3 命中 `addScriptToEvaluateOnNewDocument timed out after 2500ms (hung CDP command), LS early injection fallback`（2026-10-11 15:05:51 / 15:06:25 / 15:07:43） |
| 逃逸分析（QM-5 ②） | ✅ | 单元层：既有 CDP 用例的 stub `sendCommand` 恒 resolve，**从未断言 `Page.enable` 与「脚本真的在下一帧生效」**，于是「假成功」在单测里恒绿；集成层：无夹具能观测「首屏是否渲染过登录页」；真机层：症状被降级路径自动修复（几秒后进创作者中心），只表现为一次闪烁 ⇒ 无 E2E/视觉层覆盖；审查层：2026-10-09 PR #3239 只把 `credLocalStorage` 列为「留作后续评估」的遗留项，未意识到该路径**从未生效** |
| 修复 + 回归保护（QM-5 ④） | ✅ | `utils.js`：attach →（无文档则）`about:blank` 引导 → `Page.enable` → `addScript`，返回值改 `{injected, blankBootstrapped}`；新增 `_primePageTargetWithBlankDocument` / `_removeBootstrapBlankHistoryEntry` / `_isBootstrapBlankDocument`。`tab-lifecycle.js`：`state.blankBootstrapPending` 引导期屏蔽（不改写标签 URL/不广播/不结束 `initialRedirectPhase`），首个真实导航提交后先摘 `about:blank` 历史项再读 `canGoBack`。回归保护：`webview-manager.test.js` 4 条新契约（时序 `about:blank→Page.enable→addScript→首个真实导航`、状态屏蔽、历史项摘除、已有文档不引导）+ 2 条既有契约按新时序改写；`home-shell-title.test.js` 夹具形状对齐 |
| 防止再次发生（QM-5 ⑤） | ✅ | ①时序契约把**不可交换的次序**写成断言（含「真实 `loadURL` 调用序列恰为 `[about:blank, 真实URL]`」——旧形态必然多一次真实导航）；②`openspec/records` + `01-docs/PRD-ACCOUNT-TAB-FIRST-PAINT-LOGIN-2026-10-11.md` §7.3 固化历史项摘除判据（第 0 条且 url 为 about:blank 且非 active entry）；③`01-docs/learnings.md` 顶部新增「命令返回 ok ≠ 生效 / 失败会被自己的降级路径掩盖」条目；④同族风险登记（`auth-view-cdp.js` 的 `Fetch.enable` 同形态）进 PRD §13，留独立任务 |
| TDD 与相关域全量 | ✅ | `webview-manager.test.js`（80）+ `webview-manager-ls-document-start.test.js`（11，LS/CDP 注入契约）+ `home-shell-title.test.js`（12）= **103 passed / 0 failed**；`electron/**` 域全量见下「相关域全量」行 |
| 逐文件行数门禁（CI 实测拦截后修复） | ✅ | 首推 CI 红于 `TEST_LEDGER_GREW: webview-manager.test.js 较登记值 1649 膨胀 302 行（容差 200）` ⇒ 按门禁要求**拆文件**（不放宽账本）：新建 `webview-manager-ls-document-start.test.js`（11 例）+ 共用夹具 `webview-manager-test-harness.js`，原文件 1950 → **1471** 行，并按提示 `check-max-lines.js --prune-test <file>` 单键清账（`testPruned: 1471`）；`check-max-lines.js` / `check-debt-budget.js` / `check-unwired-tests.js` 本地全绿，六条变异在**新文件路径**下仍逐条变红（拆分未削弱锁） |
| 变异反证（6/6 实测 + 1 条等价对照） | ✅ | M1 去掉 `Page.enable`、M2 不做 `about:blank` 引导、M3 引导期照常改写标签状态、M4 不摘历史项、**M6 去掉注入脚本 try/catch（QM-6 i2）**、**M7 去掉历史项 url 守卫（QM-6 i1）** ⇒ 逐条实跑**对应用例恰好变红**，回滚后全绿；**M5（去掉引导期标记的外层护栏）实测仍绿 = 行为等价**（url 守卫已覆盖），如实记为防御性冗余；脚本对 CRLF 做 `\r?\n` 归一后才匹配（首轮 2 条 `PATTERN NOT FOUND` 已修正重跑） |
| 真机 A/B 端到端（判据） | ✅ | 真实 Electron 43.7.7 + 本地 HTTP 夹具（服务端模拟「SPA 在 document-start 读 localStorage 自判登录态」），直接 `require` 两侧 `tab-lifecycle.js`：旧侧取共享根（与 `origin/main` 该文件 `git diff --quiet` 逐字节相同），新侧取本 worktree。**旧侧**：`loadURL=[目标URL, 目标URL]`、服务端请求 `['/', '/login', '/']`、帧内取证 `hasToken=0 → hasToken=0&login=1 → hasToken=1`、`canGoBack=true`、导航广播 3 次；**新侧**：`loadURL=[about:blank, 目标URL]`、服务端请求 `['/']`、帧内取证仅 `hasToken=1`、`canGoBack=false`、导航广播 1 次 ⇒ **渲染过登录页的帧数 2 → 0** |
| 行尾对账 | ✅ | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 逐值相等（7 个受管文件，无幽灵行） |
| 静态门禁（本地已跑） | ✅ | `check-no-brand-residue.js` PASS（8050 tracked 文件）；`check-text-encoding-integrity.js` OK（无新增 U+FFFD）；`check-debt-budget.js` 全指标基线内（`maxFileLines 4899/5657`、`filesOver500 97/101`；`tab-lifecycle.js` 499 行、仍在 500 上限内）；`check-changelog-growth.js` 与 `check-changelog-duplicate-entries.js` PASS；locale 未改（无成对校验需求） |
| QM-1 打包 | ✅ | ①`cd apps/desktop && pnpm exec electron-builder --win --x64` → **exit 0**，产物 `dist-electron/Multi-Publish.Setup.0.2.0.exe` = 491,782,156 B；②asar 清单核对：`\electron\services\webview-manager\tab-lifecycle.js` / `utils.js` / `constants.js` 均在 `app.asar` 内（`@electron/asar list` 实跑）；③`pnpm run build:vue`（渲染端 dist）+ `electron-builder --win --dir --publish never` → exit 0，随后以 `--user-data-dir=<临时 profile>` 启动 `win-unpacked/Multi-Publish.exe` **8s 存活**，stderr 仅一条 Node `DEP0180` 弃用告警，无 `Failed to load platform config` / `PluginLoader.*mkdir failed` / `ENOTDIR.*app.asar` / 配置或插件路径指向 ASAR 内部；stdout 显示 SplitterBridge(8002)/PromptBridge(8013) 正常就绪。收尾核对：启动测试进程树无残留（8 个 electron 进程全部属并发会话的 `mp-app-live2` + `shared-user-data`，与本测试的临时 profile 无关）|
| QM-4 视觉 | N/A | 无任何渲染端文件/样式/文案变更（仅主进程时序与状态机） |
| QM-6 CCG 双模型深度审查 | ✅ 6 条全部处置 | 变更 841 行 > 200 行阈值 ⇒ 提交钩子判定 **DUAL**；`sh scripts/deep-review.sh`（critic=claude / proposer=opencode，跨家族）轮 1 产出 6 条：i1（auth 域 Warning）**upheld** → 带跳场景契约 + 守卫本体契约 + AC 措辞适用范围 + §13 第 5 条，M7 反证变红；i2（Warning）**upheld** → setItem try/catch 结构锁 + §7.2 两层保证改写，M6 反证变红；i3（Warning）**dismissed（附量化）** → §7.2 开销行（新增 150–300ms < 修复前 2500ms 门控 + 整页重载）；i4（Warning）**upheld** → 三出口注释 + 命名收敛 + §6.3；i5/i6（Info）→ **issue #3363** 跟踪，i6 另以探针 7 取证 detach 边界（detach 后新文档不再注入）。裁决逐条落盘 `.adversarial/ccg-deep-a2e90cb7/adjudication.json`（i1 为高危域：结论只依据可重跑测试与变异结果） |
| OpenSpec change | 判定不建（如实记录） | 单点根因修复、无方案级取舍、无新增 IPC 通道/存储/接口/依赖；同域先例（2026-10-09 账号标签 Cookie 恢复、2026-10-11 小红书登录二段式补跳）同样只产出 PRD + 执行记录 |
| 远程同步 | PENDING | 待本 PR 合并后就地改写 PASS + merge SHA（`git log origin/main --grep='(#NNNN)$' --format=%H|%cI` 取证），并在**同一次提交**删除 `scripts/gate-record-debt-ledger.json` 的本条登记与本文档 frontmatter 的 `sync_*` 三字段 |

### 相关域全量（`electron/**`）

命令：`cd apps/desktop && pnpm exec vitest run electron`（`vitest.config.js` 为 `maxWorkers:1 / fileParallelism:false`，串行）。

- 结果：**Test Files 524 passed / 1 skipped（525）；Tests 9921 passed / 1 skipped（9922）**，`Duration 1690.81s`，`REAL_EXIT=0` —— 零失败。
- 未含 `src/**`：完整 `pnpm exec vitest run`（含渲染端 8000+ 用例，串行约 1–2 小时）交由 CI 的 **QG Desktop Shards** 覆盖；本次改动只在主进程 `electron/services/webview-manager/**`，渲染端无文件变更、无 IPC 契约变更（`page-manager:create-new-tab-page` 入参/返回形状不变）。
- E2E 稳定性复测（新侧连续 5 次，空闲机器）：**5/5** `finalTitle=CREATOR_CENTER`、`loginPageRenderedFrames=0`、`realNavigationCount=1`、`canGoBack=false`、`historyEntries=1` ⇒ 修复在无负载下确定性收敛，不依赖时序运气。

### 遗留（不假装已闭合）

1. **降级路径仍在**：CDP 超时（2500ms）时仍走既有 fail-open（补注入 + 整页重载）；一次「全量测试并发占满 CPU」的 E2E 运行中复现过回退（`loadURLCalls=[about:blank, 真实URL, 真实URL]`），常态化运行 0 次。未上调超时上限（挂起无界），后续独立方案评估见 PRD §13。
2. **引导文档的毫秒级 loading 闪烁**：`about:blank` 的 start/stop-loading 仍广播（不屏蔽的理由见 PRD §13.2：真实导航 start 时 `getURL()` 仍可能是 about:blank，按 URL 判定会误吞真实导航事件）。
3. **真实账号的手工验收未做**：本机运行中的应用实例属另一 worktree/会话（`mp-app-live2` + `shared-user-data`），未接管重启；用户重启应用后按 PRD §10 的日志判据自检即可（正常路径应有 `blank bootstrap document requested` + `removed bootstrap about:blank history entry` 且无 WARN）。
4. **同族未修**：`auth-view-cdp.js` 的 `attachCdpDetection`（`Fetch.enable` 同形态，fire-and-forget ⇒ CDP 登录检测可静默失效）留独立任务。
