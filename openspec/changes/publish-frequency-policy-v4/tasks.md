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

- [x] 4.1 `packages/shared-utils` 全量：**50 文件 / 1035 passed / 10 skipped**
- [x] 4.2 apps/desktop **消费者并集**（`git grep` 反查 4 个被改模块名的全部测试，9 文件）：**294 passed**
- [x] 4.3 变异反证 **N1–N6 全部 CAUGHT**，红集互不相同；驱动入库 `.ccg/reviews/freq-v4-mutate.driver.js`
      （`__dirname` 推导路径 ⇒ 仓库内可直接复跑）；每条还原后 `Buffer.equals` 逐字节校验，
      收尾再对全量做一次 `FINAL_RESTORE_MATCH=true`
- [x] 4.4 逐文件行数门禁：`check-max-lines` rc=0（policy 424 行 < 500）
- [ ] 4.5 QM-1 打包：`build:vue` + `electron-builder --win --dir` + asar 产物内容判据（v4 数值特征命中、
      v3 残留 0 命中）+ 启动三层判据
- [ ] 4.6 QM-6 双模型外部评审（替代通道）与逐条处置，评审原件入库

## 5. 收口

- [ ] 5.1 PR + CI 全绿 + 自动合并 + 远程同步回填与销账
- [ ] 5.2 文档：PRD v4（本次已写）/ learnings / AGENTS 频率条目 / CHANGELOG 收口 / 执行记录载体
