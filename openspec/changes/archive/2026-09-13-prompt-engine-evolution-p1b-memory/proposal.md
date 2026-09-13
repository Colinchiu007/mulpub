## Why

P0 反馈管道（双日志 + 统计）已沉淀 generation/feedback 数据，P1b 主题指纹（fingerprint.js）已能判定「新输入与库中哪个模板/片段同类」；但 learnt 模板仍无落库、门禁与治理通道——经验只停留在日志层，无法沉淀为可复用、可回滚的模板资产。记忆库 + 治理层是「采集 → 评估 → 记忆 → 优化 → 治理」闭环中把「高价值片段沉淀为可复用资产」的关键一环，也是 P1b 规格明确划定的另一半（指纹规格 §8 声明「PromptMemory 入库/门禁/状态机为 P1b 另一半，不在指纹范围」）。

## What Changes

- **新增 PromptMemory 记忆库 V0**（`services/prompt-evolution/prompt-memory.js`）：
  - `prompt-library/library.json` 索引 + `templates/<id>@<version>.json` 版本化模板文件
  - full + fragment 两级；learnt fragment 仅允许 compositionType/action/object/creativeLevel 四类可控参数（越界字段入库即拒绝）
  - 模板记录含 mode、sourceText（concept 原文，支撑 dictVersion 变更重算指纹）、fingerprint（由 concept 计算落盘，缺失 fail-close 不参与检索）
  - 元数据：`source(builtin|learnt|manual)`、`provenance{learnedFrom,acceptedEvents}`、`stats{uses,acceptRate(滑窗),avgScore,avgCost,lastUsedAt}`、`state(draft|active|deprecated|disabled)`、`guard{checksum,validatedAt,gateRules,evaluatorVersion}`
- **新增 Governance 治理层**（`services/prompt-evolution/governance.js`）：
  - 门禁 6 规则：structure（engine/mode 分档 + fragment 白名单 + compositionType 值域）/ compliance / length / noSecrets（预编译 token 表，不拼用户输入进正则）/ dedup（checksum 精确去重；近重复聚类归 P2）/ evaluatorVersion
  - 状态机：learnt 经 门禁 → draft →（人工确认）→ active → deprecated → disabled；V0 仅人工确认激活（数据确认阈值依赖 P1a score-log / P2 平台回灌）；内置池不落库
  - 滑窗退化回滚：acceptRate 连续 N 期 < 阈值或 avgScore 下滑 → 自动 deprecated → 回退上一版本/内置池；冷却期防抖；statsProvider 可注入（生产数据源依赖 P1 接线 + P1a score-log）
  - 成本配额：config 按引擎 dailyBudget；视频默认零自动评分
- **IPC 升级**（`ipc-handlers/generation-feedback.js`）：
  - `prompt-library:list`：P0 空骨架升级为真实只读列表，**保持 P0 响应 envelope `data:{templates, evolution}`** 兼容
  - 新增 `prompt-library:get`、`prompt-library:save`（入参 `{engine, mode, type, content, concept, eventId}`，eventId evt_ 前缀校验，过门禁进 draft）、`prompt-library:activate`（draft→active 人工确认）
  - 沿用 `code+data+message` + `core/error-codes.js` EC 常量（新增 TEMPLATE_* 系列 -20..-23）
- **preload**：`promptLibraryList` 保持，新增 `promptLibraryGet/Save/Activate` 暴露
- **接线**：`bootstrap/phase1-context.js` 沿用 P0 env 开关模式（`MP_EVOLUTION_ENABLED === '1'`，默认关）
- 前端「存为模板」按钮 UI 归 P2（本 change 仅交付 save IPC 契约与 E2E 可测入口）；生成主路径消费（optimizedBy=learnt-template）归 P2 Optimizer

## Capabilities

### New Capabilities
- 无（复用既有 `prompt-engine-evolution` 能力，不新建 capability 路径）

### Modified Capabilities
- `prompt-engine-evolution`: 在既有（P0 采集 + P1b 指纹）10 条需求基础上，新增记忆库（模板结构/落库/检索数据源）、门禁 6 规则、状态机与滑窗回滚、成本配额、`prompt-library:*` IPC 契约 5 类需求

## Impact

- 新文件：`apps/desktop/electron/services/prompt-evolution/prompt-memory.js`、`governance.js` + 各自测试
- 修改：`ipc-handlers/generation-feedback.js`（prompt-library:* 真实实现）、`preload/system.js`、`bootstrap/phase1-context.js`（单例接线 + env 开关）、`core/error-codes.js`（TEMPLATE_* 常量）、config 默认值
- 复用：fingerprint.js（检索/评分）、signal-collector.js（statsProvider 注入点）、story2video-engine COMPOSITION_PATTERNS（四类可控参数权威结构 + compositionType 值域）、`core/error-codes.js`
- 不改变：`generateCandidates` 同步签名、内置 COMPOSITION_PATTERNS 池、`generation:feedback` 契约、`PromptBridge` 契约、fingerprint.js
- 依赖：零新增第三方；测试走 `os.tmpdir()` 隔离
