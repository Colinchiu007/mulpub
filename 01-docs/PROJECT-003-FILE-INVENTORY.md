# Multi-Publish (PROJECT-003) 完整文件清单

> 生成时间: 2026-06-17 | 版本: v1.1.7

## 项目概况

- **路径**: `C:\Users\邱领\projects\003-workspace\multi-publish`
- **GitHub**: Colinchiu007/Multi-Publish
- **技术栈**: Electron 33.4.0 + Vue 3 + Playwright RPA + SQLite + Python (FastAPI)
- **架构**: Monorepo (apps/desktop + packages/rpa-engine + packages/shared-utils + packages/python-backend)
- **安装包**: `dist-electron/Multi-Publish.Setup.1.1.7.exe` (236MB, 含 Playwright Chromium 浏览器)
- **Release**: https://github.com/Colinchiu007/Multi-Publish/releases/tag/v1.1.7
- **OpenCode 迁移**: `opencode-memory-export.json` (16.6KB, session + message 表)

---

## 一、项目根目录

| 文件 | 说明 |
|------|------|
| `package.json` | 根 monorepo 配置 (v1.1.7) |
| `package-lock.json` | 依赖锁 |
| `.gitignore` | Git 忽略规则 |
| `README.md` | 项目说明 |
| `CHANGELOG.md` | 版本变更日志 |
| `AGENTS.md` | AI Agent 工作指南 |
| `DESIGN.md` | 设计文档 |
| `ARCHITECTURE-PLAYWRIGHT.md` | Playwright 架构文档 |
| `DEVELOPMENT_REPORT.md` | 开发报告 |
| `INTEGRATION.md` | 集成文档 |
| `PRD.md` | 产品需求文档 |
| `PM-PRD-rongmeibao.md` | 融媒宝 PRD 分析 |
| `PM-PRD-v1.1.md` | v1.1 PRD |
| `003-electron-tech-design.md` | Electron 技术设计 |
| `ARCH-F1-format-adapter.md` | 格式适配器架构 |
| `ARCH-F1-platform-config.md` | 平台配置架构 |
| `ARCH-F2-cover-processor.md` | 封面处理架构 |
| `ARCH-F2-sensitive-filter.md` | 敏感词过滤架构 |
| `ARCH-F3-baijiahao.md` | 百家号架构 |
| `ARCH-F3-data-sync.md` | 数据同步架构 |
| `ARCH-F4-comment-manager.md` | 评论管理架构 |
| `P0-IMPLEMENTATION-PLAN.md` | P0 实施计划 |
| `P1-IMPLEMENTATION-PLAN.md` | P1 实施计划 |
| `P2-IMPLEMENTATION-PLAN.md` | P2 实施计划 |
| `P3-IMPLEMENTATION-PLAN.md` | P3 实施计划 |
| `requirements.txt` | Python 依赖 |
| `run.bat` | Windows 启动脚本 |
| `latest.yml` | electron-updater 配置 |

---

## 二、apps/desktop (Electron 桌面应用)

### 2.1 electron/ (主进程)

| 文件 | 说明 |
|------|------|
| `electron/main.js` | 主进程入口 (606行) |
| `electron/preload.js` | 预加载脚本 |
| `electron/logger.js` | 日志模块 |
| `electron/store.js` | SQLite 持久化 |
| `electron/python-bridge.js` | Python 后端桥接 (276行, 含守护进程) |
| `electron/auto-updater.js` | 自动更新 (GFW 静默) |
| `electron/first-run.js` | 首次运行引导 (v1.1.7已简化) |
| `electron/cookie-store.js` | Cookie 管理 |
| `electron/credential-store.js` | 凭据 AES-256-GCM 加密存储 |
| `electron/account-state-restorer.js` | 账号状态 JSONL 持久化 |
| `electron/publish-monitor.js` | 发布后状态查询 |
| `electron/publish-history.js` | 发布历史 |
| `electron/publish-alert.js` | 发布告警 |
| `electron/scheduler.js` | 定时发布调度 |
| `electron/batch-manager.js` | 批量发布 (并发3任务) |
| `electron/webview-manager.js` | 分屏监控 (2/3/4/6屏) |
| `electron/auth-view-manager.js` | 内嵌浏览器登录 |
| `electron/auth-qrcode-preload.js` | 扫码登录预加载 |
| `electron/qrcode-login.js` | 扫码登录模块 |
| `electron/oauth-manager.js` | OAuth 2.0 认证 |
| `electron/hotkeys.js` | 全局快捷键 |
| `electron/system-tray.js` | 系统托盘 + 最小化 + 告警闪烁 |
| `electron/video-uploader.js` | 视频分片上传 |
| `electron/content-aggregator-bridge.js` | 内容采集桥接 |
| `electron/api-platform-adapter.js` | HTTP API 发布 |
| `electron/callback-server.js` | 实时回调服务器 |
| `electron/url-collector.js` | URL 内容采集 |
| `electron/playwright-manager.js` | Playwright 浏览器管理 (重复引用) |
| `electron/task-queue.js` | 任务队列 (重复引用) |
| `electron/l2-test.js` | L2 测试 |
| `electron/l2-test-hook.js` | L2 测试钩子 |

