## Why

Multi-Publish 当前缺少"内容采集"环节——用户需要手动在其他平台找到文章、复制粘贴到编辑器，才能进入改写和发布流程。独立项目 content-aggregator 已实现完整的多源采集（RSS/YouTube/抖音/小红书/微信等 9+ 源）+ AI 改写 + 过滤流水线，但两者之间没有集成：

- 采集 → 改写 → 发布 的完整流水线在 Multi-Publish 中是断裂的
- content-aggregator 的采集引擎无法被 Multi-Publish 直接复用
- 共享库 content-aggregator-shared 只包含 auth/wechat_mp/proxy，缺少采集和改写能力

本 change 将 content-aggregator 的采集引擎集成到 Multi-Publish，作为内容创作流水线的第一步，实现"采集 → 改写 → 创作 → 发布"的完整链路。

## What Changes

- **Phase 1 (快速集成)**：content-aggregator 作为 pip 包引入 python-backend；新增 `multi_publish/aggregation/` 封装层；新增 API 端点（采集/改写/源管理）；新增前端 AggregationView
- **Phase 2 (能力下沉)**：将采集器、改写器、过滤器从 content-aggregator 迁移到 content-aggregator-shared；Multi-Publish 改为依赖 shared 而非 content-aggregator
- **Phase 3 (原项目退场)**：content-aggregator 独立仓库归档或降级为薄壳

详细方案见 `.ccg/tasks/integrate-content-aggregator/architecture-analysis.md`。

## Capabilities

### New Capabilities
- `aggregation-collect`: 热文采集核心能力——多源采集（RSS/URL/YouTube/抖音/小红书/微信/微博热点等）、内容过滤（敏感词+去重）、语言检测、自动翻译、AI 改写
- `aggregation-api`: 采集模块 API 端点——单篇采集、批量采集、改写、源管理、任务状态查询
- `aggregation-ui`: 前端采集页面——URL 输入、源选择、改写风格选择、采集结果列表、流水线衔接

### Modified Capabilities
<!-- 无既有 spec 被修改，此为新增模块 -->

## Impact

- 涉及仓库：content-aggregator（包化适配）、content-aggregator-shared（Phase 2 迁移）、Multi-Publish（python-backend + apps/desktop）
- 约束：采集器在 Python 后端运行，通过 HTTP 与 Electron 主进程通信；API Key 使用 Multi-Publish 的 CredentialCrypto 加密存储；前端遵循 Vue 3 + Element Plus + i18n 规范
- 风险：Playwright 依赖与 Electron 的 Chromium 实例隔离；批量采集使用 TaskQueue 异步执行
- 待澄清：Phase 1 中 content-aggregator 的安装方式（git 依赖 vs 本地路径）；Phase 2 迁移优先级（哪些采集器先迁）
