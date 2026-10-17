---

sync_reason: PR 刚开、尚未合并，远程同步状态待回填
sync_backfill_owner: Colinchiu007（本分支作者，合并后同一次提交内删除本两字段）

record: fix-upgrade-payment-entry
task: 升级入口指向修正——从死胡同弹窗改为会员中心（含清掉三处死代码）
date: 2026-10-17
---

# 升级入口指向修正（fix-upgrade-payment-entry）

## 1. 这次真正修的是什么

上一轮（数据看板任务）我判断「付费转化路径不可达」。本次调研**推翻了这个判断的一半**，并发现了一个更严重的实际缺陷。

### 1.1 真实缺陷：升级按钮点了没反应

`Dashboard.vue` 里同时存在：

- `import UpgradeModal from '@/components/UpgradeModal.vue'`（且前面挂着 `eslint-disable-next-line no-unused-vars`）
- `const showUpgradeModal = ref(false)`
- 4 处 `@upgrade="showUpgradeModal = true"`

**但模板里从未渲染 `<UpgradeModal>`。** 结果是用户点「升级解锁」→ ref 置 true → **没有任何组件消费它** → 界面上什么都不会发生。

逃逸原因：`Dashboard.test.js` 只断言「锁区块渲染出来了」，没有任何用例走到"点一下之后发生什么"。而当时 lint 已经报了 `no-unused-vars`（因为 import 了不用），却被 `eslint-disable` 掩盖过去 —— 那是**掩盖而非修复**，教训见 §5。

### 1.2 落点错了：会员中心才是正确目标

| 能力 | 位置 | 状态 |
| --- | --- | --- |
| 三档档位 + 真实价格（服务端 `GET /api/v1/plans`，与 `plan-matrix.js` 同源） | `views/MemberCenter.vue` | ✅ 已实现 |
| 当前档位标记 | 同上 | ✅ |
| **兑换码核销开通**（`POST /api/v1/redeem`，带 durationDays 与事务化到期结算） | 同上 | ✅ 已实现 |
| 在线支付 | — | ❌ 真未实现 |

即：**当前唯一真实可用的开通渠道（运营发兑换码 → 用户核销）就在会员中心**，而应用把所有升级入口指向了一个只有「付费通道筹备中」的弹窗。

## 2. 改动

| 文件 | 改动 |
| --- | --- |
| `views/Dashboard.vue` | 4 处 `@upgrade` 改为 `goToMemberCenter`（`router.push('/member-center')`）；删 `UpgradeModal` import、`showUpgradeModal` ref 及那条掩盖问题的 `eslint-disable` |
| `layouts/MpSidebar.vue` | `@upgrade` 改为 `router.push('/member-center')`；删弹窗渲染、import、ref，以及**因此不再需要的弹窗互斥 watch**（它原本要在弹窗打开时挂起内嵌 WebContentsView 防被原生图层压住；没有弹窗就不需要。函数本身另有 7 处在用，未删） |
| `views/Publish.vue` | 清同类死代码：`UpgradeModal` import、`showUpgradeModal` ref 与导出项（模板 0 次使用，纯死引用） |
| `views/Dashboard.test.js` | 新增 2 条验收：点 trend / pattern 锁区块 CTA → `router.push('/member-center')` |
| `layouts/MpSidebar.test.js` | 原断言「点升级 → 弹窗出现」改为「点升级 → push('/member-center')」。**这不是放宽断言，而是换掉一个锁错误行为的断言** |

**不改**：`UpgradeModal` 组件本身（46 处测试引用，其"筹备中"文案是诚实的，只是不该作主入口）；`MemberCenter.vue`（它已经是对的，且用户已在目标页时弹窗是"详情"而非死胡同）。

## 3. 为什么不顺手把在线支付打开

`UpgradeModal` 4 个 `import.meta.env.DEV` 守卫里 **3 个关得对**，第 4 个不能简单打开：

| 入口 | 关闭理由 | 结论 |
| --- | --- | --- |
| 模拟支付 | 主进程 `app.isPackaged` 拒收 + `ADMIN_ONLY_CHANNELS` 双重硬拦 | 保持关闭 |
| 激活码 | P0 泄漏：`activate(key)` 零校验，任意字符串白嫖永久 Pro | 保持关闭（服务端 redeem 才权威） |
| 免费试用 | 本地写 `type=trial`，但 `plan-matrix` 只有 free/standard/pro，trial 命中 0 | 保持关闭 |
| 购买 | 定价模型脱节：权威源三档订阅 vs `payment-manager.PLANS` 只有 `pro ¥99 一次性买断`、`license-manager.activate()` 是买断 | **不能简单打开** |

在线支付真实前置：接支付平台 + 支付回调 → `SubscriptionService.grant({durationDays, providerReference})` + 对账/退款，涉及商户号、密钥、回调服务器与资金安全，**须独立立项并由人决策定价模型**。详见 `01-docs/PRD-FIX-UPGRADE-PAYMENT-ENTRY-2026-10-17.md` §5。

## 4. 门禁

- 变更类型：运行时代码（`apps/desktop/src/`）→ 隔离 worktree `mp-fix-upgrade-payment-entry`，分支 `fix-upgrade-payment-entry`
- TDD：先写测试确认**精确变红**（`expected "vi.fn()" to be called with arguments: [ '/member-center' ]`），再改实现转绿
- 受影响测试：`Dashboard` / `MpSidebar` ×3 / `MemberCenter` / `Publish` / `views-coverage` / `views-deep2` / `more-tests` / `UpgradeModal` —— 全部通过
- Lint：`0 errors`（4 个 warning 均为既有，其中 `Publish.vue:724` 的 unused-disable 位于 `AiWriterPanel` 前，与本次删除的三行无关）
- 无样式改动 → 不涉视觉基线

## 5. 教训（已同步进 learnings）

**`eslint-disable-next-line no-unused-vars` 出现在一个 import 上时，它不是你该按下去的按钮，而是"这个 import 没被使用"的诊断。** 本次的事实链条是：加了 import → lint 报未使用 → 加 disable → 于是「模板忘了渲染组件」这个真 bug 被永久掩盖。正解是查"为什么没用上"，而不是让告警消失。

**配套的测试判据**：任何"点击 → 应该发生 X"的交互，测试必须断言 X 的发生，不能只断言"按钮存在"。本次两个锁区块的 CTA 存在性一直有测试守着，但"点下去去哪"没有任何用例 —— 空洞正是这么形成的。

## 远程同步

| 远程同步 | PENDING |
| --- | --- |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 绝对路径 ✅ | 文档同步 ✅ | 远程同步 PENDING