### 2.2 electron/publishers/ (12平台 RPA)

| 文件 | 平台 |
|------|------|
| `electron/publishers/base-rpa-publisher.js` | 基类 (集成 SelectorEngine) |
| `electron/publishers/registry.js` | 平台注册中心 |
| `electron/publishers/account-manager.js` | 账号管理 |
| `electron/publishers/wechat-mp-rpa.js` | 微信公众号 |
| `electron/publishers/zhihu-rpa.js` | 知乎 |
| `electron/publishers/weibo-rpa.js` | 微博 |
| `electron/publishers/douyin-rpa.js` | 抖音 |
| `electron/publishers/xiaohongshu-rpa.js` | 小红书 |
| `electron/publishers/tencent-video-rpa.js` | 视频号 |
| `electron/publishers/kuaishou-rpa.js` | 快手 |
| `electron/publishers/toutiao-rpa.js` | 今日头条 |
| `electron/publishers/youtube-rpa.js` | YouTube |
| `electron/publishers/tiktok-rpa.js` | TikTok |
| `electron/publishers/bilibili-rpa.js` | B站 |
| `electron/publishers/baijiahao-rpa.js` | 百家号 |

### 2.3 src/ (Vue 前端)

| 文件 | 说明 |
|------|------|
| `src/index.html` | HTML 入口 |
| `src/main.js` | Vue 入口 |
| `src/App.vue` | 根组件 |
| `src/router/index.js` | 路由 |
| `src/api/publisher.js` | API 调用 |
| `src/styles/cohere-design-system.css` | 设计系统 |
| `src/views/Home.vue` | 首页 |
| `src/views/Publish.vue` | 发布页 |
| `src/views/Accounts.vue` | 账号管理 |
| `src/views/Comments.vue` | 评论管理 |
| `src/views/Dashboard.vue` | 数据看板 |
| `src/views/Collection.vue` | 内容采集 |
| `src/views/Monitor.vue` | 监控页 |
| `src/views/FirstRun.vue` | 首次运行引导 |
| `src/components/ArticleEditor.vue` | 文章编辑器 |

### 2.4 构建配置

| 文件 | 说明 |
|------|------|
| `apps/desktop/package.json` | electron-builder 配置 (v1.1.7) |
| `.playwright-browsers/` | Playwright Chromium 浏览器 (416MB) |
| `.playwright-browsers/chromium-1223/` | Chromium 1223 完整浏览器 |
| `.playwright-browsers/ffmpeg-1011/` | FFmpeg |
| `dist-electron/` | 构建产出目录 |

---

## 三、packages/rpa-engine (RPA 引擎)

### 3.1 src/

| 文件 | 说明 |
|------|------|
| `src/index.js` | 包入口 |
| `src/selector-engine.js` | 三层级选择器引擎 |
| `src/platform-selectors.js` | 12平台选择器配置 |
| `src/playwright-manager.js` | Playwright 浏览器管理 |
| `src/cookie-store.js` | Cookie 管理 |
| `src/python-bridge.js` | Python 桥接 |
| `src/api-platform-adapter.js` | API 平台适配器 |

### 3.2 src/publishers/

| 文件 | 说明 |
|------|------|
| `publishers/base-rpa-publisher.js` | 基类 (findElement + SelectorEngine) |
| `publishers/registry.js` | 12平台注册中心 |
| `publishers/account-manager.js` | 账号管理 |
| `publishers/api-mode-publisher.js` | API+RPA 混合发布 |
| `publishers/wechat-mp-rpa.js` | 微信公众号 |
| `publishers/zhihu-rpa.js` | 知乎 |
| `publishers/weibo-rpa.js` | 微博 |
| `publishers/douyin-rpa.js` | 抖音 |
| `publishers/xiaohongshu-rpa.js` | 小红书 |
| `publishers/tencent-video-rpa.js` | 视频号 |
| `publishers/kuaishou-rpa.js` | 快手 |
| `publishers/toutiao-rpa.js` | 今日头条 |
| `publishers/youtube-rpa.js` | YouTube |
| `publishers/tiktok-rpa.js` | TikTok |
| `publishers/bilibili-rpa.js` | B站 |
| `publishers/baijiahao-rpa.js` | 百家号 |
| `publishers/__tests__/manual-baijiahao.js` | 非Jest测试(已重命名) |

