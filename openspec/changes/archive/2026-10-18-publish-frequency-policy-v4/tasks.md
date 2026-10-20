---
change: publish-frequency-policy-v4
branch: publish-frequency-v4
---

# tasks — publish-frequency-policy-v4

## 1. 规格与判据先行

- [x] 1.1 主干规格复核：`openspec/specs/publish-frequency-control/spec.md` 通读，确认 v4 两项改动
      **不与任何 MUST 冲突**（该规格是数值无关的：两档间隔 + 取更严者 + 回落最严档 + 缺席不绕行）。
      与 v3 不同——v3 必须改主干是因为那句「超时 MUST NOT 回滚」已被 v2 自身违反；这次没有这种矛盾，
      所以**不动主干**，条款只写在增量规格里
- [x] 1.2 增量规格 `specs/publish-frequency-v4/spec.md`：平台档统一且不得整条删除（ADDED）、
      回落基线逐维度不弱于任何已登记平台（MODIFIED 到 v4 读数）、配额分档单调保持（ADDED）
- [x] 1.3 设计定档：平台档三候选 A/B/C 的取舍与"不删 C"的证据链（design D1）；
      350 这一推导值写明理由与改法（design D2）

## 2. TDD 红（先看见红，再改实现）

- [x] 2.1 改写策略表精确断言到 v4 值 ⇒ 实测 6 条指名红（精确表 / 全域账号档上限 /
      平台档统一 1′ / 档间单调新形状 / 日配额数据表 / env 覆盖后的 clip 配额）
- [x] 2.2 夹具同形：`container.setup.test.js`（读真实策略）、
      `PublishFrequencySettings.test.js`（mock 与生产 `_intervals` 返回逐字同形，含 `tier`）
- [x] 2.3 新增行为锁：真实策略接进守卫，逐档断言 `_rollbackCap === 5`
      （配额 200/350/500 下许可不得跟着放大；不从公式推断）

## 3. 实现

- [x] 3.1 `TIER_PRESETS`：`platformMinMs` 三档 → `1 * MIN`；`accountDailyMax` → 200/350/500
- [x] 3.2 `BASELINE_INTERVALS` → 5′/1′/200（仍是独立常量，注释写明三个维度的"更严"方向不同）
- [x] 3.3 头注释升到 v4，并保留 v3/v2 的变更史（历史事实不改写）
- [x] 3.4 文案同源：`platformIntervalHint`（zh/en 成对）"各档账号档更严" → "都不低于本值（短内容档两者相等）"

## 4. 验证与反证

- [x] 4.1 `packages/shared-utils` 全量：**50 文件 / 1038 passed / 10 skipped**（两轮 re-sync 吸收主干后复跑 **51 文件 / 1047 passed / 10 skipped**；多出的 1 文件 9 例来自主干的 `src/__tests__/article-body-format-parity.test.js`——实测该新增文件 `it/test` 行=9，且两棵树的 `tests/*.test.js` 文件数都是 15，故 1038+9=1047 完全对得上。本行原写 `1035` 是**第一笔提交时点**的读数，QM-6 采纳的三条锁落地后未回改 ⇒ 与 `CHANGELOG.md` 同源复述一起在纠正片里改成终值）
- [x] 4.2 apps/desktop **消费者并集**（`git grep` 反查 4 个被改模块名的全部测试，9 文件）：**294 passed**（合并前后各跑一次，同数）
- [x] 4.3 变异反证 **N1–N8 + N9a/N9b + N10 共 11 条全部 CAUGHT**，红集互不相同（清单以驱动 `.ccg/reviews/freq-v4-mutate.driver.js` 与 PRD §9 逐条对齐为准，**不存在编号 N11**；本行原写「N1–N6」是 QM-6 三条锁落地前的旧规模，同 4.1 一起纠正）；
      驱动入库 `.ccg/reviews/freq-v4-mutate.driver.js`
      （`__dirname` 推导路径 ⇒ 仓库内可直接复跑）；每条还原后 `Buffer.equals` 逐字节校验，
      收尾再对全量做一次 `FINAL_RESTORE_MATCH=true`
- [x] 4.4 逐文件行数门禁：`check-max-lines` rc=0（policy 424 行 < 500）
- [x] 4.5 QM-1 打包：`build:vue` + `electron-builder --win --dir` + asar 产物内容判据（v4 数值特征命中、
      v3 残留 0 命中）+ 启动三层判据 —— 实跑数字见 `openspec/records/publish-frequency-v4.md` 的
      「QM-1 打包 / QM-4 视觉」行（asar `entries=15001`、11/11 命中 / 0 缺失、exe 8 秒存活且 stderr 0 字节）；
      合并后那一档由 CI 的 `build` 作业在合并预览上真打包代跑（PR #3664 `build`=pass），本机未在新树重跑
- [x] 4.6 QM-6 双模型外部评审（替代通道）与逐条处置，评审原件入库 ——
      `.ccg/reviews/freq-v4-review-{backend,frontend}.md`，处置表 9 条（采纳 5 / 拒绝 3 / 登记不认领 2），
      每条都在当前树重放后再定归属

## 5. 收口

- [x] 5.1 PR + CI 全绿 + 自动合并 + 远程同步回填与销账 —— PR **#3664** squash → `dfead4cc5`（2026-10-16T13:27:13+08:00，
      24 项检查 23 pass / 0 fail / 1 skipping）；两轮 re-sync `34608fae3` / `65525c649` 的解冲判据与合并后复跑数字记在
      `openspec/records/publish-frequency-v4.md` 的「re-sync（两轮）与合并后复跑」行；回填由 **PR #3702** squash →
      `c9086f1cb` 完成（远程同步行改 PASS + 删 `sync_*` 三字段，按 #3672 不回写旧载体），
      `git ls-remote --heads origin publish-frequency-v4` = 0 行
- [x] 5.2 文档：PRD v4（本次已写）/ learnings / AGENTS 频率条目 / CHANGELOG 收口 / 执行记录载体 ——
      `01-docs/PRD-PUBLISH-FREQUENCY-V4-2026-10-15.md`、`01-docs/learnings.md` 置顶一节、
      `CHANGELOG.md` 置顶一条、`openspec/records/publish-frequency-v4.md`（新载体，未碰旧载体）。
      **其中「AGENTS 频率条目」未落地**（当场实测 `grep -c 发布频率 AGENTS.md` = **0**，本行原样保留计划项而不假勾）：
      数值口径的单一真源是策略模块 + PRD，主干规格 `openspec/specs/publish-frequency-control/spec.md` 已承接行为合同，
      AGENTS 那条要不要进 QM 清单属 #70 归档片一并定夺
