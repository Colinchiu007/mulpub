---
record: ops-dead-ipc
task: 移除 getConfig().url 别名并清掉三条死 IPC 通道
date: 2026-10-15
---

## 本次执行记录：移除 getConfig().url 别名并清掉三条死 IPC 通道（ops-dead-ipc，2026-10-15）【混合 PR】

| 门禁项 | 状态 | 证据 |
|---|---|---|
| 变更类型与隔离 | PASS | 运行时代码变更（主进程 service + ipc-handlers + bootstrap + preload + 渲染端 api）⇒ 隔离 worktree `D:\Data\projects\mp-worktrees\mp-ops-dead-ipc`（分支 `ops-dead-ipc`，基线 `0d14ca8e9`） |
| 第一性原因（QM-5 ①） | PASS | `getConfig()` 的 `url` 是 #3608 拆三口径时**刻意保留的同值别名**，理由是「对既有消费点透明」。本轮盘点发现：携带它的 `ops-center-sync:get` IPC 在渲染端**零调用** ⇒ 别名实际是**为不存在的消费者留的兼容层**。同时 `opsCenterSyncGet/Save/Now` 三条封装的渲染端调用数经 `git grep`（排除 `src/api/` 自身）均为 **0** ⇒ 三条 IPC 通道整体已死。变更不影响运行时策略三条活通道（runtime/pipelineOptions/appMenu） |
| 逃逸分析（QM-5 ②） | PASS | **本轮最重要的发现：首轮"零消费者"结论是错的。** 我用 `git grep 'getConfig()\.url'` 搜"直接取用"，但 `resolveAutoSyncGuard(cfg, ...)` 接收的是**整个 cfg 对象**，`phase1-context.js` / `rate-limit.js` 也是解构后读 `cfg.url` —— **grep 不到间接消费者**。首轮改动后测试立刻抓出 3 处漏网（4 条 `autoSyncOnStart` + 2 条 guard + 1 条 rate-limit + 13 条 phase1 因 electron 未装顺带暴露）。系统性漏洞分类：**审查盲区**（盘点方法只覆盖直接字面量取用，未覆盖"对象被整体传递"与"解构后读属性"两种间接形态） |
| 修复 + 回归保护（QM-5 ④） | PASS | ①`getConfig()` 删 `url` 别名，只留 `manualUrl`/`effectiveUrl`/`autoUrl` 三口径；②三个间接消费者同笔改为 `manualUrl`（**语义也更正确** —— 它们要判的正是"已手填 + 已配 Key"，自动发现态走 Bearer 不该用 catalog-key）：`ops-center-sync-autosync-guard.js`、`bootstrap/phase1-context.js`（3 处上报鉴权）、`ipc-handlers/rate-limit.js`（判据 + fetch base）；③删 3 个 IPC handler、3 个 preload 暴露、3 个 access-control 登记、3 个渲染端封装；④`runtime-trust-anchor.js` 那句「写入只经 `ops-center-sync:save` IPC」随之变为假陈述，**同笔修正**。回归锁 24 → **27 条**：+3（`url` 字段不得出现、get/save/now 通道不得复活、**消费者必须读 manualUrl**） |
| 防止再次发生（QM-5 ⑤） | PASS | **新增的「消费者锁」是独立于各文件自身 mock 的交叉锁**：直接扫 guard / phase1 / rate-limit 三处源码，断言它们读 `cfg.manualUrl` 而非 `cfg.url`，并断言 `cfg.url` 在这三个文件中不出现。判据化：这正是首轮漏网的根因 —— 各文件"实现 + mock 一起改"会互相掩盖，交叉锁从外部钉住消费面。另有一条锁断言 `getConfig()` 返回值中 `url` 为 `undefined` |
| 变异反证 | PASS | 五处，均实测改坏立刻变红 + **字节级还原**：①把 `url` 别名加回 `getConfig()` ⇒ **5 红**；②复活 `ops-center-sync:get` 通道 ⇒ **3 红**；③guard 改回 `cfg.url` ⇒ **7 红**；④phase1 改回 `cfg.url` ⇒ **1 红**；⑤rate-limit 改回 `cfg.url` ⇒ **1 红**。**C5 首轮 failed=0**（实现与 mock 一起改会互相掩盖）⇒ 补了交叉锁后才变红，这个"锁首轮抓不住"的事实本身已写进本记录 |
| 测试通过 | PASS（**首轮不足，见下节**） | 首轮只跑了 7 个"我改过的"文件 ⇒ 147 条全绿，但 **CI 抓出 2 处遗漏**。修正后按「圈定全部受影响文件」重跑：**32 个测试文件、1034 条全绿**（electron 侧 23 个 840 条，含 `tests/ipc-contract.test.js` + `tests/ipc-exposure-contract.test.js` 两个 IPC 契约测试；渲染端 9 个 194 条，含 MpSidebar 4 个） |
| ⚠️ **CI 抓出的首轮遗漏（如实登记）** | 已修 | CI 的 `QG Desktop Shards` 与 `QG Coverage` 变红，日志精确指向两处：①**`electron/preload.test.js` 的方法数锁**（`system 模块应导出 149 个方法` 实测 146；`合并后 api 总键数` 344 → 341）—— 我删了 3 个 preload 暴露，这个**计数锁**必须同步；②**`services/settings-roundtrip-contract.test.js:127`** 的 `expect(cfg.url)` 断言（同一 alias 的第四个消费者，在**测试**里而非生产代码里）。两者均已修并重跑绿 |
| QM-1 打包 | PASS | `pnpm run build:dir` **rc=0**；产物级证据见记录正文。构建重写的 3 个生成文件两口径 numstat 皆空（纯行尾），已按 R2 精确恢复、未混入本 PR |
| QM-2 代码必检项 | PASS | require 路径全部存在；**未改 preload 的 sandbox 语义**（只删 3 个暴露项）；无新增 IPC 入口（净删 3 个）；IPC 参数序列化不受影响；注释 `/* */` 成对；`module.exports` 无多余逗号 |
| 行数门禁 | PASS | `.github/scripts/check-max-lines.js` **rc=0**（`ops-center-sync.js` 770 = 登记值 570 + 容差 200 的上限，**未动基线**）；过程中一度 771，按既有判据压缩注释回到 770。其单测 27/0 |
| locale 成对 | N/A | 未新增/修改任何用户可见文案 |
| 视觉回归 | N/A | 渲染端仅删除零调用的封装函数，无 UI 改动 |
| QM-6 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实登记 |
| 远程同步 | PASS | merge `c752f1dcd2c6161e76ca10a13cbe37798bf48f7d`（2026-10-15 18:12:18 +08:00）；PR 已 MERGED，远端分支 `ls-remote` 0 行 |
### 交付内容（13 文件）

