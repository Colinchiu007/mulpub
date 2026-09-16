## Why

爆款库（viral_library）与个人知识库的检索实现存在致命断点：`searchViralItems` / `searchPersonalItems` 用「用户整篇原文」做 `LIKE '%整文%'` 子串匹配，长文改写场景下命中率趋近于零，「结合爆款库/个人经历」复选框形同虚设。同时：采集入库的互动指标恒为 0（PRD 声称的 metadata 映射从未实现）、采集页改写走 Python 链路无知识注入、改写历史用完即弃、发布后表现数据无任何回采通道——整个「采集→入库→改写→发布→效果归因」闭环缺失。

## What Changes

- **P0 检索修复**：新增 keyword-extractor（规则分词为主 + LLM 兜底）；store 层检索重构为多关键词 OR 命中 + JS 评分排序（命中数×10 + log10 互动数 + confidence×5）；KnowledgeContextBuilder.buildFullContext 变 async 接 LLM 关键词兜底。
- **P1 模式卡片**：新表 viral_pattern_cards（钩子/情绪曲线/叙事结构/CTA/金句/标题公式，一对一）；PatternExtractionService 后台队列提取（有界并发，失败降级浅层特征）；注入升级为聚合风格指导；Collection.vue 改写切换 Node 引擎 + HotTopics 默认开爆款库；模式分析标签页。
- **P2 效果闭环**：新表 rewrite_history / tracked_content / performance_snapshot / pattern_performance + ALTER publish_history；发布显式携带 rewrite_history_id；平台指标解析器注册表（第一批 zhihu/baijiahao/kuaishou/bilibili）；PerformanceRecrawlService（启动+每日、+1h/+6h/+24h/+72h/+7d 采样、7 天窗口）；采集时同步提取互动指标；发布历史表现列 + 手动录入 + 效果洞察页。

## Capabilities

### Modified Capabilities
- `rewrite-engine`: 知识检索从整文 LIKE 改为关键词提取+多词 OR+评分排序；上下文构建支持 async LLM 关键词兜底；爆款注入从浅层特征升级为模式卡片聚合风格指导。
- `desktop`: 采集页改写切换 Node 引擎并默认结合爆款库；HotTopics 创作默认开爆款库；新增模式分析视图、发布历史表现数据、效果洞察页；发布链路携带改写历史关联；新增表现数据回采与归因重算。

## Impact

- 修改：packages/rewrite-engine/src/（keyword-extractor 新增、knowledge-context-builder、index）、apps/desktop/electron/services/（store、pattern-extraction-service、performance-recrawl-service、platform-metrics/ 新增、rewrite-engine、publish-history、url-collector）、ipc-handlers、preload、bootstrap、Collection.vue、HotTopics.vue、RewriteView.vue、AiWriterPanel.vue、PublishHistory.vue、KnowledgeBasePage.vue、新 PerformanceInsights.vue、locales zh/en、store-schema。
- 风险控制：DB schema 变更走 migrate（存量回填 pending 卡片）；所有后台任务失败不阻塞主流程；LLM 不可用静默降级纯规则。
- 分三个 PR 顺序落地：PR-1 检索修复 → PR-2 模式卡片 → PR-3 效果闭环。
