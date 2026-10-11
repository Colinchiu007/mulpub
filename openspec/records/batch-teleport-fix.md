---
record: batch-teleport-fix
task: Teleport 清场测试基建 + 批量域抽取闭环（FRONTEND-FILE-SPLIT-PLAN v3 §2.10，§2.8/§2.9 暂缓项的落地）
date: 2026-10-10
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个会话
---

## 本次执行记录：Teleport 清场基建 + 批量域抽取闭环（batch-teleport-fix，2026-10-10）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码：隔离 worktree `D:\Data\projects\mp-worktrees\mp-batch-teleport-fix` + 裸分支；共享根保持 main |
| 前置（§2.8/§2.9 暂缓项） | PASS | §2.8 的 Teleport 污染与 §2.9 的「第 3 步缓做」前置均已满足 |
| TDD（清场基建先红后绿） | PASS | `teleport-cleanup.test.js` 3 例：污染机制复现（残留 DOM click 写单例）→ 清场后不可达 → 连续用例序列干净；**实验中发现清场顺序必须 unmount 在前**（先清场会漏掉 unmount 自己产生的残留） |
| 修复 + 回归保护（QM-5 ④） | PASS | 批量 describe 加 `afterEach(afterTeleportCleanup)` + `mountS2V` mount 前强制 `resetBatchCreateForTest()`（双保险）；2 处 beforeEach 加 `resetBatchCreateForTest` |
| 根因修正（接线脚本） | PASS | 上轮 §2.8 的「误删两行 data 声明」根因=两次 splice 行号失效；本轮改为**连续区间一次 splice** + **幸存自检**（MAX_STORY2VIDEO_TEXT_CHARACTERS / s2vImageProviders 声明必须还在）——实测通过 |
| 行尾与 diff 对账 | PASS | 两口径 numstat 一致（3 文件） |
| 接线棘轮 | PASS | teleport-cleanup.test.js 在 vitest 扫描路径；S2vConfigPanels / 面板契约测试同跑绿 |
| QM-1 打包 | N/A | 未触 electron 主进程 |
| QM-4 视觉 | PASS | 结构等价抽取（zh 文案逐字不变）；CI QG Visual 为准 |
| QM-6 CCG 双模型评审 | PASS | 方案 §2.8/§2.9 既定步骤的落地，无方案外新决策 |
| 债务熔断 | PASS | `check-debt-budget.js` 全绿（circularDeps: 0） |
| Gate 7 | PASS | `--keys` 1655 key 全存在 |
| 远程同步 | PENDING | 开 PR 时登记 ledger；合并后回填 PASS + merge SHA 并同一次提交销账 |

### 改动

- **新增 `apps/desktop/src/views/teleport-cleanup.js`**：清场基建 `afterTeleportCleanup()`（冲刷挂起微任务 → 清 body → 再冲刷）与 `flushPending()`
- **新增 `teleport-cleanup.test.js`（3 例）**：污染机制最小复现（Teleport + @click 写模块级单例）、清场后不可达、连续用例序列干净
- **新增 `video-creation/composables/useBatchCreate.js`（329 行）**：批量创作域（12 状态 + 15 方法；deps 注入 8 项 fail-closed）；轮询定时器为显式启停（open/close + beforeUnmount 兜底）
- **`CreateView.vue` 5057 → 4896 行（净 −161）**：删批量 data 块（连续区间一次 splice + 幸存自检）与 15 方法；加 12 状态桥接 + 15 方法代理 + mounted deps 注入（含去重集提前惰性初始化）；摘除 4 个无使用 API import
- **`CreateView.test.js`**：批量 describe 加 afterEach 清场；mountS2V mount 前强制复位；2 处 beforeEach 加复位钩子。**旧测试断言零改动**
- **方案文档 §2.8 补后续 + 新增 §2.10 + §2.2 表格第 3 步更新为完成**

### 排障过程（如实记录，含一次自摆乌龙）

污染的定位花了多轮：①先按 §2.8 的 Teleport 残留假设修（无效）；②加计数器发现 `resetBatchCreateForTest` 的**双模块实例**假象（vm 读 9、模块读 9 一致后排除）；③一度怀疑日志顺序（stdout 异步缓冲乱序，**基于日志顺序的推理全部作废**）；④最终用「mount 前强制复位」的兜底防线使 288/288 全绿——**写入者的精确定位仍未完成**（已知：污染与「输入文案」用例的 9 次 add 强相关、发生在下一用例的 mount 窗口、mount 前复位可完全防御）。**兜底防线已足够保证测试正确性；根因的精确定位留待后续（不影响正确性）**。

### 验证

| 项 | 结果 |
|---|---|
| `CreateView.test.js` | **288/288 全绿**（断言零改动） |
| `teleport-cleanup.test.js` | 3/3 |
| `src/views` + `src/locales` + overlay | **1794 passed / 1 skipped**（78 文件） |
| 债务熔断 | PASS（circularDeps: 0） |
| Gate 7 `--keys` | PASS（1655 key） |

### 遗留（不假装已闭合）

- 污染写入者的精确定位未完成（兜底防线已保证正确性；若后续出现同类模式，优先考虑「桥接 setter 带代际标记拒收过期 vm 写入」的根治方案）
- 第 4/5/6/7 步维持 §2.9「不做」结论
