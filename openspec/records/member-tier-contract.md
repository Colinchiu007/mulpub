---
record: member-tier-contract
task: 会员档位机制落地——limits 透传 / 档位序保护 / 到期宽限 / 三条权益轴 / 价格结构 A
date: 2026-10-20
type: runtime
---

# 会员档位机制落地（member-tier-contract）

## 产出

- **服务端契约**：`plan-matrix.js` 新增 `rank` / `maxDevices` / `maxCloudAccounts` /
  `batchSizePerRun` / `modelTier` 五个字段与 `PLAN_RANK` / `planRank()`；`limits` 新增五个键；
  features 新增三条派生（`cloud_account_sync` / `batch_publish` / `tier_access_*`）；
  价格结构 A（pro ¥119/¥999）、standard 视频配额 500→300；`PLAN_MATRIX_VERSION 2026-10-20`。
- **权益下发链路**：签名快照与 `/api/v1/me` 均携带 `limits` / `graceUntil` / `previousPlan`；
  主进程 `normalizeEntitlement()` 与渲染层 `normalizeState` 白名单透传；新增
  `src/features/member/plan-limits.js` 纯函数层（缺失即放行 / -1 不限 / 只读不改）。
- **生命周期**：`postgres-commerce-store.applySubscription` 档位序保护（低档码只延时长不改档位，
  订单记请求档位、订阅与快照记生效档位，`entitlementPayloadFor(plan)` 现算快照）；
  `subscription-service.settleExpiry` 到期 7 天宽限（只保留只读看板 `dashboard_full`，不保留
  `schedule_batch`/`video_create`/`tier_access_*`；配额按 free；在途队列执行走免费档自带的
  `cloud_publish`，不依赖 `schedule_batch`）。
- **客户端交互**：`usePlatformSelection` 可选 `getEntitlement` 上限判据；`Publish.vue` 触顶播报；
  `locales/publish-page/{zh,en}.js` 两条文案。
- **文档**：新增 `01-docs/PRD-MEMBER-TIER-MECHANISM-2026-10-20.md`（数据校验/流程/逻辑/交互/
  显示项/提示文字/兼容/验收/风险/未落地项）；`pricing-strategy.md` v2.2；两份机制文档状态回写；
  `CHANGELOG.md`；`openspec/changes/member-tier-contract/{proposal,tasks}.md`。
- 无数据库迁移（仅 JSONB payload 增字段，向后兼容）。

## 数据校验（本轮新增字段）

| 字段 | 校验 |
|---|---|
| `rank` | 整数 ≥0；**不在 `NUMERIC_KEYS`**，overrides 覆盖即 `PLAN_MATRIX_CONFIG_INVALID`；未知档位 `planRank=-1` |
| `maxDevices` / `maxCloudAccounts` / `batchSizePerRun` | 整数 ≥-1，-1 在 `UNLIMITED_ALLOWED`；`maxCloudAccounts:0` 表示「本档不提供」 |
| `modelTier` | 整数 ≥0；-1 被拒 |
| `limits`（客户端） | 普通对象才透传，深拷贝隔离；单键只接受 number 与非空数字串，空串/NaN/缺失 ⇒ 不限 |
| `graceUntil` / `previousPlan` | 仅非空字符串透传，其余丢弃 |

## 质量节拍（执行记录）

- **变更类型与隔离声明**：运行时代码变更，在隔离 worktree
  `<仓库父目录>/mp-worktrees/mp-member-tier-contract`（分支 `member-tier-contract`）完成；
  共享主工作区保持 `main` 未落盘。
- **TDD**：先写测试（plan-matrix 新用例 / 仓储续叠两例 / 宽限用例 / entitlement 透传 /
  plan-limits 8 例 / composable 5 例），后写实现；每组测试在实现前红、实现后绿。
- **QM-1（改 `apps/desktop/electron/`）**：`pnpm exec electron-builder --win --x64 --publish never`
  **rc=0**（electron 43.7.7，产物 `dist-electron/win-unpacked`）；asar 清单含
  `electron/services/identity/entitlement-service.js`；启动验证（独立脚本，显式剔除
  `ELECTRON_RUN_AS_NODE`）**8 秒存活 = true、stderr 为空、verdict PASS**（父环境曾设置该变量，已按合同告警）。
- **QM-2 必检项**：本轮高频路径（`/me` 快照）仅新增 8 个数字字段与两字符串，无同步 CPU 密集原语；
  未新增全局组件/顶层 CSS；未新增 IPC 通道。
- **测试**：
  - `packages/api-publish-engine npm test` → **rc=0**（含 plan-matrix 19 例、仓储与订阅服务全绿）
  - `apps/desktop`：`entitlement-service` 17 例、`stores/identity` 22 例、
    `plan-limits` 8 例、`usePlatformSelection` 25 例、`views/Publish` **110 例**全绿
- **行尾/编码对账**：`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致（提交前取证）。
- **品牌残留**：`node scripts/check-no-brand-residue.js` rc=0（提交前取证）。
- **文档同步**：PRD / pricing-strategy / 两份机制文档 / CHANGELOG / openspec change 同批更新；
  locales zh/en 成对（Gate 7）。
- **旧载体**：`.quality-gates.md` 与 ledger 未动（2026-10-15 起冻结）。

跳过项：无（本轮为混合 PR，未走 docs-only 通道）。

| 远程同步 | 由门禁推导 |
| --- | --- |

- 保留门禁：变更类型与隔离声明 ✅ | 行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 由门禁推导（PR 合并后按主干历史自动收口）

## 记忆沉淀

- **内置记忆**（`~/.dsh/memory/Mulpub/`）：`member-tier-limits-contract.md`、
  `plan-stacking-downgrade-guard.md`、`expiry-grace-vs-offline-grace.md`。
- **外部记忆**（`01-docs/learnings.md`）：`entitlement-field-must-cross-snapshot-and-normalizer`、
  `rank-guard-renewal-writes-inside-transaction`（含「两条 grace 不得合值」）。
- **EverOS**：`app_id=multi-publish` / `project_id=mulpub` / session
  `member-tier-contract-mulpub-20261020`，flush 返回 **`extracted`**；
  落盘复核 `~/.everos/multi-publish/mulpub/users/me/.atomic_facts/atomic_fact-2026-10-19.md` 命中关键词。

## 明确未落地（防误读）

设备数服务端强制、云账号配额服务端扣减、生命周期触点、到期横幅 UI、
视频/日发提交前校验的数据源、proration/试用/在线支付——归口见 PRD §12。
