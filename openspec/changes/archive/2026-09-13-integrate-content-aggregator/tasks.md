# Tasks: 热文采集模块集成

## Phase 1: 快速集成（0-30 天）

### 1.1 content-aggregator 包化适配 ✅
- [x] 1.1.1 修复 pth 文件指向正确路径（_archive_v1/src → src）
- [x] 1.1.2 验证核心导入（ContentPipeline, get_collector, RewriteProcessor, Collectors）
- [x] 1.1.3 python-backend pyproject.toml 添加 content-aggregator 依赖
- [x] 1.1.4 导入测试自动化（test_aggregation.py: 5 项导入测试）

### 1.2 Multi-Publish 依赖与封装 ✅
- [x] 1.2.1 python-backend/pyproject.toml 添加依赖
- [x] 1.2.2 新建 `multi_publish/aggregation/` 模块（__init__/models/service/router）
- [x] 1.2.3 实现 `AggregationService` 封装类
- [x] 1.2.4 实现 CollectRequest/RewriteRequest/BatchCollectRequest 等 Pydantic 模型
- [x] 1.2.5 AggregationService 单元测试（20 项全部通过）

### 1.3 API 端点 ✅
- [x] 1.3.1 `POST /aggregation/collect` — 单篇采集
- [x] 1.3.2 `POST /aggregation/collect/batch` — 批量采集
- [x] 1.3.3 `POST /aggregation/rewrite` — 改写
- [x] 1.3.4 `GET /aggregation/sources` — 可用源列表（12 源：4 无头 + 8 Phase2）
- [x] 1.3.5 `GET /aggregation/tasks/{task_id}` — 任务状态
- [x] 1.3.6 鉴权基础设施：shared auth deps 模块（identity_dependency 工厂）
- [x] 1.3.7 API 冒烟测试通过

### 1.4 前端页面 ✅
- [x] 1.4.1 审查现有 Collection 页面：已有 URL 采集 + 剪贴板导入 + 草稿箱
- [x] 1.4.2 Collection.vue 接入 Python aggregation API（aggregationCollect / aggregationRewrite）
- [x] 1.4.3 改写风格选择器对接（5 风格 + 3 长度）
- [x] 1.4.4 采集结果列表增强（累计列表 + 清空）
- [x] 1.4.5 i18n 文案成对新增（zh/en 各 28 键）
- [x] 1.4.6 前端测试（Collection.test.js 386 行）

### 1.5 基础设施 ✅
- [x] 1.5.1 凭证桥接：AggregationService._build_pipeline_config 从环境变量读取 PO_OPENAI_*
- [x] 1.5.2 Playwright headless 共存验证
- [x] 1.5.3 隔离 worktree 建立 + 质量门禁通过

## Phase 2: 能力下沉（31-90 天）

> 迁移顺序按依赖拓扑序：模型 → 工具 → 过滤器 → 改写器 → 采集器基类 → 具体采集器。

- [x] 2.1 数据模型层（Content/Article → shared/models/）
- [x] 2.2 无状态工具层（LanguageDetector/Translator → shared/processors/）
- [x] 2.3 过滤器层（SensitiveFilter/DedupFilter → shared/filters/）
- [x] 2.0 LLM Client 抽象层（LLMClient → shared/clients/，含协议 + 实现）
- [x] 2.4 改写器层（RewriteProcessor → shared/rewriters/）
- [x] 2.5 采集器基类（BaseCollector/SourceResult → shared/collectors/base.py）
- [x] 2.6 具体采集器（12 个全部迁移：api/rss/sitemap/tiktok/twitter/wechat/youtube/last30days + douyin/douyin_hot/wangyi/weibo_hot/xiaohongshu + anti_block）
- [x] 2.7 能力下沉完成：anti_block 已迁移；v2 monitor 复用留待 Phase 3 评估
- [x] 2.8 依赖切换：get_collector 工厂已迁移至 shared；CA 所有采集/改写/过滤/LLM 模块均为 shared 的 re-export

## Phase 3: 原项目退场（91-180 天）
- [x] 3.1 content-aggregator 仓库已降级为薄壳：所有 v1 引擎代码迁移至 shared，CA 侧仅保留 re-export shim 和未迁移的 v2 backend/web 模块
- [x] 3.2 文档更新：architecture-analysis.md、review.md、design.md、proposal.md、tasks.md 均已更新

## Phase 4: 质量优化（2026-09-06）

- [x] 4.0 P0: shared 库 LLMServiceAdapter 提交并推送（shared c079b3a → 1c36d0b）
- [x] 4.0 P0: CA 未推送 commits 推送至 origin/codex/phase2-shared-migration
- [x] 4.0 P0: 死代码清理（service.py collect_batch 重复检查）
- [x] 4.0 P0: 测试硬编码 worktree 路径修复（改用 TestClient + 404 验证）
- [x] 4.1 P1: LLM 双轨合并 — AggregationService.rewrite() 切换至 shared 库 RewriteProcessor + LLMServiceAdapter
- [x] 4.1 P1: LLM 配置统一 — LLM_API_KEY/LLM_BASE_URL/LLM_MODEL 优先，向下兼容 PO_OPENAI_*
- [x] 4.1 P1: get_task_status 接入内存任务追踪器（_create_task/_update_task/get_task_status 生命周期）
- [x] 4.2 P2: 敏感词表外置 — SENSITIVE_WORDS_PATH 环境变量加载 JSON/YAML 词表（shared 库 1c36d0b）
- [x] 4.3 P3: ContentPipeline 拆分评估文档（content-pipeline-evaluation.md）
- [x] 4.4 P2: 前端错误状态细化 — 错误码分类（-1~-5）+ 重试按钮 + 内联错误提示
- [x] 4.5 安全: aggregation 端点添加 publish:read 鉴权依赖（与其他 /api/* 端点一致）
- [x] 4.6 测试: 27 项 aggregation 测试全部通过；shared 库 197 项全部通过
