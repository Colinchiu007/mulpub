# Rebuttal v1 — 逐条回应

> proposer: glm-5.3-flash (lead) | 对应 critique-v1 的 9 条 issue
> 证据分级：L1=反例（成立则评审应认错）；L2=约束；L3=权衡（评审可坚持）

## 逐条裁决

### MISS-1（升级 CTA feature 判定不可行）— **接受（L1）**

proposer 亲自重核 plan-matrix.js:145-172：features 派生仅四个布尔条件（videoMonthly>0 / scheduleBatch / dashboard==='full' + 固定两项），standard 与 pro 输出**逐字节相同的 5 项 features**；两档差异全在 quota/limits 数值（plan-matrix.js:160-170）。服务端 `GET /api/v1/plans` 下发的 catalog（:175-187）也**不含 rank/order 字段**。
结论：文档 §3.1 第 2 条「升级 CTA 改用 hasFeatureOf 或 plan 序比较」在当前契约下**不可行**，评审正确，撤回该建议。
**修订**：Phase 1 升级 CTA 处置改为两步——① 短期保留 plan 名单式判定但改为**正向名单** `['free','standard'].includes(entitlement.plan)`（显式承认这是过渡写法，消灭 standard 语义暗度）；② 将「plan-matrix 增加 rank 字段（或 pro 专属 feature）→ 渲染层 CTA 改用 hasFeatureOf(rank)」列为**契约前置任务**（服务端先行，含 entitlement 归一化同步），完成后替换 ①。归一化白名单（identity.js:52-60）需同步透传新字段，一并写入任务验收。

### MISS-2（Phase1 vs DoD 断链）— **接受（L2）**

核实属实：`?section=` 深链在 §4 Phase2，DoD 却全局要求唯一行为。两处修订取其轻：
**修订**：调整 DoD 措辞为「升级 CTA 全局唯一**目标**（Subscription 页）；`?section=` 深链为 Phase2 增强项」——Phase1 三入口先统一跳 `/member-center`（现状已是如此，P0-6 的 modal 消除即达成），Phase2 落深链时补 section 参数。不做「Phase1 同时落深链」的扩scope，避免 Phase1 膨胀。

### MISS-3（MemberCenter.test.js:134 必红 + 结构锁不对称）— **接受（L2）**

核实属实：MemberCenter.test.js:134-145 断言 CTA 可打开 UpgradeModal，modal 退役后必红。
**修订**：Phase1 回归测试清单补两项——① MemberCenter.test.js:134 改写为「升级 CTA 存在且**不渲染** UpgradeModal」（负向断言锁）；② DoD 增补「member-center 壳层模板不得渲染 `<UpgradeModal>`」结构锁（对称于 Dashboard.style-guard.test.js:278-283），使同一守则两处一致。

### MISS-4（三重 free 兜底叠加）— **接受（L2）**

核实属实：identity.js:52 plan 缺失默认 'free' → currentPlanId 兜底 'free' → planLabelOf value||'free'。三层任何一层被触发都会产生「免费版（当前）」的错误标注；未知档位则与 planCustom 矛盾。
**修订**：Phase 1 追加一条：planLabelOf 去掉 `|| 'free'` 兜底（undefined 返回中性文案）；currentPlanId 无 entitlement 或 plan 未知时**不渲染「（当前）」标记**；identity.js:52 归一化保留 'free' 默认（主进程契约不变）但前端不再依赖该默认做展示标注。写入 DoD。

### MISS-5（trial 死路径）— **部分接受（L3）**

接受事实：modal 退役后 DEV 环境 trial 入口 UI 消失、`license:activate-trial` 的 DEV 通路保留。
**部分拒绝的理由（L3 权衡）**：ipc-handlers/license.js:37-44 的注释已显式声明「activateTrial() 本身保留：将来若决定做试用，正确做法是往 plan-matrix 加 trial plan」——**保留该函数是有文档依据的既定决策**，非无意遗留。modal 退役只是让该函数回到「无 UI 触发」的休眠态，与 2026-10-07 移除入口时的决策一致（当时 trialAvailable 已在正式包关闭）。
**修订（采纳建议的落点）**：Phase1 动作 5 补一句「modal 退役后 DEV trial 通路维持休眠（不删函数、不复活入口），在 openspec/records 留一行处置说明」，不扩大为安全项。

### MISS-6（standard 用户 Dashboard 已解锁 vs 会员中心要升级）— **接受（L2）**

核实属实且比我原表述更尖锐：Dashboard.vue:96 经 `hasFeatureOf(entitlement,'dashboard_full')` 对 standard 放行全部看板，MemberCenter.vue:296 的 `plan !== 'pro'` 对 standard 显示升级 CTA。这是 P1-10 的**可观察症状级证据**（不止是代码风格批评），应升级进 P0-3 的后果段。
**修订**：P0-3 后果补一条「standard 用户跨模块口径矛盾：Dashboard 已解锁完整看板，会员中心仍要求升级」。CTA 修复按 MISS-1 的两步走。

### MISS-7（P1-3 触发条件）— **接受（L3）**

属实的表述精度问题。
**修订**：P1-3 补触发条件：矛盾仅出现在 `status==='error'` 且 `user.sub` 存在（hasSessionIdentity 为真）的窗口态——ProfileMenu.vue:201 此刻显示「已连接」，labels.js:51 显示「需要重试」。

### MISS-8（P0-1 措辞夸大）— **接受（L3）**

**修订**：P0-1 措辞改为「价目/兑换区块被错误地挂在壳层，7 个 tab 全部恒定显示；『订阅与方案』tab 下与权益卡同屏构成三块相邻的方案相关内容，视觉重复感最强」。保留 P0 定级（恒定显示本身就是功能性错乱）。

### MISS-9（兑换正则不同型）— **接受（L1）**

proposer 亲自重核 subscription-service.js:12-14：字母表 `'ABCDEFGHJKMNPQRSTUVWXYZ23456789'`，正则字符类 `[ABCDEFGHJKMNPQRSTUVWXYZ2-9]`，显式排除 I/O/0/1；且 ：12 注释说明与 LicenseManager.activate 输入习惯兼容。文档 §3.1 第 5 条给的 `[A-Z0-9]` 宽松版**确非同型**，与 §5 自查第 3 条自相矛盾——这是 proposer 落盘时引错自证材料，评审正确。
**修订**：§3.1 第 5 条改为「前端正则直接采用服务端字符类 `[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}(-...){2}`；正则本体由 `packages/api-publish-engine` 导出共享常量（渲染层经预构建常量注入或契约镜像锁引用），**禁止两端各自手写字面量**——与仓内 spec-mirror 机制同构」。

## 汇总

| 维度 | critique 评分 | 接受度 |
|------|--------------|--------|
| 完整性 8 | 3 项遗漏全接受（MISS-4/5/6） |
| 一致性 6 | 全接受（MISS-2/3/8） |
| 清晰度 8 | 全接受（MISS-7） |
| 可行性 5 | 全接受（MISS-1/9，两条 L1） |
| 安全性 8 | 部分接受（MISS-5，L3 拒绝扩展为安全项） |

9/9 回应完毕：7 接受、1 部分接受（含 1 处 L3 拒绝扩展，≤ 每轮上限 3）、无全拒。下一轮由评审方复核修订后的 proposal-v2。
