---
record: ops-ingress-only
task: 让「运营」退出应用用户面 + 验签信任锚下沉部署层
date: 2026-10-14
---

## 本次执行记录：让「运营」退出应用用户面 + 信任锚下沉部署层（ops-ingress-only，2026-10-14）【混合 PR】

用户判断：**「不应该让应用中存在运营方面的设置」**。逐层核实后，这条判断成立，且比表面上更严重：
用户面上残留的运营信息里有一句**可能为假的话**，而「打包版的验签信任锚」**只存在于那个已经撤下的界面里**。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码变更（`apps/desktop/electron/` + `apps/desktop/src/`）⇒ 隔离 worktree `D:\Data\projects\mp-worktrees\mp-ops-ingress-only`（分支 `ops-ingress-only`，基线 `e8887ebff`）；依赖 `verify-worktree-deps.js` **OK**。如实登记：`scripts/start-mp-task.ps1` 仍被**他人**的游离 worktree `D:/Temp/egress-base`（规范根外）挡住而 `ok:false`，按上轮同一处理**直接在规范根内** `git worktree add -b`，未删除、未登记豁免他人产物 |
| 第一性原因（QM-5 ①） | PASS | 三层，均实测：**①「打包版无处可配信任锚」是既存生产洞** —— `runtimePublicKey` 原先只有 settings 一个来源，写入只经 `ops-center-sync:save` IPC，而该 IPC 的唯一调用方（同步配置表单）**早已从界面撤下**（`ModelProviders.vue` 旧注释：「运营同步对用户透明：配置卡片已隐藏」）⇒ `resolveTrustAnchor` 必然返回 `NO_PRODUCTION_TRUST_ANCHOR` ⇒ **生产版整份运行时策略 fail-closed**（含应用菜单）。**②渲染端整块是死代码**：`useOpsCenterSync` 的 URL/Key 表单状态、`saveSyncConfig`、`runSyncNow` 在非 locale 代码里**零调用方**；唯一在用的 `syncConfigured` **恒为 false**（`loadSyncConfig` 从未被调用）⇒ 3 处 `v-if` 提示与 `:disabled` 从未生效。**③一句可能为假的话**：`ModelProviders.vue` L406/L464 的 `opsReadonlyHint`（「已启用运营后台同步：预设服务商模型列表由运营后台下发，此处为只读」）**无条件显示**，而同步可能从未发生 |
| 逃逸分析（QM-5 ②） | PASS | ①**单测层**：既有锁只覆盖「不调度」，未覆盖「信任锚来源」与「提示是否指向可达路径」；②**夹具层**：`makeStore` 预置 DEV 锚使「无锚」态在夹具里根本不存在；③**互操作层（本轮实测踩到）**：ESM `import` 主进程 CJS 与服务的 `require` **不是同一模块实例** ⇒ 打包态探针静默失效、锁**假绿**（`syncNow` 被调用而断言却看着像在跑），本仓已有 `createRequire` 先例（`runtime-trust-anchor.test.js:20`）而我违反了它；④**审查层**：上轮 PR 的 hint 文案只被断言「包含旧文案」，没有任何判据约束其**正确性** —— 于是「只认 X-Catalog-Key / 必须手填」这个**错误结论**直接进了主干 |
| 修复 + 回归保护（QM-5 ④） | PASS | ①信任锚下沉部署层：`identity-runtime-config.js` 新增 `runtimePublicKey` 字段与 `RUNTIME_PUBLIC_KEY` env 覆盖（与 `opsCenterUrl` 同机制）→ `phase3-services.js` 注入 → `runtime-trust-anchor.js` 新增 `resolveRuntimePublicKey(deployment, stored)`（部署层优先，设置项仅作兼容）→ `_getRuntimePublicKey()` 调用它（**安全不变量未动**：打包 + 无锚仍 fail-closed）。②渲染端运营面清零：删 `composables/useOpsCenterSync.js` + 其测试（`git rm`）；`ModelProviders.vue` 删 93 行（18 个 CSS 死规则块、3 处 `v-if` 提示、2 处无条件提示、1 处 `:disabled`、import/注释/const）；locale zh/en **各删 18 键**；`ARCH-notify-log-standard.md` 表格里的已删文件引用同步改写。③可用性变信号：守卫新增 `NO_TRUST_ANCHOR` 前置判据（花掉请求**之前**就说清）+ `ok` 返回 `authMode` + `emitAutoSyncOutcome` 成功也出声；`catalog-synced` 日志新增 `origin`（只投影 origin，不记 URL 原文）。回归锁 86 条全绿（新增 6 条：打包×锚矩阵、authMode、emit 成功/失败/无日志器、safeOrigin、resolveRuntimePublicKey 优先级） |
| 防止再次发生（QM-5 ⑤） | PASS | ①**提示文案不再指向任何应用内界面**，一律指向部署层字段名（`opsCenterUrl` / `runtimePublicKey` / env），并加反向断言 `not.toContain('设置 → 运营中心同步')` 与 `not.toContain('Bearer 不适用')`；②**探针假绿已修**：测试改用 `createRequire` 取得与服务同一模块实例，并把「为什么必须这样」写进注释（本仓第二个踩坑点）；③本笔教训与「上轮错判」一并进三处记忆（内置 `01-docs/learnings.md` / 外部 `learnings.jsonl` / EverOS），并为此**另开更正 PR** 修订 #3513 正文、`ops-menu-diag` 记录与已合并的 learnings |
| 反证（变异） | PASS | 3 处变异各自打红对应用例、还原后全绿：**M1** 摘掉「打包版缺信任锚」前置判据 ⇒ 「打包版缺验签信任锚」「打包态 × 信任锚矩阵」红；**M2** 出声口退回静默（成功与失败都不说话）⇒ `emitAutoSyncOutcome` 红；**M3** 信任锚来源退回「只认设置项」（丢掉部署层优先级）⇒ `resolveRuntimePublicKey` 红。还原后 `Tests 86 passed (86)`，且脚本以字节级回写自证还原完整 |
| 编码与行尾 | PASS | 两口径 `numstat` 一致。构建曾把 `electron/preload/index.bundle.js` 重写为 LF（`git diff` 为空、仅行尾）——本笔**未改 preload**，故按 R2 精确恢复该**单个**文件（非宽目录恢复） |
| QM-1 本地打包 | PASS | `cd apps/desktop && pnpm run build:dir`（= `build:vue` + `electron-builder --dir`）**rc=0**；`dist-electron/win-unpacked/Multi-Publish.exe` 与 `resources/app.asar` 均存在；asar 清单含新模块 `electron/services/ops-center-sync-autosync-guard.js`、`electron/services/runtime-trust-anchor.js`，且**不含** `useOpsCenterSync`（这是「运营面已移除」的**产物级**证据）。两条 `file source doesn't exist`（`dist/fonts`、`.playwright-browsers`）为本机既存告警，与本笔无关，如实登记 |
| QM-4 视觉回归 | N/A | 本笔在用户面只做**删除**（提示与只读门控），不新增界面元素与样式 |
| QM-6 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实登记 |
| 远程同步 | PASS | merge `eda75e6fcd197d87bc3686e9328b06602c566fc4`（2026-10-14 12:19:45 +08:00）；PR 已 MERGED，远端分支 `ls-remote` 0 行 |
- 保留门禁：行尾对账 ✅ | 品牌残留 PASS（扫描 8915 个 tracked 文件）| locale 成对 PASS | CJK 基线 PASS（1374 → 1224，无新增硬编码）| locale 键存在性 PASS（2007 个在用键全部存在）| 测试接线 PASS（82 个域内文件）| 债务熔断 PASS | 远程同步 PASS（merge eda75e6fc，远端分支 0 行）

### 如实记录：本笔纠正了上一轮我自己的错误结论

上一轮我在 PR #3513 正文、`openspec/records/ops-menu-diag.md` 与 `01-docs/learnings.md` 里写了
「`/api/v1/runtime/bootstrap` **只认 X-Catalog-Key，Bearer 不适用**，所以要手填地址 + API Key」——**这是错的**：

- `routers/runtime.py::_require_catalog_key` 的实现是 `services/logto_verifier.verify_bearer_or_catalog_key`，
  优先级为 **Bearer(Logto) → X-Catalog-Key(fallback) → 401**，且 Bearer 分支要求 scope `publish:read`，
  而 `config/identity-public.json` 的 `logtoScopes` 正含该 scope ⇒ **零配置路径可用且优先**；
- 且我让用户去填的那个界面**早已不存在** ⇒ 我给出的出路在界面上无法执行。

失败形态与上轮我亲手写进教训第 3 条（「推断必须先否证」）**同型**：对 `.env` 字符串做了否证，
却对一句**模块 docstring** 直接采信。同轮写下规则、同轮违反。更正另开 docs PR（记录是追加型，不静默改写）。
