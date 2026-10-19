# Critique v1 — 对抗性评审（跨家族）

> critic: claude CLI（Anthropic 家族，与 proposer GLM 家族交集为空）
> 方式：独立读取仓库源码抽查证据，非转述 proposer 自述
> 原始输出：%TEMP%\adv-review-out.txt（2026-10-19）

## 证据抽查结论（P0 六条全部核实为真）

P0-1（MemberCenter.vue:83/118/154）、P0-2（css 无 plans/redeem/single 定义）、P0-3（plan-matrix.js:23 三档 vs labels.js:36-42 无 standard）、P0-4（Subscription.vue:19 裸渲染 / UsageQuota.vue:33 JSON.stringify）、P0-5（Messages.vue:22 裸错误码 / AccountSecurity 无 error 渲染）、P0-6（UpgradeModal 硬编码 + 注释自认服务端权威源）——**全部成立**。subscription-service.js:202-204、license.js:45 等细节引用亦准确。

## Issues（9 条）

```json
{
  "issues": [
    { "id": "MISS-1", "severity": "high", "target": "§3.1 第2条 · 升级CTA改造", "issue": "方案主张升级CTA改为按最高档feature判定或plan序比较，但当前契约下不可行：standard与pro的features数组逐字节相同（plan-matrix.js:150-153 仅按 videoMonthly/scheduleBatch/dashboard 布尔派生，两档全命中），hasFeatureOf 无法区分；服务端也未下发plan序/rank。", "evidence": "plan-matrix.js:150-153; entitlement-gate.js:50-54", "suggestion": "扩展契约（rank 字段或 pro 专属 feature）前置到 Phase1，或退回修正版 plan!=='pro'。" },
    { "id": "MISS-2", "severity": "high", "target": "§4 Phase1 vs DoD 断链", "issue": "DoD 要求升级CTA全局唯一行为=路由 ?section=subscription，但 Phase1 动作5未列三入口跳转改造，?section= 深链机制排在 Phase2——Phase1 完成时不满足 DoD。", "evidence": "Dashboard.vue:272-273; MemberCenter.vue:158; router/index.js:38", "suggestion": "深链与入口改造移入 Phase1，或调整 DoD 措辞。" },
    { "id": "MISS-3", "severity": "high", "target": "§4 Phase1 回归测试清单", "issue": "modal 退役后 MemberCenter.test.js:134『概览保留升级入口并可打开UpgradeModal』必红，未列入需同步修改清单；Dashboard.style-guard.test.js:278-283 已锁『不渲染 UpgradeModal』，会员中心壳层 :158 却在渲染，同守则两处执行不一致。", "evidence": "MemberCenter.test.js:134; Dashboard.style-guard.test.js:278-283", "suggestion": "改写该用例为 CTA 跳转断言并列入 Phase1；DoD 补『壳层不渲染 UpgradeModal』结构锁。" },
    { "id": "MISS-4", "severity": "medium", "target": "§2 P0-3", "issue": "遗漏 entitlement.plan 三重 free 兜底叠加：identity.js:52 + currentPlanId（MemberCenter.vue:202）+ planLabelOf（labels.js:37）。plan 字段异常时用户被标成『免费版（当前）』；未知档位则『自定义方案』与『免费版（当前）』同屏矛盾。", "evidence": "identity.js:52; MemberCenter.vue:202; labels.js:37", "suggestion": "plan 缺失/未知一律中性态，不标『（当前）』。" },
    { "id": "MISS-5", "severity": "medium", "target": "§3 UpgradeModal 退役", "issue": "modal 退役后 trialAvailable=DEV 的试用入口 UI 消失，但 license:activate-trial 在 DEV 仍可用（license.js:45 仅 isPackaged 拒收），trial 激活路径成无 UI 触发的死代码，文档未提。", "evidence": "UpgradeModal.vue:121-146; license.js:45", "suggestion": "退役时同步决策 trial 入口处置。" },
    { "id": "MISS-6", "severity": "medium", "target": "§2 P1-10 / §3.1", "issue": "standard 用户在 Dashboard 经 hasFeatureOf(dashboard_full) 解锁全部面板，会员中心却显示升级 CTA——同一用户两处口径矛盾（特权已满 vs 需升级）。", "evidence": "Dashboard.vue:96/122/126; MemberCenter.vue:296", "suggestion": "统一两处判定来源。" },
    { "id": "MISS-7", "severity": "low", "target": "§2 P1-3", "issue": "矛盾触发条件未写清：ProfileMenu 显示『已连接』需 status==='error' 且 hasSessionIdentity 为真（ProfileMenu.vue:201）；labels.js:51 显示『需要重试』仅在纯 error 态。", "evidence": "ProfileMenu.vue:201; labels.js:51; zh.js:103", "suggestion": "补触发条件。" },
    { "id": "MISS-8", "severity": "low", "target": "§2 P0-1 措辞", "issue": "『七tab全部重复渲染』『三块互相重复』定性略夸大：plans/redeem 是跨 tab 恒定显示（错误挂在壳层），subscription tab 三块同屏但非内容重复。", "evidence": "MemberCenter.vue:83-154", "suggestion": "措辞改为『错误地挂在壳层导致 7 个 tab 全部恒定显示』。" },
    { "id": "MISS-9", "severity": "medium", "target": "§3.1 兑换本地校验正则", "issue": "方案给出的 /^[A-Z0-9]{4}(-[A-Z0-9]{4}){2}$/ 与服务端真实正则不同型：subscription-service.js:14 为 [ABCDEFGHJKMNPQRSTUVWXYZ2-9]，排除 I/O/0/1 易混淆字符。宽松版会放过服务端必拒的码（含 O/I/0/1），本地前置校验形同虚设；且与文档 §5 自查第3条『应与服务端同型』自相矛盾。", "evidence": "subscription-service.js:12-14", "suggestion": "前端直接复用服务端字母表；建议导出共享常量或契约镜像锁，杜绝两端漂移。" }
  ],
  "dimensions": { "完整性": 8, "一致性": 6, "清晰度": 8, "可行性": 5, "安全性": 8 },
  "lowest_dimension": 5,
  "converge": false
}
```

## 评审员补充说明

- 证据质量总体高：六条 P0 全部行号核实为真。
- 最大问题在可行性（5）：批评了现状却未给出可行出口（feature 判定不可行、plan 序缺数据源）。
- 次大问题在一致性（6）：DoD 与 Phase1 断链、保留测试未列入。
