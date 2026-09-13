## Context

改写引擎策略链路已完整：packages/rewrite-engine 的 StrategyManager（5 套内置 + 远程下发）→ electron RewriteStrategyManager（userData/rewrite-strategies.json 持久化）→ RewriteEngineService 注入 → IPC `ai:list-rewrite-strategies` / `ai:get-recommended-strategies` 已在 preload 暴露。缺口纯在渲染层：RewriteView 未消费这些接口。

## Goals / Non-Goals

- Goals：RewriteView 策略可见、可选、发起前可预览自动匹配结果；与 AiWriterPanel 行为一致；i18n 成对；测试覆盖。
- Non-Goals：不改引擎/IPC/electron 服务层；不做策略管理（增删改归运营后台）；不做使用统计；不改 AiWriterPanel 现有交互（仅保持一致性参考）。

## Decisions

### D1: 策略区块复用 AiWriterPanel 的交互模式
radio（自动匹配/手动选择）+ 条件渲染下拉。默认 auto。理由：用户明确选择「与 AiWriterPanel 一致」，避免同一产品两套心智。

### D2: 预览用既有 IPC，不新建通道
调 `aiGetRecommendedStrategies(userSettings)` 取推荐列表第一名显示。userSettings 目前只含 platform（RewriteView 现有配置项），行业/目的/风格不在本页范围（Q3 限定）。平台变化时刷新；策略列表加载失败时预览显示占位文案，不阻塞改写。

### D3: 传参对齐
`strategyId: strategyMode === 'manual' ? (rewriteStrategyId || null) : null`。自动模式显式传 null，与 AiWriterPanel 完全一致，引擎侧 `_resolveStrategy` 收到 null 走自动匹配。

### D4: 预览刷新时机
挂载时 + platform watch 触发；改写进行中不刷新（避免闪烁）；预览请求失败静默降级为「--」（与策略列表加载失败的降级一致）。

## Risks / Trade-offs

- 预览与实际执行可能短暂不一致（两次独立调用间远程策略同步变化）——可接受，预览仅作提示，结果区仍显示实际 strategy.name。
- IPC 不可用（浏览器开发模式）时预览降级为占位，改写主流程不受影响（invokeWithFallback 已兜底）。

## Migration Plan

纯前端增量，无数据迁移。旧版本用户无感知变化（默认仍是自动匹配）。

## Open Questions

无——用户已就 Q1/Q2/Q3 给出决策。
