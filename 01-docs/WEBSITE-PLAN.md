# 官网完整方案 v1.0

> Multi-Publish 官方官网建设方案
> 覆盖信息架构、页面结构、完整文案、视觉设计、技术架构、SEO 策略
> 文档日期：2026-07-26

---

## 0. 文档目的

本文档定义 Multi-Publish 官网的**完整建设方案**，作为官网开发、设计、内容生产的统一基准。

**配套文档**：
- [PRODUCT-POSITIONING.md](PRODUCT-POSITIONING.md) — 产品定位基准
- [MARKETING-HANDBOOK.md](MARKETING-HANDBOOK.md) — 营销话术与卖点
- [WEBSITE-DESIGN-COHERE.md](WEBSITE-DESIGN-COHERE.md) — **官网 Cohere 风格视觉设计规范（当前官网设计唯一基准）**
- [website-home-cohere.html](website-home-cohere.html) — 首页 HTML/CSS/JS 可交互原型
- [DESIGN.md](DESIGN.md) — 桌面应用设计规范（官网可参考）

---

## 1. 官网目标与定位

| 维度 | 定义 |
|------|------|
| **首要目标** | 转化下载（免费版）+ GitHub Star（开源飞轮） |
| **次要目标** | Pro 试用转化 + B 端企业线索 |
| **第三目标** | SEO 流量 + 文档入口 + 品牌建设 |
| **核心受众** | 自媒体运营者（Tier 1）+ 开发者（开源传播者） |
| **品牌调性** | 极客 · 开源 · AI · 可信赖 |
| **官网域名** | 建议 `multi-publish.dev` 或 `multipublish.io`（开发者调性） |

---

## 2. 信息架构（Sitemap）

```
🏠 首页（/）
│
├── 📦 产品（/product）
│   ├── 功能总览（/features）
│   ├── 15 平台（/platforms）
│   ├── AI 能力（/ai）— 50+ Provider + 写稿 + 爆款分析
│   ├── 视频创作（/video）— 13 Pipeline + Remotion
│   ├── 多账号管理（/accounts）
│   └── 分屏监控（/monitor）
│
├── 💰 价格（/pricing）— 三层订阅 + 冷启动优惠
│
├── ⚔️ 竞品对比（/compare）— vs 参考产品/融媒宝/Buffer
│
├── 🏢 企业版（/enterprise）— 私有部署 + API + SLA
│
├── 📚 资源（/resources）
│   ├── 博客（/blog）— 30 篇深度内容
│   ├── 文档（/docs）— 快速开始 + 用户手册 + API
│   ├── 教程（/tutorials）— 视频教程系列
│   ├── 更新日志（/changelog）— 版本演进
│   └── 路线图（/roadmap）— 未来规划
│
├── 🔓 开源（/open-source）
│   ├── GitHub 仓库（外链）
│   ├── 贡献指南（/contributing）
│   ├── 插件开发（/plugins）
│   └── 安全披露（/security）
│
├── ℹ️ 关于（/about）— 团队 + 故事
│
└── ⬇️ 下载（/download）— Windows / Linux / macOS
```

### 页面优先级与开发节奏

| 优先级 | 页面 | 上线时间 |
|:------:|------|:--------:|
| **P0** | 首页 / 下载 / 价格 / GitHub README | Week 1 |
| **P0** | 功能总览 / 平台矩阵 | Week 2 |
| **P1** | 竞品对比 / 博客（首 5 篇）/ 文档首页 | Week 3 |
| **P1** | AI 能力 / 视频创作 / 企业版 | Week 4 |
| **P2** | 教程 / 更新日志 / 路线图 / 关于 | Week 5-6 |

---

## 3. 视觉设计系统

> **⚠️ 设计基准已更新**：本章节下方的旧版视觉系统（深色模式优先、紫蓝渐变）已被 [WEBSITE-DESIGN-COHERE.md](WEBSITE-DESIGN-COHERE.md) 的 **Cohere 风格规范** 替代。官网实现请以 Cohere 风格规范为唯一设计基准，原型参考 [website-home-cohere.html](website-home-cohere.html)。

