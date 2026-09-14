# Multi-Publish — API 引擎功能清单 & PRD 补充

> **生成日期**: 2026-07-03  
> **版本**: v1.0.0  
> **范围**: api-engine (https://github.com/Colinchiu007/Multi-Publish)

---

## 一、API 发布引擎功能列表 (v1.0.0)

### 1.1 核心模块

| 模块 | 文件 | 说明 | 测试数 | 状态 |
|------|------|------|--------|------|
| PublishApiServer | api-server.js | HTTP API 服务层 (零外部依赖) | 8/8 | 已发布 |
| PublishApiClient | api-client.js | SDK 客户端 | - | 已发布 |
| CLI 入口 | cli.js | publish-api 命令行启动 | 4/4 | 已发布 |
| BatchPublish | batch-publish.js | 多平台批量发布 | 17/17 | 已发布 |
| ScheduledPublish | scheduled-publish.js | 定时发布 | 24/24 | 已发布 |
| API Key Auth | api-key-auth.js | 访问控制 | 6/6 | 已发布 |
| RateLimiter | rate-limiter.js | 滑动窗口频率限制 | - | 已发布 |
| AccessLogger | access-logger.js | 请求日志拦截 | - | 已发布 |
| Graceful Shutdown | graceful-shutdown.js | 优雅关闭 | - | 已发布 |
| Metrics | metrics.js | 服务器状态聚合 | - | 已发布 |
| WebhookManager | webhook.js | Webhook 通知回调 | - | 已发布 |
| AuditLog | audit-log.js | 发布日志审计 | - | 已发布 |
| PublishingPlan | publishing-plan.js | 发布计划排期 | - | 已发布 |
| API Docs | docs/api-docs.js | API 文档页 + OpenAPI JSON | - | 已发布 |

### 1.2 API 端点清单

| 方法 | 路径 | 说明 | 认证 | 状态 |
|------|------|------|------|------|
| POST | /api/v1/publish | 发布内容到单平台 | API Key | 已发布 |
| POST | /api/v1/publish/batch | 多平台批量发布 | API Key | 已发布 |
| GET | /api/v1/publish/:id | 查询发布状态 | API Key | 已发布 |
| POST | /api/v1/schedule | 创建定时发布 | API Key | 已发布 |
| GET | /api/v1/schedule | 列出定时任务 | API Key | 已发布 |
| DELETE | /api/v1/schedule/:id | 删除定时任务 | API Key | 已发布 |
| POST | /api/v1/plan | 创建发布计划 | API Key | 已发布 |
| GET | /api/v1/plan | 列出发布计划 | API Key | 已发布 |
| POST | /api/v1/plan/:id/exec | 执行发布计划 | API Key | 已发布 |
| DELETE | /api/v1/plan/:id | 删除发布计划 | API Key | 已发布 |
| POST | /api/v1/webhook | 创建 Webhook | API Key | 已发布 |
| GET | /api/v1/webhook | 列出 Webhook | API Key | 已发布 |
| DELETE | /api/v1/webhook/:id | 删除 Webhook | API Key | 已发布 |
| GET | /api/v1/logs | 查询审计日志 | API Key | 已发布 |
| GET | /api/v1/metrics | 服务器状态 | API Key | 已发布 |
| GET | /api/v1/docs | API 文档页 | 无 | 已发布 |
| GET | /openapi.json | OpenAPI 规范 | 无 | 已发布 |

### 1.3 上传引擎 (三层架构)

| 层 | 适配器数 | 说明 |
|----|---------|------|
| COS 上传器 | 3 平台 | 小红书、视频号、知乎 |
| OSS 上传器 | 13 平台 | 抖音、B站、微博、快手、头条号、公众号等 |
| HTTP 上传器 | 13 平台 | 得物、一点号、爱奇艺号、大鱼号、企鹅号、搜狐号等 |
| **合计** | **29 平台** | |

### 1.4 平台适配器状态 (29 平台)

| 平台 | 上传方式 | 签名 | RPA 降级 | 状态 |
|------|---------|------|---------|------|
| 公众号 | OSS | 本地 | - | 已发布 |
| 知乎 | COS | 本地 | - | 已发布 |
| 小红书 | COS | 本地 | - | 已发布 |
| 视频号 | COS+XML | 本地 | - | 已发布 |
| 抖音 | OSS | 远程 | 支持 | 已发布 |
| B站 | OSS | 本地 | 支持 | 已发布 |
| 微博 | OSS | 本地 | 支持 | 已发布 |
| 快手 | OSS | 远程 | 支持 | 已发布 |
| 头条号 | OSS | 本地 | 支持 | 已发布 |
| 百家号 | OSS | 本地 | 支持 | 已发布 |
| 小红书(API) | HTTP | - | - | 已发布 |
| 大鱼号 | OSS | 本地 | 支持 | 已发布 |
| 爱奇艺号 | OSS | 本地 | 支持 | 已发布 |
| 企鹅号 | OSS | 本地 | 支持 | 已发布 |
| 搜狐号 | HTTP | - | - | 已发布 |
| 网易号 | HTTP | - | - | 已发布 |
| 一点号 | OSS | 本地 | 支持 | 已发布 |
| 搜狐视频 | HTTP | - | - | 已发布 |
| 乐乎 | HTTP | - | - | 已发布 |
| 简书 | HTTP | - | - | 已发布 |
| 币乎 | HTTP | - | - | 已发布 |
| CSDN | HTTP | - | - | 已发布 |
| 豆瓣 | HTTP | - | - | 已发布 |
| 知乎(专栏) | HTTP | - | - | 已发布 |
| 掘金 | HTTP | - | - | 已发布 |
| 得到 | HTTP | - | - | 已发布 |
| 人人都是产品经理 | HTTP | - | - | 已发布 |
| 鸟哥笔记 | HTTP | - | - | 已发布 |
| 运营派 | HTTP | - | - | 已发布 |

### 1.5 辅助模块

| 模块 | 说明 | 测试数 | 状态 |
|------|------|--------|------|
| UploadOrchestrator | 上传编排引擎 + 自动降级 | 63/63 | 已发布 |
| ContentFormatter | 29 平台标签风格/截断规则 + base-adapter | 34/34 | 已发布 |
| AntiDetect | 反检测模块 (随机UA/延迟/Header随机化) | 10/10 | 已发布 |
| SignerLocal | 本地签名算法 | 16/16 | 已发布 |
| XMLBuilder | 视频号 XML 构建器 | 10/10 | 已发布 |
| TokenAcquirer | COS/OSS Token 统一获取 + 缓存 | - | 已发布 |
| RichTextProcessor | 富文本处理器 (@提及中文支持修复) | 8/8 | 已发布 |
| CommentMessageService | 评论自动回复 (参考产品复用) | 8/8 | 已发布 |
| ProxyManager | 代理管理 | - | 已发布 |
| TaskPool | 任务池 | - | 已发布 |
| ErrorCodes | 统一错误码 (12 个) | 12/12 | 已发布 |
| CancelToken | 取消令牌 | 8/8 | 已发布 |
| ProgressEmitter | 进度上报 | 6/6 | 已发布 |
| ConfigLoader | 配置文件支持 | - | 已发布 |
| GzipCompression | gzip 压缩 | - | 已发布 |
| Docker 容器化 | Dockerfile + docker-compose + CLI 环境变量 | - | 已发布 |

### 1.6 从参考产品复用的代码

| 模块 | 来源 | 适配内容 |
|------|------|---------|
| 本地签名算法 | 参考产品 Signer | B站/微博/头条号本地签名 |
| COS 上传引擎 | 参考产品 COSUploader | 小红书/视频号/知乎 COS 上传 |
| 远程签名集成 | 参考产品 RemoteSigner | 抖音/快手远程签名 |
| OSS 上传器 | 参考产品 OSSUploader | 多平台 OSS 上传 |
| XML 构建器 | 参考产品 XMLBuilder | 视频号发布 XML 构建 |
| 评论回复服务 | 参考产品 CommentService | Echo/Template 回复生成器 |

---

## 二、架构决策记录

| ADR # | 决策 | 理由 |
|-------|------|------|
| ADR-001 | 三层上传引擎 (COS/OSS/HTTP) | 适配不同平台的上传协议 |
| ADR-002 | 纯 Node.js + 零外部依赖 | 降低部署复杂度 |
| ADR-003 | 滑动窗口频率限制 | 比令牌桶更精确控制速率 |
| ADR-004 | SQLite 持久化 (定时/计划/Webhook) | 无需额外数据库 |
| ADR-005 | API Key 认证 | 比 JWT 更适用于机器间通信 |

---

## 三、发布质量指标

| 指标 | 当前值 |
|------|--------|
| 模块数 | 16 核心模块 + 6 辅助模块 |
| 平台覆盖 | 29 平台 |
| TDD 测试总数 | 260+ (包含单元测试) |
| 零外部依赖 | 是 |
| 容器化 | Docker + docker-compose |
| API 认证 | API Key |
| 日志能力 | Audit Log + Access Log |
| 部署方式 | CLI + Docker |
