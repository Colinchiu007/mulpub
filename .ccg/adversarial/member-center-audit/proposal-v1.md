# Proposal v1 — 会员中心模块深度审查与优化方案

> objectType: plan | proposer: glm-5.3-flash (lead) | 日期: 2026-10-19
> 实体：[01-docs/AUDIT-MEMBER-CENTER-IA-2026-10-19.md](../../../01-docs/AUDIT-MEMBER-CENTER-IA-2026-10-19.md)（唯一权威版本，本文不复制内容，只做角色化声明）

## 方案声明

本提案为会员中心模块（apps/desktop/src/views/MemberCenter.vue + member-center/* 七子视图 + member/identity store + UpgradeModal）的深度审查产出，含：

- **§2 问题清单**：P0×6（功能性错乱：壳层重复渲染价目/兑换、区块零 CSS、standard 档标签缺失、feature/quota 裸渲染、错误反馈断链、双定价 UI 冲突）、P1×10（信息架构/交互）、P2（打磨项）。全部结论声称经行号核实。
- **§3 目标信息架构**：壳层瘦身（全局错误条 + 7 栏导航 + 唯一内容区 + ?section= 深链），价目/兑换迁入 Subscription，UpgradeModal 退役，升级入口统一路由跳转。
- **§4 三阶段落地计划**：Phase1 止血 P0（含回归测试要求），Phase2 IA 重排，Phase3 打磨（含像素门禁视觉回归）。
- **§6 DoD**：9 条可验证验收标准。

## 方案方自查声明（已做）

1. 本地激活码漏洞已修复（2026-10-07），方案不含安全修复项——已核实 ipc-handlers/license.js:45。
2. UpgradeModal 处置从「降级保留」改为「退役」：三入口已全部路由跳转 + Dashboard.style-guard.test.js 已有结构锁 + 内容重叠。
3. 兑换码本地校验对齐服务端 subscription-service.js:202-204 同型正则，不自造规则。
4. feature 判定复用 entitlement-gate.js（hasFeatureOf），不新造第二套。
5. P0-5/P1-4 经读模板核实：AccountSecurity 无 error 渲染、Messages 裸错误码、sessions 响应无 is_current。

## 已知边界与风险自认

- §3 深链 ?section= 需处理「未登录时 URL section 残留」——文档未展开，承认待补。
- 会话 is_current 为主进程侧改动，文档已声明需同步 IPC 测试，但未给出契约草案。
- CCG verify-module 判定模块缺 README.md/DESIGN.md——方案未处理此项（判断为与本仓文档惯例不符的工具误报，本段即为声明）。

## 待评审问题

评审方应逐条核实 §2 各项证据真伪、评估 §3/§4 可行性与安全边界、寻找遗漏问题与内部矛盾，并按五维度打分。
