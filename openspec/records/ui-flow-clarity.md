---
record: ui-flow-clarity
task: 按 PRD-UI-FLOW-CLARITY 落地 S1（导航收敛）+ S2 部分（披露与文案明示）
date: 2026-10-19
---

## 本次执行记录：UI 操作流转清晰化 S1+S2部分（ui-flow-clarity，2026-10-19）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | 运行时代码 | worktree `D:/Data/projects/mp-worktrees/mp-ui-flow-clarity`，裸分支 `ui-flow-clarity`；`node scripts/verify-worktree-deps.js` → OK（11 项消费方解析通过）；共享根保持 main clean |
| 第一性原因（QM-5 ①） | 同一语义的 UI 存在多份实现，且外壳层承担了页面内职责 | 草稿箱 5 处实现（整页/发布页浮层/发布记录页标签/采集页面板/零引用死组件）；账号域 tab 切换 100% 依赖全局外壳层 `MpModuleNav`（`Accounts.vue` 全文件零 `?tab=` 写入控件）；菜单「发布」指向记录页而非编辑器 |
| 逃逸分析（QM-5 ②） | 缺「同一语义唯一实现」的机械判据 | 本轮之前无任何断言约束「草稿列表渲染点数量」「菜单落点与页面职责一致」「外壳层组件是否可删」；`MpModuleNav.test.js` 只测组件内部行为，测不出「删了它页面还能不能用」 |
| 修复 + 回归保护（QM-5 ④） | 已落地 4 组新判据 | ① `tab-independent-home.test.js` 断言方向反转 + 新增跨文件「MpModuleNav 不得复活」结构锁；② `route-registry-entry-hosts.test.js`（4 例）把 `/publish/history` 的多宿主从注释变成白名单锁，并锁定菜单落点不含 history；③ `PublishDestinationModal.test.js`（7 例）锁「已存草稿」披露节点 `role=status` + 固定 testid + 空选项不可选；④ `collection-visual-case-contract.test.js` 断言 `CollectionDraftsPanel.vue` 不得复活 |
| 防止再次发生（QM-5 ⑤） | 判据入仓 + 文档记录偏差 | 上述 4 组断言随本 PR 进入 CI；PRD §15.2 逐条记录「文档原写法 vs 实际事实」10 处（其中 D10 推翻 §12 对 S4 影响面的估计：全仓 `first-run` 386 处，非「≥10 处 tests」） |
| 行尾与 diff 对账 | 两口径一致 | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径待 CI 复核；本 PR 无删除行归因歧义（删除集中在 5 个整块 UI 与 2 个组件文件） |
| 接线棘轮 | 新增 2 个测试文件由 `vitest run` 通配覆盖 | `apps/desktop/src/config/route-registry-entry-hosts.test.js`、`apps/desktop/src/components/PublishDestinationModal.test.js` 均位于 `apps/desktop/src/**`，被 `pnpm --filter @multi-publish/desktop test` 与 CI 分片通配收集 |
| QM-1 打包 / QM-4 视觉 | QM-1 N/A；QM-4 基线重建 | 本 PR **未修改** `apps/desktop/electron/**` ⇒ QM-1 不适用。QM-4：删除 70px 模块导航层使主窗口内页面整体上移、账号页新增 tablist，故同步重建 `tests/visual-testing/base-screenshots/` 受影响基线 |
| QM-6 CCG 双模型外部评审 | 未执行（本机后端不可用） | 会话内三轮对抗评审中，第三轮两条轴（S1 可实施性 / 盲区）均未返回结果，按 AGENTS.md「子代理降级」转主代理自执行，结论见 `.ccg/reviews/ui-flow-clarity-review.md` §E.3；**不以此冒充双模型通过** |
| 远程同步 | 由门禁推导 | 见模板说明：合并后由 `scripts/lib/merge-ledger.js` 按 squash 尾注推导，本行不改写 |

### 测试证据（本机实测）

| 套件 | 结果 |
|------|------|
| `src/views/Accounts.test.js` | 126 passed（含新增 8 例 S1a 契约） |
| `src/views/Publish.test.js` | 110 passed（含新增「草稿箱单一发布出口」） |
| `src/views/PublishHistory.test.js` | 90 passed |
| `src/views/Collection.test.js` + `collection-visual-case-contract.test.js` | 117 passed |
| `src/views/HotTopics.test.js` | 56 passed |
| `src/config/sidebar-menu.test.js` + `route-registry-entry-hosts.test.js` | 33 passed |
| `src/router/index.test.js` + `PublishScheduleResult.test.js` | 5 passed |
| `src/components/PublishDestinationModal.test.js` | 7 passed |
| 四受改动视图套件串行复跑 | **440 passed** |
| `check-route-registry.js` | PASS（36 路由 / 22 菜单 / 11 暗路由） |
| `check-locale-sync.js --keys/--cjk/--pair-base` | 三项 PASS（CJK 硬编码 1331→1164，无新增） |

> 说明：一次全量 `vitest run` 在本机挂死（node 进程 CPU 增量归零），同期另有其他 worktree 的 vitest 进程在跑；
> 终止后改为分批 + 受影响套件串行复跑，全部通过。该挂死未归因到本次改动（受影响套件单独跑与组合跑均绿）。

### 遗留（不假装已闭合）

- **S2 剩余**：经核实「去发布」双路径**本就同构**（`buildPublishFromProject` 仅服务视频路径，`type:'video'` 硬编码符合设计；图文路径靠 `?draft=` 不带 type 由 `Publish.vue` 回落 `article`），无需改动。
- **S3 未开始**：交接参数收敛 + `useRouteHandoff` + 深链重定向层。
- **S4 未开始**：首跑引导下线（§14 #1 裁决）。影响面 386 处（preload API、license 白名单、`isFullScreenRoute`、ipc-manifest、约 40 处视觉配置、2 张基线），须单独 PR 逐项清点。
- **暗路由** `/intelligence`、`/auto-pipeline` 按 §14 #3 裁决维持登记，本 PR 未动。