### 3.3 tests/

| 文件 | 测试数 | 说明 |
|------|--------|------|
| `tests/selector-engine.test.js` | 7 | 选择器引擎 |
| `tests/registry.test.js` | 5 | 12平台注册 |
| `tests/cookie-store.test.js` | 6 | Cookie管理 |
| `tests/manual-base-publisher.js` | — | 基类(非Jest) |
| `tests/jest.config.js` | — | Jest 配置 |
| `package.json` | — | v1.1.7 |

**rpa-engine 测试总计: 18个 Jest 测试**

---

## 四、packages/shared-utils (共享工具)

### 4.1 src/

| 文件 | 说明 |
|------|------|
| `src/index.js` | 包入口 |
| `src/logger.js` | 日志 |
| `src/task-queue.js` | 任务队列 |
| `src/scheduler.js` | 调度器 |
| `src/publish-history.js` | 发布历史 |
| `src/aggregator-bridge.js` | 聚合桥接 |
| `src/format-adapter.js` | 格式适配 |
| `src/sensitive-filter.js` | 敏感词过滤 |
| `src/data-sync.js` | 数据同步 |
| `src/platform-config.js` | 平台配置 |

### 4.2 src 子模块

| 文件 | 说明 |
|------|------|
| `src/cover-processor/index.js` | 封面处理 |
| `src/cover-processor/presets.js` | 封面预设 |
| `src/format-adapter/index.js` | 格式适配入口 |
| `src/format-adapter/rules.js` | 格式规则 |
| `src/format-adapter/formatters.js` | 格式化器 |
| `src/format-adapter/sanitize.js` | 清理 |

### 4.3 tests/

| 文件 | 测试数 | 说明 |
|------|--------|------|
| `tests/cover-processor.test.js` | 6 | 封面处理 |
| `tests/task-queue.test.js` | 12 | 任务队列 |
| `tests/format-adapter.test.js` | 7 | 格式适配 |
| `tests/aggregator-bridge.test.js` | 8 | 聚合桥接 |
| `tests/jest.config.js` | — | Jest 配置 |
| `package.json` | — | v1.1.7 |

**shared-utils 测试总计: 33个 Jest 测试**

---

## 五、packages/python-backend (Python 后端)

### 5.1 src/

| 文件 | 说明 |
|------|------|
| `src/server.py` | FastAPI 入口 |
| `src/rpa_bridge.py` | RPA 桥接 |
| `src/wechat_publisher.py` | 微信公众号发布 |
| `src/wechat_publisher/utils.py` | 工具函数 |
| `src/wechat_publisher/models.py` | 数据模型 |
| `src/wechat_publisher/exceptions.py` | 异常定义 |
| `src/wechat_publisher/client.py` | HTTP 客户端 |

### 5.2 src/multi_publish/ (核心库)

| 文件 | 说明 |
|------|------|
| `__init__.py` | 包入口 |
| `models.py` | 数据模型 |
| `crypto.py` | 加密模块 |
| `account_store.py` | 账号存储 |

### 5.3 src/multi_publish/core/

| 文件 | 说明 |
|------|------|
| `__init__.py` | 核心入口 |
| `task_queue.py` | 任务队列 |
| `task_scheduler.py` | 任务调度 |
| `query_worker.py` | 查询工作器 |
| `scheduler.py` | 调度器 |
| `publisher_manager.py` | 发布管理器 |
| `progress.py` | 进度追踪 |
| `downloader.py` | 下载器 |
| `data_sync.py` | 数据同步 |

### 5.4 src/multi_publish/publishers/

| 文件 | 说明 |
|------|------|
| `__init__.py` | 发布器入口 |
| `base.py` | 基类 |
| `wechat_mp.py` | 微信公众号 |

### 5.5 src/publishers/ (旧版)

| 文件 | 说明 |
|------|------|
| `rpa_wechat_mp.py` | 微信公众号 |
| `rpa_zhihu.py` | 知乎 |
| `rpa_weibo.py` | 微博 |
| `rpa_douyin.py` | 抖音 |
| `rpa_xiaohongshu.py` | 小红书 |

### 5.6 tests/

| 文件 | 说明 |
|------|------|
| `tests/conftest.py` | 测试配置 |
| `tests/test_query_worker.py` | 查询工作器测试 |
| `tests/test_downloader.py` | 下载器测试 |
| `tests/test_task_scheduler.py` | 调度器测试 |
| `tests/test_progress.py` | 进度测试 |
| `tests/test_data_sync.py` | 数据同步测试 |

