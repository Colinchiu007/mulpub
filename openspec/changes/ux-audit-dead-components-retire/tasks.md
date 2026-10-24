# Tasks: ux-audit-dead-components-retire

## 1. 取证与决策

- [x] 1.1 `TrialBanner` 生产渲染方 0（只有测试自己 mount）；文案在看板页已被产品决策撤下
      （`Dashboard.style-guard.test.js` 两版反转史），套餐差异由区块锁占位承载 ⇒ 判"删除"
- [x] 1.2 `LoadingState` 在 `main.js:57` 全局注册、`<LoadingState>` 模板用法 0 ⇒ 判"删除"
- [x] 1.3 **验证域纠偏**：只 grep `src/` 不够 —— `apps/desktop/test-setup.js` 是第二处注册点
      （镜像 main.js 的全局组件表）。首次删除后 4 个测试文件以 `Failed to resolve import`
      整片挂死，症状出现在与删除无关的文件上 ⇒ 删除面必须含它
- [x] 1.4 本 change 的 proposal / spec / design 落盘（`desktop-ui-consistency` ADDED 3 条 Requirement）

## 2. 删除

- [x] 2.1 `git rm` `TrialBanner.vue` / `TrialBanner.test.js` / `LoadingState.vue` / `LoadingState.test.js`
- [x] 2.2 `main.js`：去掉 `LoadingState` 的 import 与 `app.component('LoadingState', …)`，
      并在原地留一条"为什么删"的注释（零模板用法 + 骨架屏实际由 `EmptyState`/`UiSkeleton` 承担）
- [x] 2.3 `test-setup.js`：去掉测试全局组件表里的 `LoadingState` 与其 import
- [x] 2.4 `more-tests.test.js`：删掉 TrialBanner 的 4 条后该文件零用例（vitest 报
      `No test suite found` 而非跳过），且其 `UpgradeModal` import 本就未被使用 ⇒ 整文件删除；
      `UpgradeModal` 的真实测试在 `UpgradeModal.test.js`（已跑，12 条含在内共 56 passed）

## 3. 防复活锁

- [x] 3.1 新增 `src/components/dead-components.test.js`（首批 6 条 → 第一轮后 11 条；第二轮不增条数，只把两条判据的判据域收窄）：
      扫描域规模下界 / 组件文件不得复活 / 两处名字不得再出现在代码行 / `main.js` 不再注册 /
      `test-setup.js` 不再注册 / **反向守卫本身仍在做缺席断言**（对冲豁免清单）
- [x] 3.2 判据按代码行切（剥行注释）并豁免两个反向守卫 —— 否则守卫自己的说明文字与
      防回潮断言会把自己判成违规（本仓同型坑第 N 次）
- [x] 3.3 反证：**已落成驱动** `scripts/dead-components-contract-mutate.js`（与 1.5/1.6 同骨架）。
      计划原文是"不落驱动"，实施中推翻：C1/C3 两轮都因驱动自身失明被读成 MISSED，
      没有可复跑的驱动就无法把这件事证明给下一个会话。读数 CAUGHT=10/10（首批 5 道 → 第一轮补 C6/C7/C8 → 第二轮补 C9/C10），形态规矩见 PRD §6 与记录 §3.3

## 4. 文档与验证

- [x] 4.1 更正两处指向已删除文件的注释（`DashboardExtraPanels.vue` / `DashboardLockedPanel.vue`），
      改为 `git log --follow` 取证路径
- [x] 4.2 `01-docs/PRD-DEAD-COMPONENTS-RETIRE-2026-10-21.md`
- [x] 4.3 审计文档 1.3 行 + 文末落地记录；CHANGELOG 条目
- [x] 4.4 `openspec/records/ux-audit-dead-components-retire.md`（含 `| 远程同步 |` 表格行）
- [x] 4.5 全域 `vitest run src` 对照（读数写进记录）+ 聚合 eslint
- [x] 4.6 QM-6 双模型评审与逐条处置 —— critic=claude 10 条 → 4 条待裁决，**全部 upheld 并已修**
      （i1 对偶锁只做一半 / i2 注释剥离器两个方向都错 / i3 对比度探针依赖已撤类名 / i4 驱动承诺的 md5 回读没实现）。
      结算状态 self_play_blocked ⇒ 本条 PR 不能自动合并，出口是外部复核或人工判 needs_revision/cleared。
- [ ] 4.7 PR + CI + 合并后回读 main push

## 5. 遗留

- [ ] 5.1 阶段 5.3 的通用"未接线组件"门禁上线后，本批两例应收敛进它的棘轮；
      本批刻意不把全域打开（只锁这两例）
- [ ] 5.2 若产品将来确要恢复试用提示：MUST 同时恢复看板页「必须在 `.cohere-content` 内」的位置守卫
      并另开 change（锁的红文案里已写明这条前置）
