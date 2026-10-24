# Multi-Publish

> 多平台内容一键发布桌面工具。支持 **15 个平台** RPA 自动化发布 + 多账号切换 + 分屏监控。
>
> **最后更新**: 2026-07-02 | **版本**: v2.0.0

---

一键发布文章到 **微信公众号、知乎、微博、抖音、小红书、视频号、快手、今日头条、百家号、YouTube、TikTok、B站**。支持同平台多账号同时发布。

## 📥 安装

| 方式 | 说明 |
|------|------|
| **GitHub 下载** | [GitHub Releases](https://github.com/Colinchiu007/Multi-Publish/releases) → 下载 `.exe` |
| **Gitee 国内镜像** | [Gitee Releases](https://gitee.com/ColinChiu007/Multi-Publish/releases) — 国内 5MB/s |
| **gh-proxy 加速** | `https://gh-proxy.com/https://github.com/Colinchiu007/Multi-Publish/releases/download/v1.1.0/Multi-Publish.Setup.1.1.0.exe` |
| **自动更新** | 打开 App 后自动检测新版本（electron-updater，GFW 静默） |
| **源码构建** | 见下方「开发」章节 |

> 💡 **国内用户推荐走 Gitee**，330MB 文件从 GitHub 下载可能 2 小时，Gitee 通常 1-2 分钟。

## 🚀 首次使用

1. 下载安装包并安装
2. 首次运行自动检测依赖
3. 点击「账号管理」→ 选择平台 → 扫码/登录 → Cookie 加密保存
4. 撰写文章 → 选择平台 + 选择账号 → 点击发布

## 🌐 支持平台（15 个）

| 平台 | 类型 | 技术路线 | 多账号 |
|------|------|----------|:------:|
| 微信公众号 | 图文 | RpaViewManager RPA | ✅ |
| 知乎 | 图文 | RpaViewManager RPA | ✅ |
| 微博 | 图文 | RpaViewManager RPA | ✅ |
| 抖音 | 图文 + 视频 | RpaViewManager RPA | ✅ |
| 小红书 | 图文 | RpaViewManager RPA | ✅ |
| 视频号 | 视频 + 图文 | RpaViewManager RPA | ✅ |
| 快手 | 视频 + 图文 | RpaViewManager RPA | ✅ |
| 今日头条 | 图文 + 视频 | RpaViewManager RPA | ✅ |
| 百家号 | 图文 | RpaViewManager RPA | ✅ |
| YouTube | 视频 | RpaViewManager RPA + OAuth 2.0 | ✅ |
| TikTok | 视频 | RpaViewManager RPA + OAuth 2.0 | ✅ |
| **B站** | **专栏 + 视频** | **API+RPA 双模式** | ✅ |

## ✨ 功能亮点

| 功能 | 说明 |
|------|------|
| **多账号管理** | 同平台多个账号，侧栏快捷切换，发布时精确选账号 |
| **多账号同时发** | 同平台选不同账号，一次发布到所有账号 |
| **分屏监控** | 2/3/4/6 分屏实时查看多平台内容 |
| **实时回调** | HTTP POST 回调（:16521），评论/数据自动记录 |
| **二维码扫码登录** | 微信生态平台自动检测二维码，3 策略识别 |
| **OAuth 2.0** | YouTube/TikTok/微博/抖音 API Token 授权 |
| **URL 内容采集** | 输入链接自动提取标题/正文/封面，创建草稿 |
| **批量发布** | 多篇文章批量编辑，每篇独立选平台+定时 |
| **任务队列** | 3 任务并发，失败自动重试，崩溃恢复 |
| **SQLite 存储** | 26 表统一存储，better-sqlite3 引擎 |
| **系统托盘** | 最小化到托盘，后台运行，托盘菜单 |
| **全局快捷键** | 6 组 Ctrl+Alt+... 导航快捷键 |
| **自动更新** | 启动自动检测新版本，后台下载静默安装 |

## 🏗️ 架构

```
┌──────────────────────────────────────────┐
│  apps/desktop/                    ← Electron 43 + Vue 3 UI
│  ├── electron/                ← 主进程
│  │   ├── main.js              ← 入口 + IPC 注册
│  │   ├── index.js             ← 进程入口
│  │   ├── bootstrap.js         ← 分阶段装配（phase1/phase4…）
│  │   ├── preload/             ← contextBridge 暴露面（32 个模块）
│  │   ├── services/            ← 业务服务（311 个模块）
│  │   ├── ipc-handlers/        ← IPC 通道（75 个模块）
│  │   ├── publishers/          ← 账号管理 / 登录检查
│  │   ├── core/                ← 容器装配
│  │   └── ...                  ← stealth / film-kit / startup 等
│  └── src/                     ← Vue 3 前端
│      ├── views/               ← Home/Dashboard/Publish/Accounts/Collection/Monitor/FirstRun
│      ├── features/            ← 按域拆分的业务组件（collection/dashboard/member…）
│      ├── components/          ← ArticleEditor
│      ├── api/                 ← IPC 封装
│      └── styles/              ← Cohere 设计系统
├──────────────────────────────────────────┤
│  packages/rpa-engine/         ← RpaViewManager RPA 引擎
│  │   ├── platform-selectors.js            ← 平台选择器
│  │   ├── publish-selectors-by-content-type.js
│  │   └── toutiao-direct-publish.js       ← 头条直发桥
│  packages/api-publish-engine/ ← API 发布轨（13 个平台适配器）
│  packages/rewrite-engine/     ← 改写引擎（去 AI 味 / 分句 / 质量评分）
│  packages/collection-engine/  ← 采集引擎
│  packages/shared-utils/       ← 平台元数据单一真源 + 任务队列
└──────────────────────────────────────────┘
```

> 平台元数据的**唯一真源**是
> `packages/shared-utils/src/platform-display-definitions.json`（`PLATFORM_NAMES`，**15 个**）
> 与 `config/platforms.yaml`（平台级配置，一级键即平台标识）。
> 架构与模块清单的完整真相见根目录 `AGENTS.md`。

Monorepo 结构，独立 npm workspace 管理。

## 🛠️ 开发

```bash
# 安装依赖
npm install

# 开发模式（Vue HMR + Electron）
npm run dev

# 构建 Windows 安装包
npm run build:win

# 仅构建目录（快速测试）
npm run build:dir

# 运行测试
npm test
```

### 项目结构

```
multi-publish/
├── apps/desktop/                # Electron 桌面应用
│   ├── electron/                # 35 个主进程模块
│   ├── src/                     # Vue 3 前端
│   └── package.json
├── packages/
│   ├── rpa-engine/              # RPA 引擎
│   ├── shared-utils/            # 共享工具
│   └── python-backend/          # FastAPI 后端
├── PRD.md                       # 产品需求文档
├── AGENTS.md                    # 开发流程规范
├── CHANGELOG.md                 # 变更日志
└── docs/                        # 文档目录
```

## 📊 功能列表

- ✅ **15 个平台发布**（含 B站 API+RPA）
- ✅ **多账号同平台**（切换 + 同时发布）
- ✅ **分屏监控**（2/3/4/6 分屏）
- ✅ **实时回调**（HTTP POST 回调 :16521）
- ✅ **扫码登录**（3 策略）
- ✅ **OAuth 2.0**（YouTube/TikTok）
- ✅ **URL 内容采集**（自动提取）
- ✅ **批量编辑/排期/复制**
- ✅ **定时发布**（持久化 + 崩溃恢复）
- ✅ **并发 3 任务** + 自动重试
- ✅ **发布后状态监控**
- ✅ **SQLite 统一存储**
- ✅ **系统托盘** + **全局快捷键**
- ✅ **自动更新**（GitHub Release）
- ✅ **Cookie AES-256-GCM 加密**

## 📄 文档

| 文档 | 说明 |
|------|------|
| [PRD.md](PRD.md) | 产品需求文档（完整功能架构 + 验收标准） |
| [AGENTS.md](AGENTS.md) | 开发流程规范（7 阶段 + 质量门禁） |
| [CHANGELOG.md](CHANGELOG.md) | 变更日志 |
| [docs/roadmap-v1.1.0.md](01-docs/roadmap-v1.1.0.md) | v1.1.0 路线图 |
| [docs/pricing-strategy.md](01-docs/pricing-strategy.md) | 定价策略 |
| [docs/user-manual.md](01-docs/user-manual.md) | 用户手册 |
| [docs/rpa-verification-report.md](01-docs/rpa-verification-report.md) | RPA 验证报告 |

### 🎯 商业化发布方案（v1.0 · 2026-07-26）

| 文档 | 说明 |
|------|------|
| [PRODUCT-POSITIONING.md](PRODUCT-POSITIONING.md) | **产品定位方案** — 一句话定位、品牌升级、Slogan 矩阵、三层用户分层、价值主张、竞争定位图、定位声明、品牌故事 |
| [MARKETING-HANDBOOK.md](MARKETING-HANDBOOK.md) | **产品营销手册** — OKR、FAB 卖点矩阵、6 类话术库、三层订阅价格、冷启动优惠、6 大渠道 CAC、AARRR 漏斗、内容营销 3 月节奏 |
| [WEBSITE-PLAN.md](WEBSITE-PLAN.md) | **官网完整方案** — 信息架构、视觉设计系统、首页 14 区块完整文案、6 大子页面框架、Next.js 技术栈、SEO 策略、6 周开发路线图 |

> 三份文档构成商业化发布的完整方案基准，所有对外沟通（官网、营销、销售、媒体）以此为准。

## 📝 发布流程

CI 自动处理版本号和 Release（GitHub Actions）：

```bash
# 1. push 代码到 main
git push origin main
# → CI 自动构建 → bump patch → tag → Release
```

手动发版：

```bash
git tag v1.0.14
git push origin v1.0.14
# → CI 自动构建并发布到 GitHub Releases
```

## 📄 License

MIT