### 3.1 设计调性

> **极客 + 开源 + AI 科技感** — 类似 Linear / Vercel / Resend 的现代极简风，但加入"开源社区"温度

### 3.2 色彩系统

```yaml
主色调（深色模式优先）:
  background_primary: "#0A0E1A"      # 深空蓝黑
  background_secondary: "#111827"     # 卡片背景
  background_tertiary: "#1F2937"      # 悬浮态
  border: "#374151"                   # 分割线

主品牌色（科技紫蓝渐变）:
  brand_primary: "#7C3AED"            # 紫色（主）
  brand_secondary: "#3B82F6"          # 蓝色（辅）
  brand_gradient: "linear-gradient(135deg, #7C3AED 0%, #3B82F6 100%)"
  brand_glow: "rgba(124, 58, 237, 0.4)"  # 光晕效果

功能色:
  success: "#10B981"                  # 绿色（成功/开源）
  warning: "#F59E0B"                  # 橙色（警示/限时）
  danger: "#EF4444"                   # 红色（错误/降级）

文字色:
  text_primary: "#F9FAFB"             # 主文字
  text_secondary: "#9CA3AF"           # 次要文字
  text_tertiary: "#6B7280"            # 辅助说明

浅色模式（自动切换）:
  background_primary: "#FFFFFF"
  background_secondary: "#F9FAFB"
  text_primary: "#111827"
  # 其余镜像反转
```

### 3.3 字体系统

```yaml
英文字体:
  primary: "Inter"                    # 全站默认
  mono: "JetBrains Mono"              # 代码、技术细节

中文字体:
  primary: "思源黑体 / Noto Sans SC"   # 中文默认
  display: "思源黑体 Heavy"           # 大标题

字号阶梯（响应式）:
  display_hero: "72px / 1.1 / -0.04em"   # 首屏主标题
  display_h1: "48px / 1.2 / -0.02em"     # 页面 H1
  display_h2: "36px / 1.3"               # 区块 H2
  display_h3: "24px / 1.4"               # 卡片标题
  body_large: "18px / 1.6"               # 正文大
  body: "16px / 1.6"                     # 正文
  small: "14px / 1.5"                    # 辅助文字
  code: "14px / 1.6"                     # 代码
```

### 3.4 布局与间距

```yaml
容器宽度:
  max_width: "1280px"                 # 主容器
  content_width: "720px"              # 文字内容（博客）

栅格:
  columns: 12
  gutter: "24px"

间距系统（8px 基准）:
  xs: 8px
  sm: 16px
  md: 24px
  lg: 32px
  xl: 48px
  2xl: 64px
  3xl: 96px

圆角:
  card: "12px"
  button: "8px"
  pill: "9999px"                      # 胶囊按钮
```

### 3.5 动效原则

- **进入动效**：滚动到视口时元素淡入 + 上移（200ms ease-out）
- **悬浮反馈**：卡片悬浮上移 4px + 阴影加深 + 边框变亮
- **CTA 强调**：主按钮渐变光晕呼吸效果
- **数字滚动**：Hero 区数字增长动画（GitHub Star / 平台数）
- **平台 logo**：滚动横向 marquee，无限循环
- **AI 元素**：紫色粒子流动背景（首屏 Hero）

---

## 4. 首页完整文案与结构

### 4.1 顶部导航栏

```
[Logo] Multi-Publish          产品  ▾  价格  竞品对比  企业版  文档  博客    [GitHub ⭐ 1.2k]  [免费下载]
```

- Logo 左固定，CTA 右固定
- 滚动时背景毛玻璃化 + 阴影
- GitHub Star 按钮实时显示星数

### 4.2 Hero 首屏（核心转化区）

**布局**：左文右图（桌面），上下堆叠（移动）

**左侧文案**：

