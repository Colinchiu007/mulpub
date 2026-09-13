## Why

改写策略目前只在「发布页 → AI 辅助写作面板 → AI 改写 tab」深处可见，且默认折叠在「自动匹配」之后；独立的「文案改写」页面（RewriteView）完全没有策略选择 UI，用户发起改写时无法感知引擎将使用哪个策略，导致「改写策略在前端没有体现」的困惑。用户已决策（2026-09-11）：

- Q1 选 B：RewriteView 补齐与 AiWriterPanel 一致的「自动/手动 + 策略下拉」；
- Q2：保持自动匹配为默认，但把「当前会匹配哪个策略」在发起改写前预览出来；
- Q3：只动桌面端 UI，不改运营后台、不做使用统计。

## What Changes

- RewriteView 配置区新增「策略选择」区块：自动匹配（默认）/ 手动选择 radio + 策略下拉（手动时渲染）。
- 自动模式下新增「匹配策略预览」：根据当前目标平台等 userSettings 调用既有 IPC `ai:get-recommended-strategies`，发起前即显示将命中的策略名；平台变化时自动刷新。
- 发起改写时按模式传 `strategyId`（手动=所选 id，自动=null 走引擎匹配），与 AiWriterPanel 行为对齐。
- zh/en locales 成对新增策略选择与预览文案（满足 CI Gate 7 locale 同步检查）。
- RewriteView.test.js 补策略区块、预览刷新、strategyId 传参的回归测试。

## Capabilities

### New Capabilities
- `rewrite-strategy-visibility-ui`: 桌面端文案改写页的策略选择可见性与匹配预览契约。

## Impact

- apps/desktop/src/views/RewriteView.vue（策略区块 + 预览 + 传参）
- apps/desktop/src/views/RewriteView.test.js（回归测试）
- apps/desktop/src/locales/zh.js、en.js（成对文案）
- 01-docs/PRD-REWRITE-FRONTEND-ENTRY.md（补充策略选择与预览规格）
- 不改 packages/rewrite-engine、electron 主进程 IPC、ops-center（全部复用既有接口）