**删别名 + 修间接消费者（4 个生产文件）**
1. `electron/services/ops-center-sync.js`：`getConfig()` 删 `url` 别名（−2 行）
2. `electron/services/ops-center-sync-autosync-guard.js`：`cfg.url` → `cfg.manualUrl` + JSDoc 更新
3. `electron/bootstrap/phase1-context.js`：3 处上报鉴权 `cfg.url` → `cfg.manualUrl`
4. `electron/ipc-handlers/rate-limit.js`：判据 + fetch base `cfg.url` → `cfg.manualUrl`

**删死通道（4 个生产文件）**
5. `electron/ipc-handlers/ops-center-sync.js`：删 get/save/now 三个 handler（59 → 38 行），文件头写入删除取证
6. `electron/preload/system.js`：删 3 个暴露
7. `electron/preload/access-control.js`：删 3 个登记名
8. `apps/desktop/src/api/ops-center-sync.js`：删 3 个封装（54 → 31 行）

**不写假陈述（1 个生产文件）**
9. `electron/services/runtime-trust-anchor.js`：补注「该 IPC 已删，写入路径自此只剩部署层」

**测试（4 个文件）**
10. `electron/ipc-handlers/ops-center-sync.test.js`：6 通道 → 3 通道 + 「死通道不得复活」锁
11. `electron/ipc-handlers/rate-limit.test.js`：mock 改 `manualUrl`
12. `electron/services/ops-center-sync.test.js`：10 处别名断言改 `effectiveUrl`/`manualUrl`；2 处 guard 夹具改 `manualUrl`
13. `electron/services/ops-center-sync-url-semantics.test.js`：24 → 27 条（+别名锁 +死通道锁 +**消费者交叉锁**）

