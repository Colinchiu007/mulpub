## Why

改写引擎的输出格式约束（如"只输出纯文案、不含结构标题"）目前硬编码在 `_buildPrompt` 里，无法自定义维护。用户需要一套**最高优先级的硬约束**：不管选什么改写模式和改写策略都强制生效，与模式/策略内容冲突时以硬约束为准，且可在运营中心自定义维护多个版本（唯一默认）。

## What Changes

- **引擎侧**：`RewriteEngine` 新增 `setHardConstraints(text)` 注入点；`_buildPrompt` 的 systemPrompt 最前置注入硬约束段（位于 strategy.systemPrompt 之前，声明"冲突时以此为准"）；移除上次硬编码的纯文案约束（升级为种子数据）。
- **桌面端**：新增 `RewriteHardConstraintManager`（JSON 持久化 + sanitize + applyRemote）；`OpsCenterSync` 消费 bootstrap 的 `rewrite_hard_constraints`；`RewriteEngineService` 注入引擎。
- **ops-center 后端**：新模型 `RewriteHardConstraint`（多版本，唯一 is_default）；CRUD API（编辑标题/内容、删除、设为默认——设默认时自动取消其他默认）；runtime/bootstrap 下发默认版本；种子数据（初始硬约束）。
- **ops-center 前端**：「改写硬约束」管理页（列表 + 编辑 + 删除 + 设为默认，唯一默认标记）。

## Capabilities

### Modified Capabilities
- `rewrite-engine`: systemPrompt 支持最前置硬约束注入，优先级高于策略/模式指令。
- `ops-center`: 新增改写硬约束管理（CRUD + 唯一默认 + bootstrap 下发）。
- `desktop`: 硬约束从运营中心同步并注入改写引擎。

## Impact

- 修改：packages/rewrite-engine/src/rewrite-engine-core.js、apps/desktop/electron/services/（rewrite-hard-constraint-manager 新增、rewrite-engine、ops-center-sync）、ops-center/backend/（models、routers/rewrite_hard_constraints 新增、services/rewrite_hard_constraint_service 新增、runtime_service、main.py）、ops-center/frontend/src/（views/RewriteHardConstraints 新增、api、router、menuItems）、locales。
- 风险控制：硬约束缺失时回退引擎内置默认（不阻塞改写）；bootstrap 下发失败静默降级；唯一默认由后端事务保证。