```
[徽章] 🔓 MIT 开源 · v2.4.0 已发布

# From Idea to Everywhere
## 开源 AI 内容工作站 · 一份内容，触达全网

15+ 平台一键发布 · 50+ AI 服务商 · 13 视频创作管线
Cookie 本地 AES-256-GCM 加密 · 可离线运行 · ¥39/月起

[免费下载] [查看 GitHub]
✓ 永久免费版 ✓ 无需信用卡 ✓ Windows / Linux / macOS

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 15+ 平台   🤖 50+ AI   🎬 13 视频管线   ⭐ 1.2k Star
```

**右侧视觉**：产品界面 3D 倾斜展示（15 平台矩阵 + 分屏监控 + AI 写稿面板组合截图），紫色光晕背景

### 4.3 信任徽章区

```
已被这些团队选择 ──────
[Logo1] [Logo2] [Logo3] [Logo4] [Logo5] [Logo6]
（早期用户/MCN 客户 logo 滚动展示）
```

### 4.4 痛点共鸣区

```
## 还在这样发内容吗？

[图标] 😩 5 个平台手动切换，一篇内容发 2 小时
[图标] 💸 参考产品 ¥49/月只支持 5-7 平台，融媒宝 ¥99/月无 AI
[图标] 🔒 Cookie 上云担心被盗号，但又找不到本地方案
[图标] 🎬 想做视频但不会剪辑，外包太贵自己学太慢
[图标] 🌙 定时发布要值夜班，批量操作要复制粘贴
[图标] 🤖 AI 工具散落十几个订阅，每月开销 ¥500+

## 是时候换个方式了。
```

### 4.5 核心功能展示区（6 大卡片）

```
## 一个工作站，搞定内容创作全链路

从采集到发布，从图文到视频，从单平台到全网——你只需要 Multi-Publish。

┌─────────────────────┐  ┌─────────────────────┐
│ 🚀 15 平台一键发布    │  │ 🤖 50+ AI 服务商     │
│ 微信/抖音/B站/小红书  │  │ OpenAI/Claude/Gemini │
│ 知乎/微博/视频号...   │  │ DeepSeek/Doubao...   │
│                     │  │                     │
│ API+RPA 双模式       │  │ 标题/标签/爆款分析    │
│ 自动降级，稳定性 99%+ │  │ AI 写稿全免费        │
│ [查看平台矩阵 →]     │  │ [了解 AI 能力 →]     │
└─────────────────────┘  └─────────────────────┘

┌─────────────────────┐  ┌─────────────────────┐
│ 🎬 13 视频创作管线   │  │ 🔒 Cookie 本地加密   │
│ Remotion + Story2Video│  │ AES-256-GCM 加密     │
│ 真实 ffmpeg 合成      │  │ 永不上云，可离线     │
│ 不学剪辑也能做视频    │  │ 账号安全 + 合规      │
│ [观看视频样片 →]     │  │ [查看安全设计 →]     │
└─────────────────────┘  └─────────────────────┘

┌─────────────────────┐  ┌─────────────────────┐
│ 👥 多账号矩阵管理    │  │ 📊 分屏监控 + 回调   │
│ 同平台多账号同时发   │  │ 2/3/4/6 分屏布局     │
│ 团队共享账号池       │  │ HTTP 回调实时入库    │
│ 矩阵号运营神器       │  │ 数据及时响应         │
│ [查看矩阵玩法 →]     │  │ [体验监控能力 →]     │
└─────────────────────┘  └─────────────────────┘
```

### 4.6 平台矩阵展示区

```
## 支持 15+ 平台，覆盖国内外主流渠道

国内：微信公众号 · 知乎 · 微博 · 抖音 · 小红书 · 视频号 · 快手 · 今日头条 · 百家号 · B站
海外：YouTube · TikTok · Twitter/X · Instagram · Facebook

✓ RPA+API 双模式   ✓ 多账号支持   ✓ 同平台同时发   ✓ 登录状态自动检测
```

### 4.7 AI 能力展示区

