# Tasks: ux-audit-progress-watchdog

- [x] 1. 判据本体 `apps/desktop/src/utils/publish-progress-staleness.js`（阈值单点 + `computeStaleInfo` 纯函数，R1–R10）
- [x] 2. 纯函数回归锁 `publish-progress-staleness.test.js`（实跑 `Tests 28 passed`，含导出面契约与两份结构锁）
- [x] 3. 组件侧看门狗 `apps/desktop/src/composables/usePublishProgressStaleness.js`（15s 采样、只在有运行任务时存在、卸载/完成停表）
- [x] 4. 面板接入 `PublishProgressPanel.vue`：陈旧徽标（`role=status`/`aria-live=polite`）、× 三态可用性、陈旧态 × = 收进胶囊、胶囊提示替换
- [x] 5. locales zh/en 成对新增 `staleBadge` / `staleCloseHint`
- [x] 6. 面板行为锁（新 describe `Tests` 计入 `PublishProgressPanel.test.js` 全绿；含"只改 lastEventAt 即翻转"的可证伪锁、假时钟时间路径锁、定时器计数正控）
- [x] 7. 变异反证驱动 `scripts/publish-staleness-contract-mutate.js`（现 17 条）：一次干净跑 `CAUGHT=17 其余=0`（rc=0）；三条探针侧纠正（M4 不可编译注入、M3/M4/M5 锚点随重构漂移、M3 判别用例遍历被测集合本身）逐条改后重验；驱动本身按评审 i3 改造（还原进 `finally`、探针抛错单列 PROBE_BLIND）
- [x] 8. `.gitignore` 反选新驱动本体（`scripts/*.js` 第 106 行会静默忽略它）
- [x] 9. CI 同款聚合 lint：`pnpm exec eslint electron/ src/ --quiet` rc=0
- [x] 10. PRD `01-docs/PRD-PUBLISH-PROGRESS-STALENESS-2026-10-21.md` + 审计 1.8 行状态 + 本 PR 执行记录 `openspec/records/ux-audit-progress-watchdog.md`
- [x] 11. QM-6 第一轮外部评审（critic=claude，DUAL/893 行）：9 条问题、5 条进裁决，**5 条全部 upheld 并已修**（i1 逐会话兜底、i2 终态相位提中立模块、i3 驱动还原护栏、i4 类型假设的真 store 取证、i7 胶囊分钟数的假时钟锁）；处置表见本记录 §五，方法论见 design D7。裁决由引擎自扮演出口记录（`adjudicatedBy=self_play`，置信权重 0.6），**跨家族外部复核仍未闭合**（见 §遗留）
- [ ] 12. 推分支、开 PR、核对 CI；仅在机械闸门全绿且无待裁决争议时自动合并
