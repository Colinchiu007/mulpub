# Proposal: member-tier-contract（会员档位机制落地——契约层 / 生命周期 / 客户端校验）

## Why

`01-docs/MECHANISM-MEMBER-TIERS-2026-10-19.md`（v1.1）与 `01-docs/MECHANISM-MEMBER-TIERS-DEEP-2026-10-19.md`（v2.1）
已经给出三档机制与逐条代码取证，但机制停在文档里。四个结构性缺口在代码中可复现：

1. **`limits` 是空头承诺**：`publish-api-server.js` 的签名快照只含 plan/features/quota，
   不含 `limits`；客户端 `entitlement-service.js` 的 `normalizeEntitlement()` 又把 `limits` 整段丢弃。
   ⇒ 「5 平台 / 50 篇日发」在客户端连内存态都进不去，发布页无从校验。
2. **standard 与 pro 的 `features` 逐字节相同**：只由 `videoMonthly` / `scheduleBatch` / `dashboard` 派生，
   ⇒ 升级 pro 只剩配额数字变化，没有任何「质变」权益。
3. **跨档续叠会平移降级**：`UPSERT_SUBSCRIPTION` 无条件 `plan = EXCLUDED.plan`。
   pro 用户兑一张 standard 码，剩余 pro 期整体降级；而「兑换新码可续叠」正是到期通知文案引导的动作。
4. **到期降级是悬崖**：`settleExpiry` 一次性写 free 快照，在途队列任务下一次 `requireFeature` 直接 403；
   客户端 72h grace 只覆盖离线场景，在线到期用户无缓冲。

同时 v2.1 已论证价格结构：¥59→¥79 只有 1.34×（行业中位约 2.0×），撑不起功能分界线——
这正是缺口 2 的经济根源。

## What Changes

### ADDED Capabilities

- `member-tier-contract`：会员档位契约层——`rank` / `maxDevices` / `maxCloudAccounts` /
  `batchSizePerRun` / `modelTier` 五个矩阵字段、三条新权益轴的 features 派生、
  `limits` 随签名快照下发并在客户端可校验、跨档续叠档位序保护、到期 7 天宽限。
- `client-plan-limits`：客户端档位判定的纯函数层（缺失即放行 / -1 是不限 / 只读不改），
  以及发布页平台数上限拦截。

### MODIFIED Requirements

- `plan-matrix` 契约：`PLAN_MATRIX_VERSION` 2026-10-08 → **2026-10-20**；pro 价格 7900/69900 →
  **11900/99900**；standard `videoMonthly` 500 → **300**；`features` 派生规则新增三条。
- `entitlement` 形状：新增 `limits` / `graceUntil` / `previousPlan` 三个透传字段（快照 + `/me` + 客户端归一化）。
- `applySubscription` 契约：新增可选 `entitlementPayloadFor(plan)`；返回新增
  `plan` / `requestedPlan` / `downgradeSuppressed`。
- `settleExpiry` 行为：free 快照附加 `graceUntil` / `previousPlan`，并保留上一档的
  `dashboard_full` / `schedule_batch`（配额仍按 free）。

## Impact

- **服务端**：`plan-matrix.js`、`publish-api-server.js`、`postgres-commerce-store.js`、
  `subscription-service.js`，以及四个测试文件。
- **桌面端主进程**：`entitlement-service.js`（归一化）；触发 QM-1 打包验证。
- **桌面端渲染层**：`stores/identity.js`、`usePlatformSelection.js`、`Publish.vue`、
  `features/member/plan-limits.js`（新增）、`locales/publish-page/{zh,en}.js`。
- **文档**：新增本 PRD；`pricing-strategy.md` v2.2；两份机制文档状态回写；`CHANGELOG.md`。
- **不改**：会员中心 UI、支付链路、`consumeFeature` 扣减逻辑、设备会话表结构。

## Decisions（本轮拍板，需 CEO 追认）

| # | 决策 | 理由 |
|---|---|---|
| D1 | 采用结构 A：pro ¥119 / ¥999 | v2.1 C2.3；支付未接通，零存量窗口 |
| D2 | standard 视频配额 500 → 300 | v2.1 C4.3；3× 余量原则 |
| D3 | `rank` 不可被 overrides 覆盖 | 档位序可配会让降级保护静默失效 |
| D4 | 低档码「只延时长不改档位」 | 不得让已付费未到期用户因兑换低档码失去权益 |
| D5 | 宽限期保留只读与队列、不保留生成 | 收尾不是免费续期 |
| D6 | 客户端 `limits` 缺失即放行 | 反方向会因一次字段漂移把付费用户整片拦死 |
| D7 | 设备数/云账号配额本轮只落契约不落强制 | 服务端扣减需独立 API 变更，防扩权 |

## Out of Scope（本轮明确不做）

设备数服务端强制、云账号配额服务端扣减、生命周期触点（额度 80%/到期前/D+7）、
到期横幅 UI、视频/日发提交前校验的数据源、proration / 试用 / 在线支付。
归口见 `01-docs/PRD-MEMBER-TIER-MECHANISM-2026-10-20.md` §12。

## Risk

| 风险 | 缓解 |
|---|---|
| 调价与既有营销物料不一致 | 同步 `pricing-strategy.md`；支付未接通无存量；回滚 = 改四个常量 |
| 低档码语义变化影响运营预期 | 通知文案明示；PRD §10 记录为「行为变更」 |
| 快照新增字段影响旧客户端 | 旧客户端忽略未知字段；缺失即放行 |
| 平台数拦截误伤 | 仅 `max_platforms >= 0` 才拦截；单测覆盖取消路径与按组路径 |
