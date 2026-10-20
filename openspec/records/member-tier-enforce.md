---
record: member-tier-enforce
task: 会员档位硬门禁——平台数/批量上限服务端拒绝 + 客户端宽限判活
date: 2026-10-20
type: runtime
---

# 会员档位硬门禁（member-tier-enforce）

## 0. 一句话

把「档位上限」从客户端的提示变成服务端的拒绝：三条发布入口共用一份纯函数判据，
被上限拒绝的请求**不扣额度**；客户端补上离线快照的宽限判活。

上游：`01-docs/PRD-MEMBER-TIER-ENFORCEMENT-2026-10-20.md`（本批 PRD，含数据契约、
流程、交互、显示项、提示文案、验收、风险与回滚）。

## 1. 产出

| 文件 | 变更 |
|---|---|
| `packages/api-publish-engine/src/auth/plan-capabilities.js` | **新增**。`resolveLimits` / `checkPlanCapability` / `capabilityError`，纯函数、不读时钟 |
| `packages/api-publish-engine/src/publish-api-server.js` | 新增 `_assertPlanCapabilities` + `_assertPlanCapabilitiesForContext`；单平台发布、批量发布、`_authorizeScheduledEntry` 三处接线 |
| `apps/desktop/electron/services/identity/entitlement-service.js` | 新增 `applyGraceWindow`，在线/宽限快照/离线缓存三条装配路径统一投影 |
| `apps/desktop/src/locales/publish-page/{zh,en}.js` | 三个新错误码文案（成对） |
| `packages/api-publish-engine/test/plan-capabilities.test.js` | **新增** 9 例（边界/0 语义/-1/11 形态放行/数字串/顺序/配置漂移/错误翻） |
| `packages/api-publish-engine/test/plan-capabilities-wiring.test.js` | **新增** 5 例接线锁（require、三入口、顺序在扣额度之前、provider 缺失放行） |
| `apps/desktop/electron/services/identity/entitlement-service.test.js` | +1 例（过期/不可解析/仍有效三态） |

## 2. 数据校验（判据吃什么、怎么判）

| 输入 | 判定 |
|---|---|
| `limits` 缺失 / `null` / 数组 / 非对象 | 不拦（旧快照；按 0 处理会挡住存量用户） |
| 键缺失 / `null` / `''` / `NaN` / 非数字 | 不拦（该键视为无信息）；**`Number('') === 0` 必须显式排除** |
| 数字字符串 `'3'` | 按 3 判（兼容 JSON / 环境变量来源） |
| `-1` | 不限（与 `UNLIMITED_ALLOWED` 同语义） |
| `0` | 上限为 0 ⇒ 第 1 个就拒（云账号「本档不提供」≠ 不限） |
| 正数 | 边界值放行：`count > limit` 才拒 |

判定顺序固定：平台数 → 单次批量 → 云账号 → 设备（先报最贴近用户动作的那条）。

## 3. 质量节拍（执行记录）

- **变更类型与隔离声明**：运行时代码变更，在隔离 worktree
  `<仓库父目录>/mp-worktrees/mp-member-tier-enforce`（分支 `member-tier-enforce`）完成；
  共享主工作区保持 `main` 未落盘。
- **TDD**：先写 `plan-capabilities.test.js`（9 例）与接线锁（5 例），再接线；
  客户端先加三态用例（`entitlement-service.test.js` +1）再改装配点。
- **测试**：
  - `packages/api-publish-engine`：`plan-capabilities` **9 例**、接线锁 **5 例**；
    `npm test` 全量 **rc=0**（含既有 plan-matrix / 仓储 / 订阅服务）。
  - `apps/desktop`：`entitlement-service` **18 例**全绿（17 既有 + 1 新增）。
- **QM-1（改 `apps/desktop/electron/`）**：`pnpm exec electron-builder --win --x64 --publish never`
  **rc=0**；启动验证（独立脚本，显式剔除 `ELECTRON_RUN_AS_NODE` 并告警）
  **alive=true、stderr 为空、verdict PASS**（父环境曾设置该变量，已按合同告警）。
- **locale 门禁**：`--pair-base origin/main` PASS、`--keys` PASS（2176 个 key）、`--cjk` PASS。
- **明确不做的兼容动作**：不改价格/配额/features；不回溯裁剪已超限用户的选择集。

## 4. 记忆沉淀

- 内置记忆：`member-tier-server-hard-gate.md`（判据三条纪律 + 三入口对称 + 先判后扣）。
- EverOS：同内容以 `project_id=mulpub` 落一条，便于跨会话检索。
- learnings：本批的两条教训（「软提示不是门禁」「客户端离线路径不经过服务端投影」）
  记在 `01-docs/learnings.md`（若与热文件冲突则随执行记录保留，见上一批的处理方式）。

## 5. 未落地（如实登记）

| 编号 | 内容 | 状态 |
|---|---|---|
| N1 | `max_devices` 执行点（会话签发链路） | 判据已具备，缺调用方 |
| N2 | `max_cloud_accounts` 执行点（云账号 handler） | 同上 |
| N9 | `grant` 幂等 | 未做 |
| N4 | 会员中心到期横幅 UI | 未做 |
| N5 | 日发提交前校验（数据源） | 未做 |
| N7 后半 | 降级时自动裁剪已选超限平台 | 未做（本轮明确「不回溯」） |

| 远程同步 | 由门禁推导 |
| --- | --- |

- 合并后无需回填：`scripts/lib/merge-ledger.js` 按主干历史推导收口；
  main push 的读数写在 PR 评论里，不写回本文件。