```
## 50+ AI 服务商，一个工作站全搞定

LLM 文字：OpenAI · Anthropic · Gemini · DeepSeek · Doubao · Ollama · OpenRouter
TTS 语音：ElevenLabs · OpenAI · Google · Doubao · MiniMax
STT 识别：OpenAI Whisper · Baidu · Google · 本地 Whisper
图像生成：Flux · DALL-E · Imagen · Recraft · ComfyUI
视频生成：Hunyuan · Kling · Runway · VEO · WAN · CogVideo · HeyGen

✓ 你只需配置自己的 API Key   ✓ 我们不加价   ✓ 对比 OpenAI Plus 省 75%
```

### 4.8 视频创作展示区

```
## 不学剪辑，也能做出爆款视频

13 种视频创作 Pipeline + Remotion 13 Composition + Story2Video 文本转视频。

🎬 Story2Video：文本 → 字幕 + BGM + 转场 + 水印，真实 ffmpeg 合成
🎬 Avatar 数字人：HeyGen + 11Labs，文本 → 数字人口播视频
🎬 Explainer 解释器：自动生成动画科普视频
🎬 Talking Head：图片 + 文本 → 会说话的头部视频
```

### 4.9 安全与开源区（核心差异化）

```
## 🔓 开源 MIT · Cookie 本地加密 · 可离线运行

┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ 🔓 MIT 开源       │  │ 🔒 AES-256-GCM   │  │ 🌐 可离线运行     │
│ 代码全部在 GitHub │  │ Cookie 本地加密   │  │ 无网络也能用      │
│ 可审计可二次开发   │  │ 永不上云          │  │ 桌面应用常驻      │
└──────────────────┘  └──────────────────┘  └──────────────────┘

✓ 5720+ 单元测试    ✓ 94 视觉回归测试    ✓ 5 道质量门禁
✓ Stryker 变异测试  ✓ 故障注入测试       ✓ Monkey 随机测试
```

### 4.10 竞品对比区

```
## 为什么选 Multi-Publish，而不是参考产品/融媒宝？

| 维度          | Multi-Publish  | 参考产品         | 融媒宝         |
|---------------|:--------------:|:--------------:|:--------------:|
| 价格          | **¥39/月**     | ¥49/月         | ¥99/月起       |
| 平台数        | **15+**        | 5-7            | 40+            |
| 发布模式      | **API+RPA 双** | 纯 RPA         | 纯 RPA         |
| AI 增强       | **✅ 50+ Provider** | ❌         | ❌             |
| 视频创作      | **✅ 13 Pipeline**  | ❌         | ❌             |
| 开源          | **✅ MIT**      | ❌ 闭源        | ❌ 闭源        |
| 离线          | **✅ 本地加密** | ❌ 上云        | ❌ 上云        |
| 海外平台      | **✅ YT/TikTok/IG/FB/X** | ❌  | ❌             |
```

### 4.11 价格区

```
## 选择适合你的版本

┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  免费版       │  │  Pro 版 ⭐    │  │  企业版       │
│  ¥0/月       │  │  ¥39/月      │  │  ¥199/月     │
│  永久免费     │  │  或 ¥299/年  │  │  或 ¥1999/年 │
│              │  │  省 36%      │  │              │
│ ✓ 3 平台     │  │ ✓ 15+ 平台   │  │ ✓ Pro 全部   │
│ ✓ 每日 5 篇  │  │ ✓ 全部 AI    │  │ ✓ 多账号     │
│ ✓ 基础 AI    │  │ ✓ 视频创作   │  │ ✓ API 接入   │
│ ✓ 本地加密   │  │ ✓ 定时批量   │  │ ✓ 团队协作   │
│              │  │ ✓ 统计看板   │  │ ✓ SLA 支持   │
│              │  │              │  │ ✓ 私有部署   │
│ [免费下载]   │  │ [7 天试用]  │  │ [预约演示]   │
└──────────────┘  └──────────────┘  └──────────────┘

🔥 前 200 名 Pro 年付 ¥99（原价 ¥299）终身锁定 — 限时早鸟价
```

### 4.12 用户证言区

```
## 听听早期用户怎么说

👤 "5 个平台手动切换要 2 小时，现在 15 平台一键发，省下时间做内容。"
   — 张某某，某 MCN 运营负责人

👤 "开源 + Cookie 本地加密，这点碾压所有闭源工具。我们团队合规要求高，这是唯一选择。"
   — 李某某，某企业内容总监

👤 "AI 写稿 + 视频创作全免费，对比我之前每月花 ¥500+ 订阅各种 AI 工具，省太多了。"
   — 王某某，自媒体博主
```

