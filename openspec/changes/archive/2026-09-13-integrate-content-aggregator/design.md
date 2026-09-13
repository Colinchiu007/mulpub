# 热文采集模块集成 — 技术设计

## 决策记录

### 决策 1：集成方式选择

**背景**：content-aggregator 有独立运行的完整代码，需要选择集成到 Multi-Publish 的方式。

**选项**：
| 选项 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| A: 包依赖 | content-aggregator 作为 pip 包引入 | 简单快速，复用全部代码 | 紧耦合，版本管理复杂 |
| B: 微服务 | content-aggregator 独立运行，API 调用 | 松耦合，独立部署 | 运维复杂，延迟增加 |
| C: 代码迁移 | 采集器直接复制到 Multi-Publish | 无外部依赖 | 代码分叉，维护困难 |

**决策**：Phase 1 选 **A（包依赖）**，Phase 2 逐步迁移到 **C 的变体（迁移到 shared 库）**。

**理由**：
- 包依赖是启动成本最低的方式，可以立即验证集成效果
- 迁移到 shared 库后，Multi-Publish 和 content-aggregator 都依赖同一套代码，消除分叉
- 避免微服务的运维复杂度（Multi-Publish 是桌面应用，不适合微服务架构）

### 决策 2：采集器运行位置

**背景**：采集器需要 httpx/Playwright 等网络库，需要决定在哪个进程中运行。

**选项**：
| 选项 | 描述 |
|------|------|
| A: Python 后端（FastAPI） | 采集器在 python-backend 进程中运行 |
| B: Electron 主进程（Node.js） | 用 Node.js 重写采集器 |

**决策**：选 **A（Python 后端）**。

**理由**：
- 采集器已有完整的 Python 实现（9 种源），重写成本高
- Python 后端已存在，基础设施（TaskQueue、ProgressReporter、CredentialCrypto）可直接复用
- Playwright 在 Python 后端运行，与 Electron 的 Chromium 实例隔离，避免冲突

### 决策 3：数据模型归属

**背景**：content-aggregator 有 `Content` / `Article` 模型，Multi-Publish 有 `PublishTask` 模型。

**决策**：`Content` / `Article` 在 Phase 2 迁移到 content-aggregator-shared，作为跨项目的标准数据模型。`PublishTask` 保持不变，通过转换函数桥接。

**理由**：
- `Content` / `Article` 是采集和改写领域的模型，`PublishTask` 是发布领域的模型
- 两者是上下游关系，不应合并
- 放在 shared 库中可以让所有项目使用统一的数据契约

## 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        Multi-Publish                             │
│                                                                   │
│  ┌───────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │ AggregationView   │  │  RewriteView     │  │ PublishView  │  │
│  │ (Vue 3 新页面)     │  │  (已有)           │  │ (已有)        │  │
│  └────────┬──────────┘  └────────┬─────────┘  └──────┬───────┘  │
│           │                      │                    │          │
│  ┌────────▼──────────────────────▼────────────────────▼───────┐  │
│  │              Electron IPC Bridge (已有)                     │  │
│  └────────────────────────┬───────────────────────────────────┘  │
│                           │ HTTP                                  │
│  ┌────────────────────────▼───────────────────────────────────┐  │
│  │              Python Backend (FastAPI)                        │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │  │
│  │  │ aggregation/ │  │  services/   │  │  publishers/     │  │  │
│  │  │ (新增封装层)  │  │  llm_service │  │  (已有)           │  │  │
│  │  └──────┬───────┘  └──────────────┘  └──────────────────┘  │  │
│  │         │                                                    │  │
│  └─────────┼────────────────────────────────────────────────────┘  │
│            │                                                       │
│  ┌─────────▼────────────────────────────────────────────────────┐  │
│  │           content-aggregator (pip 包)                         │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │  │
│  │  │ collectors/  │  │ processors/  │  │ workflows/       │   │  │
│  │  │ (9 种采集器)  │  │ (改写/过滤)   │  │ pipeline.py      │   │  │
│  │  └──────────────┘  └──────────────┘  └──────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │         content-aggregator-shared (共享库)                    │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │  │
│  │  │ auth     │  │ wechat_mp│  │ proxy    │  │ rpa_engine │  │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └────────────┘  │  │
│  └──────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