### 本笔刻意不带 `.quality-gates.md` 与 ledger 登记项

这两个文件是全体并发会话的共同追加热点，带它们会让本 PR 每 ~13 分钟 `CONFLICTING`，而混合 PR 自身 CI 需 ~40 分钟 ⇒ 结构性活锁。本记录自带 `sync_*` 三字段即满足登记判据（实测 `check-gate-record-debt.test.js` 49/0）。载体写入由随后的 **docs-only 回填 PR** 完成。

### 本轮两条可复用教训（都是"盘点方法"层面的，不是"这次改错了"）

**教训 1：`git grep` 直接取用**不能**证明"零消费者"。** 我用 `git grep 'getConfig()\.url'` 得出"零消费者"结论，但 `resolveAutoSyncGuard(cfg, ...)` 接收的是**整个 cfg 对象**、`phase1-context.js` / `rate-limit.js` 是解构后读 `cfg.url` —— 这两种**间接形态 grep 不到**。判据化：**证明某字段/接口零消费者，必须同时检索「字面量取用」「对象整体传递」「解构赋值」三种形态**；只做第一种就下结论，等于把"我搜不到"当成"不存在"。

**教训 2：「移除型」改动的验证面 = 反向检索，不是正向回忆。** 首轮我跑的 7 个文件，选择依据是"**我改过**的文件"；但删除型改动的风险面是"**谁引用了被我删掉的东西**"——后者只能靠反向检索（谁 import / invoke / 断言了这个符号）圈定，不能靠回忆。本轮正解是按符号模式 `git grep -lE` 圈出 **32 个**文件并全跑，其中 `preload.test.js`（方法数计数锁）与 `settings-roundtrip-contract.test.js`（别名断言）就是正向回忆必然漏掉的两类：**计数锁**与**在测试里而非生产代码里的消费者**。判据化：删任何符号前，先 `git grep -lE '<符号名>' -- '**/*.test.js'` 把所有断言过它的测试文件列出来，一个都不能少。

### 残留风险（不假装已闭合）

1. **`saveConfig` 固化护栏自此在应用内完全无触发路径**（IPC 与表单都已删）。它是**数据层**防护，价值绑定在"将来重新引入配置入口时不会把自动地址不可逆固化成手填"。当前仅由单测保证形状正确。
2. **`syncNow()` 在主进程内仍被 `autoSyncOnStart` 调用**（启动自动同步），所以它**不是**死代码；但 IPC `ops-center-sync:now` 这条**手动触发**路径已死。若将来要恢复手动同步入口，需重新开通道并在 `access-control.js` 登记。
3. **盘点方法本身仍有盲区**：本轮靠测试变红才发现间接消费者，说明"grep 直接取用"不足以证明零消费者。本笔的交叉锁覆盖了已知三处，但**若将来新增第四个间接消费者，仍可能漏** —— 更彻底的做法是让 `getConfig()` 只返回一个冻结对象（`Object.freeze`）+ 类型定义，那样多一个字段就有编译期/运行期信号。属独立切片。
4. **本轮的"32 文件圈定"仍依赖我选的 10 个符号模式**。若某个消费者既不 import 这些符号、也不出现这些字面量（例如经 `deps` 注入后改名），仍会漏。更彻底的做法是把 `getConfig()` 的返回类型写成 d.ts 并由 `tsc --noEmit` 卡住 —— 属独立切片。

### 保留门禁

行尾对账 ✅ | 品牌残留 ✅ | locale 成对 N/A | 视觉回归 N/A | 行数门禁 ✅（rc=0，未动基线）| QM-1 ✅ | 远程同步 PASS（merge c752f1dcd，远端分支 0 行）
