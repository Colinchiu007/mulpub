---
title: 改写引擎优化批次一方案
slug: rewrite-opt-batch1-prd
date: 2026-10-19
---

# 执行记录：改写引擎优化批次一方案（rewrite-opt-batch1-prd）

> 类型：纯文档 PR（新增方案 PRD，无代码变更）
> 分支：`rewrite-opt-batch1-prd`（共享根就地编辑 → 本地 main commit → 保分支 → reset → 推 PR）

## 本次执行记录：改写引擎优化批次一方案（rewrite-opt-batch1-prd，2026-10-19）【docs-only】

- 判定：node scripts/classify-docs-only.js --base=origin/main → docs-only=true（files=2：01-docs/PRD-REWRITE-OPT-BATCH1-2026-10-19.md、openspec/records/rewrite-opt-batch1-prd.md，以提交后实际取证为准）
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PR #NNNN（待开）
- 备注：方案内容为 #3980 诊断后的引擎优化提案（O1-O6），本 PR 不含任何代码变更

| 远程同步 | 由门禁推导 | PR 待开；收口按主干历史推导（change `gate-record-sync-derived-status`） |

## 变更类型与隔离

| 项 | 值 |
|---|---|
| 变更类型 | 📝 方案文档（先文档再代码前置门的产出物） |
| 变更规模 | S（纯新增 2 个文档文件） |
| 会话隔离 | 就地编辑（01-docs/ 与 openspec/ 为共享根放行路径；pre-code-edit-guard 对 docs 放行语义） |

## 内容要点

1. **O1 fewShot/chainOfThought 接线**（P0）：策略字段零消费点（实测 grep），接线进 `_buildPrompt`，含防二次注入与截断规则；
2. **O2 软截断 + 剥离护栏**（P0）：硬 slice 改句末软截断（70% 兜底 + truncated 标记）；`_stripStructureHeadings` 加「句末标点不剥 + ≤8 字才剥」护栏，修复「结尾是关键。」被整行丢弃的误伤；
3. **O3 质量分拦截**（P1）：semanticPreservation<40 打 warnings + imitate 低分可降强度重试一次（fail-open + 开关，不自动替换结果）；
4. **O4 采纳信号回流**（P1）：`_historyScore` 增采纳率档（30 天窗口 / 5 样本门槛），history 权重 10→15；
5. **O5 三方冲突检测**（P1）：策略 maxLength × 字数区间 × 体裁×模式 的冲突调和指令 + metadata.conflicts；
6. **O6 长文分段改写**（P2）：单独立项，方案骨架已给出（切分 / 200 码点衔接锚 / 顺序执行 / fail-closed / >3000 才触发）。

每项均含：现状（标注实测/推断）、目标行为、实现位置、验收标准、回归锁（含变异反证）、工作量与风险。

## 实施批次

| 批次 | 内容 | 工作量 |
|---|---|---|
| 第一批 | O1 + O2 | 1 天 |
| 第二批 | O3 + O5 | 2 天 |
| 第三批 | O4 | 1 天 |
| 独立立项 | O6 | 2-3 天 |

全局硬验收：「无配置 ⇒ 行为与现状逐字节一致」（向后兼容）；每批独立 PR，不合并大 PR。

## 证据边界

实测：四字段零消费点、采纳信号不通策略维、硬截断、剥离误伤判据、质量分无消费分支。
推断：长文单次调用两头打折（无量化；他人 `5df46e079` 的 6000 截取佐证痛点）。