## 风险与回退

| 风险 | 回退策略 |
|------|----------|
| content-aggregator 依赖与 python-backend 冲突 | 使用 pip 的 `--constraint` 锁定版本；Phase 2 迁移后消除 |
| Playwright 浏览器实例冲突 | Python 后端使用独立 PLAYWRIGHT_BROWSERS_PATH；若不兼容则回退到仅支持无头采集源 |
| 采集器性能拖慢 API 响应 | 采集任务全部走 TaskQueue 异步执行，API 立即返回 task_id |
| 前端页面复杂度超预期 | 简化 Phase 1 前端为单页面 URL 输入，批量采集通过 API 触发，前端仅展示结果 |

### 决策 4：Phase 2 迁移顺序（依赖拓扑序）

**背景**：审查发现迁移清单是平铺的，未明确顺序。采集器 → 模型 → 改写器的依赖关系可能导致循环依赖：如果先迁移采集器，采集器依赖的 `Content`/`Article` 模型还在 content-aggregator 中，会造成 shared 反向依赖 content-aggregator。

**决策**：按以下 6 步拓扑序迁移，每步完成后验证 content-aggregator 和 Multi-Publish 都通过测试：

```
第 1 步：数据模型层
  Content / Article → shared/models/content.py
  （零依赖，先行迁移；同时保留 content-aggregator 中的 re-export 兼容层）

第 2 步：无状态工具层
  LanguageDetector → shared/processors/language.py
  TranslatorProcessor → shared/processors/translator.py
  （只依赖模型和 LLM client，不依赖采集器）

第 3 步：过滤器层
  SensitiveFilter → shared/filters/sensitive.py
  DedupFilter → shared/filters/dedup.py
  （依赖模型，不依赖采集器）

第 4 步：改写器层
  RewriteProcessor + RewriteConfig + RewriteStrategy → shared/rewriters/
  （依赖模型 + LLM client，不依赖采集器）

第 5 步：采集器基类
  BaseCollector + SourceResult → shared/collectors/base.py
  （依赖模型，不依赖具体采集器）

第 6 步：具体采集器（按优先级）
  RSSCollector → shared/collectors/rss.py
  SitemapCollector → shared/collectors/sitemap.py
  APICollector → shared/collectors/api.py
  YouTubeCollector → shared/collectors/youtube.py
  DouyinCollector → shared/collectors/douyin.py
  XiaohongshuCollector → shared/collectors/xiaohongshu.py
  WeChatCollector → shared/collectors/wechat.py
  WeiboHotCollector → shared/collectors/weibo_hot.py
  WangYiCollector → shared/collectors/wangyi.py
  TwitterCollector → shared/collectors/twitter.py
  TikTokCollector → shared/collectors/tiktok.py
  get_collector() 工厂 → shared/collectors/factory.py
  （最后迁移工厂函数，因为它依赖所有采集器）
```

**理由**：
- 拓扑序保证每一步迁移后，shared 库不反向依赖 content-aggregator
- 无状态工具优先，风险最低、收益快
- 采集器最后迁移，且按「无认证依赖（RSS/Sitemap/API）→ 有认证依赖（YouTube/抖音等）」排序
- 每步末尾执行「双项目回归测试」作为门禁，单步失败可独立回滚

**回退策略**：
- 每步迁移时，content-aggregator 中保留原文件 + 一个 re-export shim（`from shared.collectors.base import BaseCollector`），保证旧项目零感知
- 如果某步测试失败，只回滚该步，不影响已完成的步骤
