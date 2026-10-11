# 变更：快捷采集·中文素材源扩展（quick-collect-cn-sources）

## Why

快捷采集本体（PR #3303）已能「按固定提示词采集并出结果」，但**素材面只有 Reddit / Hacker News / GitHub 三个英文源**。
中文创作者关心的三类事——中文平台正在热什么、中文科技/AI 圈子在聊什么、平台规则有没有变——**一条都进不来**。

同时，仓库里**已经有一批中文榜单源在跑**（热门选题页的 `hot-topics-service`：8 主榜 + 5 垂类，带节流、熔断、缓存与解析器），
它们只是没被快捷采集用上。所以这次扩展的主干不是「新写一堆爬虫」，而是：

1. **把既有中文榜单接进快捷采集**（接线，零新抓取）；
2. 补一批**带发布时间**的免费中文/技术时间线（RSS/Atom/JSON，全部本机实测）；
3. 为「榜单类素材**没有发布时间**」这个事实，建立**诚实的统一素材模型与时间语义**（`timeKind: published | observed`），
   使产品与模型都不会把「抓取时刻」说成「发布时间」。

## What Changes

- **NEW** `apps/desktop/electron/services/quick-collect-sources.js`：声明式**源注册表**（唯一真源）。
  每条源声明 `{ id, label, kind: search|trend, sourceType: hottest|realtime, timeKind: published|observed,
  homeUrl, expectedDomains, intervalMinutes, riskLevel, group }`；导出 `SEARCH_SOURCE_IDS` / `TREND_SOURCE_IDS` /
  `ALL_SOURCE_IDS` / `getSource()` / `splitSources()`。指令里的源闭集**从它派生**（禁止第二份清单）。
- **MODIFIED** `quick-collect-materials.js`：素材模型增 `timeKind` / `observedAt` / `sourceType` / `rank` / `hotValue` /
  `urlKind`；窗口过滤按 §6 取「有效时间」；新增 `dropped.domain_mismatch` 归因。
- **MODIFIED** `quick-collect-engine.js`：按 `kind` 分流——`search` 源走既有 `searchFn`，`trend` 源走新增注入的 `trendFn`；
  检索三态口径扩为 `attempted = searchQueryCount + trendSourceCount`；`quickCollect` 增 `trendSources` / `sourceStats` / `timeKinds`。
- **MODIFIED** `quick-collect-prompt.js`：素材清单带**可归因源标签 + 名次 + 时间语义注释**；system 增一条硬约束
  （榜单素材不得表述为「发布时间」）。
- **MODIFIED** `quick-collect-presets.js`：内置词条按 §11 增补源（`builtin-ai-trends` 的提示词**逐字不动**）。
- **MODIFIED** `ipc-handlers/quick-collect.js` + 依赖注入：用 `hotTopicsService` 组 `trendFn`，映射为统一素材。
- **NEW** S2 抓取层：`quick-collect-trend-sources.js`（RSS/Atom/JSON 解析 + 字节上限 + 条数截断 + 按源节流 + 域名校验）。
- **MODIFIED** 渲染端：`quick-collect-commands.js` 源清单镜像（跨平面 parity 测试锁）、对话框「素材来源」分组提示、locale 成对新增。
- **NEW** 文档：`01-docs/PRD-QUICK-COLLECT-CN-SOURCES-2026-10-11.md`（含源清单、schema、时间语义、验收标准、开源调研与许可证边界）。

## Impact

- 影响面：`apps/desktop/electron/services/quick-collect-*.js`、`ipc-handlers/quick-collect.js`、渲染端 collection 域、
  locale（zh/en 成对）、若干测试文件。
- **不影响**：手动采集链路、`content-intelligence` 既有三源语义（`search` 源行为逐字不变）、结果卡与后续改写/发布链路。
- 合规边界：**不做登录态抓取**（公众号/小红书不进本扩展）；AGPL/GPL 项目零代码复用，只借鉴设计结论并注明出处。
- 风险：中文榜单源稳定性天然弱于 RSS（单源失败常态）⇒ 以「整源丢弃 + `sourceStats` 归因」降级，不冒充「无热点」。