### 4.13 CTA 行动召唤区

```
## 还在等什么？现在就开始你的内容工厂

[免费下载]   [查看 GitHub]   [预约企业演示]

MIT 开源 · 5720+ 测试 · 15+ 平台 · 50+ AI · ¥39/月起
```

### 4.14 页脚 Footer

```
Multi-Publish              产品              资源
From Idea to Everywhere    功能总览           博客
开源 AI 内容工作站          15 平台矩阵        文档
                           AI 能力            教程
                           视频创作            更新日志
                           多账号管理          路线图
                           分屏监控
                                           开源
                           公司              GitHub 仓库
                           价格              贡献指南
                           竞品对比           插件开发
                           企业版            安全披露
                           关于我们
                                           社区
                           下载              Discord
                           Windows           微信群
                           Linux             即刻
                           macOS             V2EX

© 2026 Multi-Publish · MIT License · GitHub ⭐ 1.2k
```

---

## 5. 关键子页面文案框架

### 5.1 价格页（/pricing）

**核心结构**：Hero + 三层价格卡 + 功能对比表 + FAQ + CTA

**Hero 文案**：
```
# 透明定价，性价比之王
## 比参考产品便宜 20%，比融媒宝便宜 60%，AI + 视频全免费
```

**FAQ 核心问题**：
- Q: 免费版能用多久？— 永久免费，3 平台 + 每日 5 篇 + 基础 AI 写稿
- Q: Pro 版 7 天试用需要信用卡吗？— 不需要，试用结束自动降级
- Q: AI 服务需要单独付费吗？— Pro 版含全部 50+ AI Provider，只需配置 API Key
- Q: 企业版支持私有部署吗？— 支持，Docker + Logto OIDC + Nginx 反代
- Q: 前 200 名早鸟价？— Pro 年付 ¥99（原价 ¥299）终身锁定
- Q: 支持退款吗？— 30 天无理由退款

### 5.2 功能总览页（/features）

**核心结构**：Hero + 6 大功能区 + 技术架构图 + CTA

**Hero 文案**：
```
# 一个工作站，搞定内容创作全链路
## 采集 → 改写 → 视频 → 多发 → 监控 — 全部一站式
```

**6 大功能区**（每区含功能截图 + 价值描述 + 技术亮点）：
1. 🚀 多平台发布 — 15+ 平台 + API+RPA 双模式 + 自动降级
2. 🤖 AI 能力 — 50+ Provider + LLM/TTS/STT/图像/视频
3. 🎬 视频创作 — 13 Pipeline + Remotion + Story2Video
4. 🔒 安全与隐私 — AES-256-GCM + 本地加密 + 离线
5. 👥 多账号管理 — 同平台多账号 + 团队共享 + 30 分钟检测
6. 📊 监控与数据 — 2/3/4/6 分屏 + HTTP 回调 + 实时入库

### 5.3 竞品对比页（/compare）

**核心结构**：Hero + 三方对比表 + 5 大差异化详解 + 用户故事 + CTA

**Hero 文案**：
```
# Multi-Publish vs 参考产品 vs 融媒宝
## 同样的功能，我们便宜 20-60%；同样的价格，我们多 70% 平台
```

**5 大核心差异**：
1. 开源 vs 闭源 — MIT 开源 vs 闭源黑箱
2. API+RPA 双模式 vs 纯 RPA — 自动降级 vs 平台封禁即失效
3. AI 增强 vs 无 AI — 50+ Provider + 13 视频管线 vs 无
4. 15+ 平台 vs 5-7 平台 — 含海外 vs 仅国内
5. ¥39/月 vs ¥49-99/月 — 早鸟 ¥99 终身锁定

### 5.4 企业版页（/enterprise）

**核心结构**：Hero + 企业痛点 + 解决方案 + 技术架构 + 客户案例 + 联系销售

