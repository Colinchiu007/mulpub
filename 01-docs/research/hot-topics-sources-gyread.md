# 调研：gyread.com（AI 情报日报）作为热门选题信源

> 调研日期：2026-10-18
> 方式：直接抓取原始 HTML / sitemap.xml / search-index.json / robots.txt，并逐条回验原文链接
> 结论用途：判断「是否适合作为 AI 类别热门选题的信息源」，并给出接入设计

---

## 一、站点定位

| 项 | 值 |
|---|---|
| 站名 | GYREAD → **AI News**（子站 `gyread.com/news/`） |
| 自我定位 | "AI 前线电报" / "前沿信号流——AI每天在变什么，人在怎么选" |
| 主理人 | 悦（[letter.html](https://gyread.com/news/letter.html) 自述：想做「战地记者」，把一手信息从现场带回来） |
| 创刊 | 2026-06-01 立项，2026-06-02 首期；截至 2026-10-17 连续 **139 天**出刊 |
| 形态 | 每日一期中文情报日报 + 英文同步版 + 周报 + 深度专题 + 付费编年史 |
| 商业化 | 日报全文免费；付费墙在 `gyread.com/pricing`（AI 科技编年史 ¥29.9/36天、¥88 买断），**不在日报上** |

**制作机制**（[ai-news-story.html](https://gyread.com/news/ai-news-story.html) 自述）：
138 天工程历程，写稿规则迭代 47 次、选题标准调整 31 轮、初始规则 23 条、目录结构重塑 19 次；
出刊前 **37 项质检**，分「候选 → 成稿 → 终审」三道阻断；自称 **100% 一手信源直达**。

---

## 二、信息架构

```
/news/                                 新闻首页（hero + 12 篇专题 + 按月归档 143 张日卡）
  ├── /news/latest.html                指向最新一期（小页，1948 字节）
  ├── /news/index.html#archive         完整按月归档
  ├── /news/<YYYY-MM-DD>               无后缀日期 URL（sitemap 用）
  ├── /news/<YYYY-MM>/<YYYY-MM-DD>.html ← 真正的日报 HTML（页面内链接用）
  ├── /news/en/<YYYY-MM>/<YYYY-MM-DD>.html  英文同步版（结构完全对称）
  ├── /news/<YYYY-MM>/ai-weekly-*.html 周报
  ├── /news/special/*.html             深度专题（12 篇）
  ├── /news/ai-news-story.html         制作过程 / 迭代日志
  ├── /news/letter.html                主理人自述
  └── /news/search-index.json          全站索引（见「数据资产」）
```

### 日报详情页：固定 9 段式版式

| # | 栏目 | eyebrow | 形态 | 10-14 实际条目 |
|---|---|---|---|---|
| 1 | **头版** | Headline | 当日最重要 2-3 条，配大图 | 2 |
| 2 | **前线** | Front Line | 产品/产业/政策动态 | 5 |
| 3 | **开源前线** | Open Source | 开源模型、框架、论文 | 2 |
| 4 | **声音** | Voices | 真人原话引用（不做 AI 解读） | 2 |
| 5 | **创造** | Create | 生成式应用、具身智能 | 2 |
| 6 | **视觉** | Vision | 视觉/多模态/硬件算力 | 1 |
| 7 | **投资与资金流向** | Funding & Capital Flows | 融资、并购、资本动向 | 2 |
| 8 | **小结** | Summary | 当日主线归纳 + 一首七绝 | 1 |
| 9 | **保持好奇** | Be Curious | 一张卫星俯瞰图 + 地名 + 人文收尾 | 1 |

单条信息的完整结构：

```
dateline     信源媒体 · 话题分类（如 "CNBC · 华尔街金融防线 · 独家"）
item-title   标题，实体名/数字红蓝色标记
body         3-4 段正文
image-block  配图 + 图注（托管腾讯云 COS）
src-line     出处：<a href="原文URL">媒体名 ↗</a>   ← 每条都有，且是一手链接
```

---

## 三、页面内包含的信息类型

一期平均 **11.5 条**（近 30 天区间 6–17 条），正文约 **5,000 中文字**。维度：

1. **企业/产品动作**：模型发布、API 开放、平台策略变更
2. **资本动向**：融资轮次/估值/ARR、并购、战略投资
3. **安全与治理**：入侵事件、监管、学术公开信
4. **技术突破**：架构、框架、基准成绩
5. **硬件与算力**：芯片、产能、成本
6. **人物原话**：`声音` 栏，真人语录 + 出处链接
7. **当日归纳**：`小结` 栏的叙事主线 + 七绝
8. **编辑元数据**：每条的信源媒体、话题标签、原文直达链接
9. **人文调剂**：`保持好奇` 的卫星图与地理坐标

---

## 四、数据资产（对接入最关键）

三份可直接消费的数据，无需爬 HTML：

| 数据 | 说明 |
|---|---|
| `sitemap.xml` | 319 个 URL，覆盖 2026-06-01 至 2026-10-17 全部日期 + 周报 + 专题 + EN 版 |
| **`search-index.json`** | **1421 条**结构化记录，字段 `u/d/c/t/s/g`（URL/日期/栏目/标题/摘要/标签），621KB |
| 首页 HTML | 143 张日卡，每张含日期 + 中文头条 + 信源列表 |

`search-index.json` 近 30 天栏目分布（共 321 条）：

```
前线            76    创造            41    视觉            30
开源前线         45    投资与资金流向    35    头版            29
```

近 30 天高频实体：开源(51)、OpenAI(44)、智能体(44)、Agent(30)、安全(29)、GPT(28)、
Anthropic(27)、融资(24)、Meta(21)、Google(19)、芯片(17)、视频(17)、Claude(17)、Gemini(13)。

---

## 五、抓取健壮性实测

| 测试 | 结果 |
|---|---|
| 无 UA / 无 Referer 直接访问 | **200**（52KB），无反爬对抗 |
| 手机 UA + Referer | 200，内容一致 |
| 未发布日期（2026-10-18） | **404** |
| 不存在的日期（2030-01-01） | **404** |
| 连续抓取 6 个日期 | 无 429 / 无封禁 |
| 响应头 | `CF-Cache-Status: HIT`、`Cache-Control: public, must-revalidate, max-age=0`、ETag 存在 |

结论：可稳定抓取；**404 即「无当日数据」**，需按失败处理（既有「空列表视为失败」合同已覆盖）。

---

## 六、源链接回验（26 条，10-14 与 10-15 两天）

**19 条成功**，且标题与原文 `og:title` 高度一致：

| gyread 标题 | 原文标题 |
|---|---|
| 摩根大通封禁外部 AI 智能体访问账户 | JPMorgan Chase blocks outside AI agents like Muse, Instinct from directly accessing accounts |
| OpenAI 会议室窃听案 | OpenAI employee arrested for allegedly planting a bug in a conference room |
| Shopify 开放智能体结算 | Shopify opens its catalog up to more AI agents |
| 台积电 Q3 净利大增 | TSMC posts record profit for a sixth straight quarter |
| 英伟达 RTX Spark | All Systems Go: Global PC App Ecosystem Ready for NVIDIA RTX Spark |

**7 条失效**：

| 类型 | 实例 |
|---|---|
| 403（源站反爬） | MarkTechPost |
| 405 | Ars Technica |
| 404（源站内容已下/改址） | higgsfield.ai blog、X 上的 406 位学者公开信 |
| **出处张冠李戴** | 「梁文锋个人出资入股 Winverse AI」的出处链到 **微软 Swin-Transformer 仓库**，与该投资事件无关 |

---

## 七、合规边界（关键）

`robots.txt` 分类放行：

```
User-agent: *              Disallow: /news/     ← 通用爬虫禁抓
User-agent: OAI-SearchBot  Allow: /news/        ← 检索类 UA 放行
User-agent: ChatGPT-User   Allow: /news/
User-agent: PerplexityBot  Allow: /news/
User-agent: GPTBot         Disallow: /          ← 训练类 UA 全站禁
User-agent: ClaudeBot / CCBot / Google-Extended / Applebot-Extended ...  Disallow: /
Content-Signal: search=yes, ai-input=yes, ai-train=no
```

HTTP 响应头另有：`x-robots-tag: noindex, nofollow, noarchive, **noai, noimageai**`

**判读**：
- ✅ **允许**：检索 / 引用（帮用户找到一手新闻，并点回原文）
- ❌ **禁止**：作为模型训练语料

本项目的接入用途是前者，合规。**不得**把该站内容用于训练。

---

## 八、版式演进（解析必须兼容的两代结构）

实测站点 2026-10-17 起换了 DOM：

| 版式 | 来源标注 | 出处链接 |
|---|---|---|
| 旧版（≤10-16） | `<div class="dateline">CNBC · 话题 · 独家</div>`，在标题**之前** | `<div class="src-line">出处：<a href>媒体 ↗</a></div>` 单链接 |
| 新版（10-17 起） | `<div class="item-meta">` 内含 `meta-source` + `meta-topic`，在标题**之后** | `<div class="src-line"><a>A ↗</a> · <a>B ↗</a></div>` **多链接** |

⚠️ **解析陷阱（本轮实测复现）**：旧版 `dateline` 在 `item-title` **之前**，
若仅以 `item-title` 作块锚点，第一条会越界拿到**下一条**的 dateline（串条）。
正确做法是用条目容器 `<div class="item">` 作块边界（两版都有、与字段顺序无关）。

另：新版 `item-meta` 的三个 `<span>` 之间无空白，整体剥标签会得到 `A·B`，
而旧版 `dateline` 是 `A · B` —— 需逐 span 取文本再拼接以归一口径。

---

## 九、结论：适合，但定位为「一级筛选后的候选池 + 溯源跳板」

### ✅ 优势

1. **139 天稳定日更**，`search-index.json` 每日更新
2. **一手信源直达**，每条带原文链接，19/26 回验成功
3. **信源质量高**：CNBC / The Verge / TechCrunch / Wired / Latent Space /
   Simon Willison / Ben's Bites / arXiv / 官方博客
4. **已做初步筛选**：每天从 150+ 信源里选 6–17 条并分好栏目
5. **中文 + 已结构化**：`search-index.json` 有栏目/日期/标题/摘要字段
6. **多元视角**：不只唱多（学者安全公开信、福特承认 AI 质检失败等）

### ⚠️ 限制

1. **robots 禁 AI 训练**（检索/引用可用）——见第七节
2. **源链接失效率 7/26**，含一处出处张冠李戴
3. **无 RSS / 无官方 API**，只有 sitemap + search-index.json + HTML
4. **不是榜单而是日报**：无 `hotValue`、榜单序是编辑意志
   → **不得作为主渠道**，会污染 scorer 的热度归一 / 名次兜底 / `sourceBonus`
5. **无 JSON-LD 结构化标记**，只能靠 HTML class 解析
6. **单一编辑视角**：选题偏向智能体、资本、开源、安全三类

### 接入建议（已落地，见 openspec change `hot-topics-gyread-ai-source`）

1. 挂 `CATEGORY_BOOSTS.ai` 定向补拉源（**不进** `CHANNEL_CONFIGS`）
2. 主数据面用 `search-index.json`（静态 URL、无需推算日期）
3. 用 `parseGyreadEdition` 从日报页补**一手原文链接**（索引只给日报页地址）
4. 原文链接增强 **fail-open**：抓取失败只丢链接，不丢条目
5. 渠道权重取 0.7（低于国民级综合榜，但不低于 0.5 以免被截断挤掉）
6. `intervalMinutes: 60` + `riskLevel: medium`（日报一天一更，最克制口径）