---

## 六、config/ (配置)

| 文件 | 说明 |
|------|------|
| `config/config.yaml` | 主配置 |
| `config/platforms.yaml` | 平台配置 |

---

## 七、docs/ (文档)

| 文件 | 说明 |
|------|------|
| `docs/user-manual.md` | 用户手册 |
| `docs/integration-architecture.md` | 集成架构 |
| `docs/operations-launch-plan.md` | 运营启动计划 |
| `docs/pricing-strategy.md` | 定价策略 |
| `docs/roadmap-v1.1.0.md` | v1.1.0 路线图 |
| `docs/rpa-verification-report.md` | RPA 验证报告 |
| `docs/shared-auth-integration-plan.md` | 共享认证集成 |
| `docs/acquisition-plan.md` | 获客计划 |
| `docs/wechat-publisher-api.md` | 微信公众号 API |
| `docs/ui-prototype.html` | UI 原型 |
| `docs/ui-prototype-cohere.html` | UI 原型 (Cohere) |

---

## 八、.github/ (CI/CD)

| 文件 | 说明 |
|------|------|
| `.github/workflows/build.yml` | 构建 + Release 自动发布 |
| `.github/workflows/doc-gate.yml` | 文档门禁 |
| `.github/workflows/ci-failure-handler.yml` | CI 失败处理 |

---

## 九、其他

| 文件 | 说明 |
|------|------|
| `scripts/clean-old.sh` | 清理脚本 |
| `migrations/` | 数据库迁移 |
| `data/` | 数据目录 |
| `build/` | 构建辅助 |
| `standards/` | 代码规范 |
| `team-workflow/` | 团队工作流 |
| `.hermes/` | ~~Hermes 配置~~ **已于 2026-10-18 退役**（change: hermes-plans-retire）；原内容迁至 `openspec/changes/archive/2026-09-23-member-center-p1/` 并并入 `openspec/records/` 同名执行记录 |
| `task-summary-2026-06-03-shared-auth.md` | 任务摘要 |
| `test_api.py` | API 测试 (根目录) |
| `test_core.py` | 核心测试 (根目录) |
| `test_import.py` | 导入测试 (根目录) |

---

## 十、导出文件 (OpenCode 迁移用)

| 文件 | 大小 | 说明 |
|------|------|------|
| `PROJECT-003-FILE-INVENTORY.md` | — | 本文件，完整文件清单 |
| `PROJECT-003-MEMORY-EXPORT.md` | — | 全部记忆导出 (10大章节) |
| `opencode-memory-export.json` | 16.6KB | OpenCode JSON 格式 (session + message 表) |

---

## 十一、构建产出 (dist-electron/)

| 文件 | 大小 | 说明 |
|------|------|------|
| `dist-electron/Multi-Publish.Setup.1.1.7.exe` | 236MB | NSIS 安装包 (含浏览器) |
| `dist-electron/Multi-Publish.Setup.1.1.6.exe` | 103MB | 旧版安装包 (不含浏览器) |
| `dist-electron/Multi-Publish.Setup.1.0.7.exe` | — | 早期版本 |
| `dist-electron/win-unpacked/` | — | 解压版 (调试用) |
| `dist-electron/*.blockmap` | — | 自动更新差量包 |
| `dist-electron/latest.yml` | — | 自动更新配置 |
| `dist-electron/builder-effective-config.yaml` | — | 构建配置快照 |

---

## 十二、测试统计

| 包 | Jest 测试 | 手动测试 | 总计 |
|----|-----------|----------|------|
| rpa-engine | 18 | 1 | 19 |
| shared-utils | 33 | 0 | 33 |
| python-backend | 5 (pytest) | 0 | 5 |
| **总计** | **56** | **1** | **57** |

---

## 十三、依赖概览

### Electron (apps/desktop)
- Electron 33.4.0, electron-builder 25.1.8
- Vue 3.5.0, Vue Router 4.5.0, Pinia 2.3.0
- Element Plus 2.9.0, @vueup/vue-quill 1.5.3
- Playwright 1.52.0, better-sqlite3 12.10.0
- electron-updater 6.8.9, axios 1.9.0

### Python (python-backend)
- Python 3.12
- FastAPI + uvicorn
- Playwright (Python)
- SQLite

### Python (011 prompt-engine)
- Python >=3.11
- FastAPI, OpenAI SDK, httpx, ChromaDB, pydantic

### Python (012 smart-sentence-splitter)
- Python >=3.11
- pydantic, PyYAML (核心零依赖 300KB)
- jieba (可选), TextTiling
