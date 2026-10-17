# PRD：升级入口指向修正（fix-upgrade-payment-entry，2026-10-17）

## 1. 一句话

把应用内所有「升级」入口从**死胡同弹窗**（`UpgradeModal`）改为指向**真实可用的会员中心**——那里已有真实档位、真实价格与兑换码核销。

## 2. 问题

### 2.1 现象

用户在免费档点任何「升级 / 升级解锁」按钮，弹出的是 `UpgradeModal`，正式包里该弹窗只显示「付费通道筹备中」，**没有任何可执行动作**。用户点完等于白点。

### 2.2 根因不是"没做支付"，而是"入口指错了地方"

上一轮（数据看板任务）曾判定「付费转化路径不可达」，本次调研**推翻了**这个判断。实际情况：

| 能力 | 位置 | 状态 |
| --- | --- | --- |
| 三档档位 + 真实价格展示 | `views/MemberCenter.vue`（`member-center-plans`，数据来自服务端 `GET /api/v1/plans`） | ✅ **已实现且可用** |
| 当前档位标记 | 同上（`is-current` + `planCurrentSuffix`） | ✅ 已实现 |
| 兑换码核销开通 | 同上（`member-center-redeem` → 服务端 `POST /api/v1/redeem`，带 `durationDays` 与事务化到期结算） | ✅ **已实现且可用** |
| 升级入口 | `Dashboard.vue` ×4、`layouts/MpSidebar.vue` ×1、`MemberCenter.vue` ×1 | ❌ **全部指向 `UpgradeModal`** |
| 在线支付 | 无 | ❌ 真未实现（见 §5） |

即：**唯一真实可用的开通渠道（兑换码）就在会员中心里，而应用没有把用户导过去。**

### 2.3 影响

免费 / standard 档用户看到"升级"入口 → 点开 → "筹备中" → 无后续动作。既拿不到价值，也不知道该怎么升级（运营发码后用户不知道去哪里核销）。

## 3. 方案

### 3.1 核心改动

所有**应用内升级入口**改为路由跳转 `/member-center`（会员中心）：

| 入口 | 位置 | 现状 | 改为 |
| --- | --- | --- | --- |
| 看板 4 个锁区块的「升级解锁」 | `views/Dashboard.vue` ×4 | `showUpgradeModal = true` | `router.push('/member-center')` |
| 侧边栏登录菜单的「升级 Pro」 | `layouts/MpSidebar.vue` ×1 | `showUpgradeModal = true` | `router.push('/member-center')` |
| 会员中心内部的升级按钮 | `views/MemberCenter.vue` | 打开 `UpgradeModal` | **保持不变**（用户已在目标页，弹窗在此语境下是「详情」，非死胡同） |

### 3.2 明确不改

- **不改支付实现**：不打开 `purchaseAvailable`、不接支付平台（理由见 §5）。
- **不改 `UpgradeModal` 内部**：它有 46 处测试引用，且其"筹备中"文案本身是诚实的；只是不该作为主入口。
- **不改会员中心**：它已经是正确的。只删掉那些"从别处跳进来还要再弹一个空窗"的路径。
- **不动侧边栏之外的其它流程**：`Publish.vue` 等处的 `showUpgradeModal` 若有模板引用一并核对，但不扩大改动面。

### 3.3 交互

```
免费用户 → 看板锁区块「升级解锁」
        → 会员中心（价目 + 当前档位 + 兑换码输入框）
        → 有钱：联系运营拿码 → 输入兑换码 → 即时开通
        → 想在线付：页面上如实显示「暂不支持在线购买」
```

关键点：**用户到达的地方有信息、有动作**，而不是一个只有"筹备中"三个字的弹窗。

## 4. 验收标准

| # | 验收项 | 判据 |
| --- | --- | --- |
| A1 | 看板锁区块点击「升级解锁」跳转 `/member-center` | 测试断言 `router.push` 被调用且参数为 `/member-center` |
| A2 | 跳转后不再出现 `UpgradeModal` | `showUpgradeModal` 不被置 true |
| A3 | 侧边栏「升级 Pro」同样跳 `/member-center` | 同上 |
| A4 | 会员中心内部升级按钮行为不变 | 原有测试仍绿 |
| A5 | 未登录用户点升级也成立 | 跳会员中心，由该页自己处理登录态（不新增判定） |
| A6 | 全量受影响测试通过 | `Dashboard.test.js` / `MemberCenter.test.js` / `MpSidebar*.test.js` |

## 5. 为什么不顺手把在线支付打开（必须写清）

`UpgradeModal` 里 4 个入口被 `import.meta.env.DEV` 恒关，**其中 3 个关得对**：

| 入口 | 关闭理由 | 结论 |
| --- | --- | --- |
| 模拟支付 | 主进程 `app.isPackaged` 拒收 + `ADMIN_ONLY_CHANNELS` 双重硬拦，按钮必然被拒 | 保持关闭（纯 UI 缺陷修复） |
| 激活码 | P0 泄漏：`activate(key)` 零校验，任意字符串白嫖永久 Pro | 保持关闭（服务端 `/api/v1/redeem` 才权威） |
| 免费试用 | 本地写 `type=trial`，但 `plan-matrix` 只有 free/standard/pro，trial 命中 0 | 保持关闭（否则看到 Pro 界面点下去被拦） |
| 购买 | 定价模型脱节：权威源三档订阅（standard ¥59月/¥499年、pro ¥79月/¥699年）vs 后端 `payment-manager.PLANS` 只有 `pro ¥99 一次性买断`、`license-manager.activate()` 是买断 | **不能简单打开** |

在线支付的真实前置条件：接入支付平台（支付宝/微信）+ 支付回调 → `SubscriptionService.grant({durationDays, providerReference})` + 对账/退款。这涉及真实商户号、密钥、回调服务器与资金安全，**必须独立立项并由人决策定价模型**，不得由本 PR 顺手实现。

注：渲染层 `entitlement.plans` 已含 `priceMonthlyCents` / `priceYearlyCents`，与 `plan-matrix.js` 同源——即**价目是对的，缺的只是支付通道**。

## 6. 测试计划

- 单元：`Dashboard.test.js` 新增「点击升级解锁 → router.push('/member-center')」+「不打开 UpgradeModal」；
- 单元：`MpSidebar` 相关测试更新升级入口断言；
- 回归：`MemberCenter.test.js` 保持不变（A4）；
- 手动/视觉：本次不改样式，无需重采视觉基线（若确因移除弹窗导致像素变化，按 QM-4 用 CI 渲染重采）。

## 7. 风险

| 风险 | 处置 |
| --- | --- |
| 用户期望"能在线付款"，改完仍不能 | 会员中心如实标注「暂不支持在线购买」，并把兑换码途径写清；本 PRD §5 作为对外口径 |
| 移除 UpgradeModal 入口导致某处功能缺失 | 只改入口，不删组件；`MemberCenter` 仍保留弹窗 |
| 测试大量依赖 `showUpgradeModal` | 只改触发方式，保留 ref 与组件引用，逐条跑受影响测试 |