**Hero 文案**：
```
# 企业级内容分发平台
## 开源可私有部署 · API 接入内部系统 · 团队协作 · SLA 支持
```

**企业版 4 大能力**：
1. 🔒 合规与安全 — MIT 开源 + AES-256-GCM + Logto OIDC + Docker 私有部署
2. 🔌 API 接入 — HTTP API + 异步队列 + Nginx 反代 + Webhook 事务消费
3. 👥 团队协作 — 多账号共享 + 权限管理 + 数据看板 + 审批流
4. 🛡️ SLA 支持 — 优先修复 + 专属支持 + 定制开发 + 培训指导

### 5.5 文档页（/docs）

**核心结构**：左侧导航 + 右侧内容（GitBook 风格）

**文档结构**：
- 🚀 快速开始（5 分钟上手 / 第一个平台登录 / 首篇内容发布 / 安装卸载）
- 📖 用户手册（账号管理 / 内容发布 / AI 写稿 / 视频创作 / 多账号 / 监控 / 托盘 / 插件）
- 🔧 配置指南（AI Provider / OAuth 2.0 / Logto / Docker / Nginx）
- 🔌 API 文档（REST API / Webhook / 插件开发 / Pipeline 编排）
- 🛠️ 开发者（架构设计 / Monorepo / 测试策略 / 贡献指南 / 安全披露）
- ❓ 常见问题（安装 / 平台登录 / 发布失败 / AI 配置）

### 5.6 博客页（/blog）

**首 5 篇种子内容**：
1. 《为什么我们选择 API+RPA 双模式发布》— 技术深度 + 竞品对比
2. 《开源 MIT 协议意味着什么：从参考产品闭源说起》— 价值观输出 + 差异化
3. 《5 分钟用 Multi-Publish 发 15 平台：手把手教程》— 教程型 + SEO 长尾
4. 《AI 写稿 + 视频创作全免费，我们怎么做到的？》— 商业模式解释
5. 《Cookie 本地 AES-256-GCM 加密：我们的安全设计》— 安全合规 + B 端关键

---

## 6. 技术架构建议

### 6.1 推荐技术栈

```yaml
框架: Next.js 14+ (App Router)
  理由: SSG 静态生成 + ISR 增量静态再生成 + 边缘渲染
  备选: Astro (更轻量，纯静态优先)

样式: Tailwind CSS 3+
  理由: 设计系统 + 响应式 + 暗色模式原生支持

动效: Framer Motion
  理由: 滚动动效 + 进入动画 + 微交互

组件库: shadcn/ui (基于 Radix)
  理由: 可定制 + 无运行时 + 可访问性

图标: Lucide React + 平台官方 logo SVG

字体: next/font (Inter + Noto Sans SC)
  理由: 自动优化 + 零 CLS

内容: MDX (博客 + 文档)
  理由: Markdown + React 组件混合

搜索: Algolia DocSearch (文档) / Flexsearch (轻量)

分析: Plausible (隐私友好) 或 Vercel Analytics

部署: Vercel
  理由: 边缘 CDN + 自动 HTTPS + 预览部署

CMS: Git-based (本地 MDX 文件)
  理由: 版本控制 + 无需额外服务 + 开发者友好
```

### 6.2 性能与 SEO 目标

```yaml
核心 Web 指标:
  LCP: < 1.5s       # 最大内容绘制
  FID: < 100ms      # 首次输入延迟
  CLS: < 0.1        # 累积布局偏移
  TTFB: < 200ms     # 首字节时间

Lighthouse 得分:
  Performance: 95+
  Accessibility: 95+
  Best Practices: 100
  SEO: 100

资源预算:
  首页总大小: < 500KB (gzip)
  图片: WebP/AVIF + 响应式 srcset
  字体: 子集化 + font-display: swap
  JS: 代码分割 + 动态导入
```

### 6.3 SEO 策略

