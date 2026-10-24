# Tasks: ux-audit-visible-navigation

## 1. 取证与规格

- [x] 1.1 定位两条入口的差异：`electron/services/hotkeys.js:58` 发 `app:navigate`，
      `App.vue` 订阅回调做裸 `router.push`；`MpSidebar.onNavClick` 是三段式
- [x] 1.2 写规格 delta（4 条 Requirement / 14 个 Scenario）与设计决策

## 2. 实现（TDD：先红后绿）

- [x] 2.1 先写 `App.visible-navigation.test.js`，在实现前实测 **6 failed | 3 passed**
      （三条红点名"只 push 主窗口路由时，跳转发生在原生覆盖层背后"）
- [x] 2.2 新增 `composables/useVisibleNavigation.js`（三段 + 三条降级纪律，依赖由调用点注入）
- [x] 2.3 `App.vue`：`api.onNavigate` 回调改为 `navigateVisibly(route)`
- [x] 2.4 `MpSidebar.vue`：删除组件内那份复制的判断，`onNavClick` 复用共享实现
- [x] 2.5 调用点装配 `apiGetter: () => getApi()`（惰性取桥，见 design 决策 2）

## 3. 契约锁

- [x] 3.1 `useVisibleNavigation.test.js` 31 条（A/B/C 三段、5 条无回执形态、抛错、缺桥、
      非法入参、`'/'`、装配锁、缺 `apiGetter` 不崩）
- [x] 3.2 `App.visible-navigation.test.js` 9 条（真 tab store + 假桥；顺序账本、定向不回落、
      已在首页不重复切、卸载无幽灵跳转、3 条"两处入口共用同一实现"结构锁）
- [x] 3.3 既有夹具 `MpSidebar.sidebar-focus-nav.test.js` 补 `flushPromises()`（多几层 await）

## 4. 反证

- [x] 4.1 新增 `scripts/visible-navigation-contract-mutate.js`（18 条变异 + `.gitignore` 反选）
- [x] 4.2 实跑：`[SUMMARY] 共 18 条：CAUGHT=18 其余=0`，rc=0（第三轮；首轮为 10/10，QM-6 两轮各追加 4 条与 3 条）；
      基线 `rc=0 failed=0 errors=0`（不干净的基线一律拒跑）
- [x] 4.3 M6 第一版（摘 `isHomeTab` 短路）实测 **零条红** → 改打 id 比较那一格才打通；
      结论写入驱动注释与 design 决策 3
- [x] 4.4 M7 第一版注入产生不可编译片段 → `PROBE_BLIND`，改为整函数体替换

## 5. 验证与收尾

- [x] 5.1 `pnpm exec vitest run src` 全量：见执行记录 §四 的现场读数
- [x] 5.2 聚合 eslint（`electron/ src/ --quiet`）
- [x] 5.3 行尾对账（`git diff --numstat` vs `--ignore-cr-at-eol --numstat` 逐文件相等）
- [x] 5.4 内容门禁：`check-no-brand-residue`、doc-gate、`check-pr-exec-record`
- [x] 5.5 PRD `01-docs/PRD-VISIBLE-NAVIGATION-2026-10-21.md` + 审计 §12 + `openspec/records/`
- [x] 5.6 QM-6 双模型评审处置（见执行记录 §五）
- [ ] 5.7 反证驱动接入 CI（与另外三条 contract-mutate 同批，预算另议；欠账登记在任务 #23）
- [ ] 5.8 合并后按主干历史推导远程同步（不回填、不开回填 PR）
