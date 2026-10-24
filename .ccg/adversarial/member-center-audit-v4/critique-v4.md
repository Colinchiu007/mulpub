# Critique v4 — 跨家族评审（claude CLI，2026-10-23）

> 评审对象：v4 修订稿（§0 摘要 + §3/§4/§9 修订 + §7c）。全新上下文、可读仓库、逐条源码核实。
> 结果：6 条 issue（1 critical / 3 major / 1 minor / 1 确认性），三维评分 9/9/8，最低 8 ≥ 8.0，**converge=true**。

## Issue 摘录

| ID | 级别 | 目标 | 结论 |
|----|------|------|------|
| E1 | major | §0/§3.1/Phase1-6 | **「plan_rank 一步到位」有已实现/待实现混淆风险**：plan-matrix 有 PLAN_RANK、identity.js:62-64 归一化 limits，但 `grep plan_rank apps/desktop/src/views/member-center/` 零命中，渲染层仍是 `plan !== 'pro'`。文档描述的是目标状态，执行者可能误以为已完成而跳过 Phase 1 动作 6 |
| E2 | critical | §9.3-2/P0-6 | **v4「假陈述」定性被源码完全支持**：zh/en.js:103 文案已改为「在线支付已开通，请前往会员中心购买」，而 UpgradeModal 仍硬编码两档、无兑换码、无真实支付入口。建议退役四件套执行时同步删三个 locale 键（paymentChannelUnavailable/activationCodeMigrated/trialUnavailable） |
| E3 | major | P0-3 | 核实为准确：labels.js:36-42 无 standard 分支，plan-matrix.js:25 三档确认。无新问题 |
| E4 | major | §8 MAJOR-1 | 核实为准确：member.js 9 async 零 catch、权限错误同步 throw 链路完整。无新问题 |
| E5 | major | §9.4 | **四项机械锁全部核实存在且描述准确**：buyout-removal:86 命名锁、OrdersBilling:21/24 navigate 契约、style-guard:278-290、icon-usage:30。无遗漏 |
| E6 | minor | Phase1-1 | 价目卡可购买需补一条约束：与订阅页按钮**共用同一 openPay 入口**、参数同源于服务端 plans，避免两条并行支付路径 |

## 评分

- 证据真实性 9/10：抽查 9 项断言全部与源码逐字对齐，无伪造
- 修订一致性 9/10：摘要表与正文完全对齐，Phase 1 与 DoD 一一对应
- 可行性 8/10：唯一实操风险是 E1 的已/待实现混淆与 E6 的双路径风险，均已可补约束闭环