```yaml
核心关键词（首页）:
  - 多平台发布工具 (月搜 45000)
  - 自媒体一键发布 (月搜 18000)
  - 多平台分发工具 (月搜 12000)
  - 开源发布工具 (月搜 8000)
  - AI 内容工作站 (月搜 5000，蓝海)

长尾关键词（博客 + 文档）:
  - "参考产品 vs 融媒宝 对比"
  - "微信公众号 一键发布 多平台"
  - "抖音 B站 小红书 同时发布"
  - "Cookie 本地加密 发布工具"
  - "AI 写稿 自媒体 工具"
  - "Remotion 视频创作 教程"
  - "开源 多平台 管理 工具"
  - "Logto OIDC 集成"

技术 SEO:
  - Sitemap.xml 自动生成
  - robots.txt 配置
  - 结构化数据 (JSON-LD): SoftwareApplication + FAQPage + BreadcrumbList
  - Open Graph + Twitter Card
  - Canonical URL
  - 301 重定向规则
  - hreflang 多语言（中英文）

内容 SEO:
  - 每篇博客 1500+ 字
  - 关键词密度 1-2%
  - 内链策略：博客 → 功能页 → 下载页
  - 外链策略：GitHub 反链 + 即刻 + V2EX + 掘金
```

### 6.4 转化追踪与 CRO

```yaml
关键转化事件:
  - download_clicked (主转化)
  - github_star_clicked (开源飞轮)
  - pro_trial_started (付费转化)
  - enterprise_demo_requested (B 端线索)
  - signup_completed (用户沉淀)

A/B 测试计划:
  - Hero CTA 文案: "免费下载" vs "立即试用" vs "开始使用"
  - 价格展示: 月付优先 vs 年付优先
  - 竞品对比: 表格 vs 卡片
  - 首屏布局: 左文右图 vs 全屏视频

热力图与录屏:
  - Hotjar 或 Microsoft Clarity
  - 关注首屏滚动深度 + CTA 点击热区
```

---

## 7. 官网开发路线图

### Week 1：P0 上线（MVP）

- [ ] 首页（Hero + 功能 + 价格 + CTA）
- [ ] 下载页
- [ ] GitHub README 同步优化
- [ ] 部署到 Vercel
- [ ] 域名解析 + HTTPS

### Week 2：P0 完整

- [ ] 功能总览页
- [ ] 平台矩阵页
- [ ] 价格页（含 FAQ）
- [ ] 基础 SEO（sitemap + 结构化数据）

### Week 3：P1 内容

- [ ] 竞品对比页
- [ ] 博客系统 + 首 5 篇文章
- [ ] 文档首页 + 快速开始
- [ ] 分析追踪接入

### Week 4：P1 完整

- [ ] AI 能力页
- [ ] 视频创作页
- [ ] 企业版页
- [ ] A/B 测试启动

### Week 5-6：P2 补充

- [ ] 教程视频页
- [ ] 更新日志页
- [ ] 路线图页
- [ ] 关于我们
- [ ] 开源贡献指南

---

## 8. 关键决策点（需确认）

| 决策项 | 选项 | 建议 |
|--------|------|------|
| **品牌定位升级** | 保持"多发工具" / 升级"AI 内容工作站" | 升级（避开红海） |
| **域名选择** | `multi-publish.dev` / `multipublish.io` | `.dev`（开发者向） |
| **早鸟价力度** | ¥99 年付终身锁定 / 可调整 | 保留调整空间 |
| **官网技术栈** | Next.js / Astro | Next.js（生态成熟） |
| **首屏视觉方向** | 3D 倾斜产品图 / 全屏视频背景 / 紫色粒子动效 | 3D 倾斜产品图 |

---

## 9. 文档维护规则

- 本文档为 Multi-Publish 官网建设的**官方基准**
- 任何官网页面开发、文案修改、设计调整必须以本文档为准
- 修改本文档需 PR Review + 至少 1 名核心维护者批准
- 版本号变更需在文末附 changelog
- 上线后每月回顾官网数据（UV / 转化率 / Lighthouse），持续优化

---

## Changelog

- **v1.0（2026-07-26）**：首次发布，基于 PRODUCT-POSITIONING.md 与 MARKETING-HANDBOOK.md 制定
