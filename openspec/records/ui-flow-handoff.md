---
record: ui-flow-handoff
task: 按 PRD-UI-FLOW-CLARITY §5-S3 落地交接参数单一入口 useRouteHandoff
date: 2026-10-19
---

## 本次执行记录：S3 交接参数收敛（ui-flow-handoff，2026-10-19）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | 运行时代码 | 独立 worktree `mp-worktrees/mp-ui-flow-handoff` + 裸分支 `ui-flow-handoff`（基于含 #3951/#3990 的 main `3291ba40b`）；`node scripts/verify-worktree-deps.js` → OK（11 项消费方解析通过）；共享根保持 main clean |
| 第一性原因（QM-5 ①） | 交接参数分散 4 处接线，互斥判断只有一处有守卫 | `watch(route.query.draft)` / `onMounted` / `onActivated` / 两个 composable 各自的 query watcher；互斥只写在 onMounted（L1409-1414），`onActivated` 对 `?republish=` **无守卫**直接调用（L1434）⇒ URL 同带 `?draft=X&republish=Y` 时后到者静默覆盖先到者已写入的表单 |
| 逃逸分析（QM-5 ②） | 既有测试只测「单参数各自生效」，没有「多参数同现」的用例 | `Publish.test.js` 的批量/单篇用例都是单参数；republish 逻辑**零渲染侧测试**（只有 electron 侧 snapshot service 测试）⇒ 双参数覆盖竞态逃过全部测试层 |
| 修复 + 回归保护（QM-5 ④） | 单一入口 + 10 例契约测试 | `useRouteHandoff.js`：优先级（批量>单篇>republish）在入口一次性裁定；`useRouteHandoff.test.js` 覆盖互斥（`draft=X&republish=Y` 只有草稿被装载、appliedIds 不消耗 Y）、叠加（video_path 与草稿共存）、缺失终态（不回落 republish）、幂等（onMounted+onActivated 双触发不重复装载）、query 变化重裁定 |
| 防止再次发生（QM-5 ⑤） | 判据入仓 + 出口收敛 | 新增交接参数只能进 `useRouteHandoff`（视图只剩 2 行 `await applyRouteHandoff()`，无第三处可挂）；`watchRepublishQuery` 独立接线已删（PRD 禁止双 watcher 各自判断）；PRD 措辞两处校准已回写注释（`?mode=` 全仓零实现不造参数；入口不重写 URL 故无透传问题） |
| 行尾与 diff 对账 | 两口径一致 | Publish.vue -52/+38（1758/1773 点名预算内）；新增 2 文件；numstat 与 `--ignore-cr-at-eol --numstat` 一致 |
| 接线棘轮 | 新增测试由 vitest 通配覆盖 | `src/composables/useRouteHandoff.test.js` 位于 `apps/desktop/src/**`，被 CI 分片通配收集 |
| QM-1 打包 / QM-4 视觉 | QM-1 N/A；QM-4 无回归面 | 未修改 `apps/desktop/electron/**`；本 PR 只改 JS 接线逻辑，模板/文案/样式零变化 ⇒ 渲染不变，无需重建基线 |
| QM-6 CCG 双模型外部评审 | 未执行（本机后端不可用） | 同 #3951 处置：commit 触发的 deepReview 以 `tier=self-play` + `status=self_play_resolved` 闭环（不冒充外部复核）；PRD 对抗评审阶段已由三轮双轴评审覆盖方案本身 |
| 远程同步 | 由门禁推导 | 合并后由 `scripts/lib/merge-ledger.js` 按 squash 尾注推导，本行不改写 |

### 测试证据（本机实测）

| 套件 | 结果 |
|------|------|
| `useRouteHandoff.test.js`（新增） | 10 passed |
| `Publish.test.js` | 7 failed \| 134 passed（**stash 对照实验**：改动前基线同样 7 failed \| 103 passed——7 个失败均为上游既有的文案详情 mock 环境问题，非本次回归；净多 31 通过，零新增失败） |
| HotTopics + Collection + 全部 composables | 56 套件 1166 passed |

### 基线对照实验说明（防止把既有失败读成回归）

先用 `git stash push -- Publish.vue` 在**未改动**基线上复跑 Publish.test.js，
确认 7 个失败逐条相同（文案详情模式 describe 的 mock 环境 + 测试 router 无 `/publish`
路由的 `editDraft` 导航断言），再 pop 恢复改动复跑——失败集合与数量逐条一致。
该实验把「我的改动是否引入回归」从推断变成对照测量。

### 遗留（不假装已闭合）

- 7 个既有 Publish 失败属上游（与 #3946 同批的文案详情改动的测试环境问题），
  修复需重建该 describe 的 mock 策略，超出本 PR 范围；已在 PRD §15.2 记为 D11 待办。
- `?mode=` 参数 PRD 设想未实现（真源是 `?type=`）——若未来需要独立 mode 语义，
  应作为 `useRouteHandoff` 的新消费分支接入，不得回退到视图内接线。
- PRD §5-S4（首跑下线、后台任务胶囊、审批门后续）未开始，按 §12 独立 PR。
